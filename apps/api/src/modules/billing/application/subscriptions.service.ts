import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { addDays } from '../../platform/clock/duration';
import { DomainEventPublisher } from '../../platform/events/domain-event-publisher';
import { EVENT, type MoneyPayload } from '../../platform/events/domain-event';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { nextPeriodEnd, prorate } from '../domain/proration';
import { assertTransition } from '../domain/subscription-state';
import { InvoicesService } from './invoices.service';

/** Chave de advisory lock por assinatura. Ver ADR-0008. */
const LOCK_NAMESPACE = 0x7061796e; // "payn"

const money = (amount: Money): MoneyPayload => ({
  amountMinor: amount.minor.toString(),
  currency: amount.currencyCode,
});

export interface StartSubscriptionInput {
  readonly organizationId: string;
  readonly customerId: string;
  readonly priceId: string;
  /** Ignora o período de teste do preço, quando o merchant quiser cobrar já. */
  readonly skipTrial?: boolean;
}

export interface ChangePlanInput {
  readonly organizationId: string;
  readonly subscriptionId: string;
  readonly priceId: string;
  /** Versão que o cliente leu. Ver ADR-0008. */
  readonly expectedVersion?: number;
}

export interface CancelInput {
  readonly organizationId: string;
  readonly subscriptionId: string;
  /** Encerra na hora em vez de no fim do ciclo já pago. */
  readonly immediate?: boolean;
  readonly expectedVersion?: number;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventPublisher,
    private readonly invoices: InvoicesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Cria a assinatura e abre o primeiro ciclo.
   *
   * Preço com período de teste começa em TRIALING, sem cobrança. Sem teste, a
   * assinatura nasce INCOMPLETE e só vira ACTIVE quando o primeiro pagamento
   * confirmar, o que acontece na fase 05. Nascer ACTIVE antes de o dinheiro
   * entrar seria dar acesso a quem talvez nunca pague.
   */
  async start(input: StartSubscriptionInput) {
    const agora = this.clock.now();

    const price = await this.prisma.price.findFirst({
      where: { id: input.priceId, organizationId: input.organizationId, active: true },
      include: { product: true },
    });

    if (price === null) {
      throw new NotFoundException('Preço não encontrado ou inativo nesta organização.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId },
    });

    if (customer === null) {
      throw new NotFoundException('Cliente não encontrado nesta organização.');
    }

    const comTeste = price.trialDays > 0 && input.skipTrial !== true;
    const trialEndsAt = comTeste ? addDays(agora, price.trialDays) : null;
    const periodStart = agora;
    const periodEnd = comTeste
      ? trialEndsAt!
      : nextPeriodEnd(agora, price.interval, price.intervalCount);

    const status = comTeste ? SubscriptionStatus.TRIALING : SubscriptionStatus.INCOMPLETE;

    return this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          organizationId: input.organizationId,
          customerId: input.customerId,
          priceId: input.priceId,
          status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          trialEndsAt,
        },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          toStatus: status,
          reason: comTeste
            ? `Assinatura criada com ${price.trialDays} dia(s) de teste`
            : 'Assinatura criada, aguardando o primeiro pagamento',
          occurredAt: agora,
        },
      });

      await this.events.publish(
        {
          type: comTeste ? EVENT.SUBSCRIPTION_TRIAL_STARTED : EVENT.SUBSCRIPTION_STARTED,
          // Derivado do identificador da assinatura, e não aleatório: uma
          // reentrega produz a mesma chave e o razão a recusa como duplicata.
          id: `subscription-started:${subscription.id}`,
          organizationId: input.organizationId,
          occurredAt: agora,
          payload: comTeste
            ? {
                subscriptionId: subscription.id,
                customerId: input.customerId,
                customerName: customer.name,
                planName: price.product.name,
                trialEndsAt: trialEndsAt!.toISOString(),
              }
            : {
                subscriptionId: subscription.id,
                customerId: input.customerId,
                customerName: customer.name,
                priceId: price.id,
                planName: price.product.name,
                amount: money(Money.fromMinor(price.amountMinor, price.currency)),
                periodStart: periodStart.toISOString(),
                periodEnd: periodEnd.toISOString(),
              },
        },
        tx,
      );

      // Período de teste não emite fatura: nada é devido enquanto o teste
      // corre. A primeira fatura sai quando o teste acabar, pelo ciclo de
      // cobrança, que é o mesmo caminho de qualquer renovação.
      if (!comTeste) {
        await this.invoices.issue(tx, {
          organizationId: input.organizationId,
          customerId: input.customerId,
          subscriptionId: subscription.id,
          amount: Money.fromMinor(price.amountMinor, price.currency),
          periodStart,
          periodEnd,
          description: `Fatura de ${customer.name}, plano ${price.product.name}`,
          eventKey: `invoice-issued:${subscription.id}:${periodStart.toISOString()}`,
        });
      }

      return subscription;
    });
  }

  /**
   * Troca de plano no meio do ciclo, com rateio.
   *
   * Toda a operação roda sob advisory lock da assinatura, porque o ciclo é ler
   * o estado, calcular o rateio a partir dele e escrever. Lock de linha
   * cobriria só a escrita, e dois requests simultâneos calculariam o rateio
   * sobre o mesmo estado antigo e gravariam um por cima do outro.
   */
  async changePlan(input: ChangePlanInput) {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const subscription = await this.lockAndLoad(tx, input.organizationId, input.subscriptionId);

      if (input.expectedVersion !== undefined && subscription.version !== input.expectedVersion) {
        throw new ConflictingVersionError(subscription.version, input.expectedVersion);
      }

      if (subscription.priceId === input.priceId) {
        throw new BadRequestException('A assinatura já está neste plano.');
      }

      const proximo = await tx.price.findFirst({
        where: { id: input.priceId, organizationId: input.organizationId, active: true },
        include: { product: true },
      });

      if (proximo === null) {
        throw new NotFoundException('Preço de destino não encontrado ou inativo.');
      }

      const atual = await tx.price.findUniqueOrThrow({
        where: { id: subscription.priceId },
        include: { product: true },
      });

      if (atual.currency !== proximo.currency) {
        throw new BadRequestException(
          `Não é possível trocar de ${atual.currency} para ${proximo.currency}: ` +
            'o rateio exige a mesma moeda dos dois lados.',
        );
      }

      const rateio = prorate({
        currentAmount: Money.fromMinor(atual.amountMinor, atual.currency),
        nextAmount: Money.fromMinor(proximo.amountMinor, proximo.currency),
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        changedAt: agora,
      });

      const atualizada = await tx.subscription.update({
        where: { id: subscription.id },
        data: { priceId: proximo.id, version: { increment: 1 } },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: subscription.status,
          toStatus: subscription.status,
          reason:
            `Plano trocado com ${rateio.remainingDays} de ${rateio.cycleDays} dias restantes. ` +
            `Crédito ${rateio.credit.toString()}, cobrança ${rateio.charge.toString()}, ` +
            `líquido ${rateio.net.toString()}`,
          occurredAt: agora,
        },
      });

      await this.events.publish(
        {
          type: EVENT.SUBSCRIPTION_PLAN_CHANGED,
          id: `plan-changed:${subscription.id}:${atualizada.version}`,
          organizationId: input.organizationId,
          occurredAt: agora,
          payload: {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            customerName: subscription.customer.name,
            fromPriceId: atual.id,
            fromPlanName: atual.product.name,
            toPriceId: proximo.id,
            toPlanName: proximo.product.name,
            credit: money(rateio.credit),
            charge: money(rateio.charge),
            net: money(rateio.net),
            remainingDays: rateio.remainingDays,
            cycleDays: rateio.cycleDays,
          },
        },
        tx,
      );

      return { subscription: atualizada, proration: rateio };
    });
  }

  /**
   * Cancela a assinatura.
   *
   * O padrão é encerrar no fim do ciclo já pago, e não na hora: quem pagou o
   * mês tem direito ao mês. Cancelamento imediato existe, mas é escolha
   * explícita de quem chama.
   */
  async cancel(input: CancelInput) {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const subscription = await this.lockAndLoad(tx, input.organizationId, input.subscriptionId);

      if (input.expectedVersion !== undefined && subscription.version !== input.expectedVersion) {
        throw new ConflictingVersionError(subscription.version, input.expectedVersion);
      }

      const imediato = input.immediate === true;

      if (imediato) {
        assertTransition(subscription.status, SubscriptionStatus.CANCELED);
      }

      const atualizada = await tx.subscription.update({
        where: { id: subscription.id },
        data: imediato
          ? {
              status: SubscriptionStatus.CANCELED,
              canceledAt: agora,
              cancelAtPeriodEnd: false,
              version: { increment: 1 },
            }
          : { cancelAtPeriodEnd: true, version: { increment: 1 } },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: subscription.status,
          toStatus: imediato ? SubscriptionStatus.CANCELED : subscription.status,
          reason: imediato
            ? 'Cancelamento imediato'
            : `Cancelamento agendado para ${subscription.currentPeriodEnd.toISOString()}`,
          occurredAt: agora,
        },
      });

      await this.events.publish(
        {
          type: EVENT.SUBSCRIPTION_CANCELED,
          id: `canceled:${subscription.id}:${atualizada.version}`,
          organizationId: input.organizationId,
          occurredAt: agora,
          payload: {
            subscriptionId: subscription.id,
            customerId: subscription.customerId,
            immediate: imediato,
            effectiveAt: (imediato ? agora : subscription.currentPeriodEnd).toISOString(),
          },
        },
        tx,
      );

      return atualizada;
    });
  }

  /** Desfaz um cancelamento agendado, enquanto o ciclo não virou. */
  async resume(organizationId: string, subscriptionId: string) {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const subscription = await this.lockAndLoad(tx, organizationId, subscriptionId);

      if (!subscription.cancelAtPeriodEnd) {
        throw new BadRequestException('Esta assinatura não tem cancelamento agendado.');
      }

      const atualizada = await tx.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: false, version: { increment: 1 } },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: subscription.status,
          toStatus: subscription.status,
          reason: 'Cancelamento agendado desfeito',
          occurredAt: agora,
        },
      });

      return atualizada;
    });
  }

  async list(organizationId: string) {
    return this.prisma.subscription.findMany({
      where: { organizationId },
      include: { customer: true, price: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findById(organizationId: string, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId },
      include: {
        customer: true,
        price: { include: { product: true } },
        events: { orderBy: { occurredAt: 'desc' } },
      },
    });

    if (subscription === null) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    return subscription;
  }

  /**
   * Toma o advisory lock da assinatura e carrega o estado.
   *
   * `pg_advisory_xact_lock` é liberado no fim da transação, sem `unlock`
   * explícito: um lock que precisa ser devolvido à mão vaza no primeiro
   * caminho de erro que alguém esquecer de tratar.
   *
   * A chave são dois inteiros de 32 bits. O primeiro é uma constante que
   * identifica o Paynow, para não colidir com lock de outra parte do sistema;
   * o segundo vem de um hash do identificador da assinatura.
   */
  private async lockAndLoad(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subscriptionId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${subscriptionId})::int)`;

    const subscription = await tx.subscription.findFirst({
      where: { id: subscriptionId, organizationId },
      // O cliente vem junto porque o evento publicado carrega o nome dele: a
      // descrição do lançamento precisa ser legível sem consultar cobrança.
      include: { customer: true },
    });

    if (subscription === null) {
      throw new NotFoundException('Assinatura não encontrada.');
    }

    return subscription;
  }
}

/**
 * A assinatura mudou entre a leitura e a escrita.
 *
 * Concorrência vira erro visível em vez de sobrescrita silenciosa: quem chamou
 * releu, viu outro estado e decide o que fazer.
 */
export class ConflictingVersionError extends BadRequestException {
  constructor(
    readonly actual: number,
    readonly expected: number,
  ) {
    super(
      `A assinatura foi alterada por outra operação: esperava a versão ${expected} ` +
        `e encontrou a ${actual}. Releia e tente de novo.`,
    );
  }
}
