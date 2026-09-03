import { Inject, Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, type Prisma, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { addDays, isAfterOrEqual } from '../../platform/clock/duration';
import { DomainEventPublisher } from '../../platform/events/domain-event-publisher';
import { EVENT } from '../../platform/events/domain-event';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { nextPeriodEnd } from '../domain/proration';
import { assertTransition } from '../domain/subscription-state';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

/** Chave de advisory lock por assinatura. A mesma da ADR-0008. */
const LOCK_NAMESPACE = 0x7061796e;

/**
 * Teto de voltas do ciclo.
 *
 * Avançar um ano de uma vez em um plano diário produz trezentas e tantas
 * renovações legítimas, então o teto é alto. Ele não existe para limitar o
 * trabalho correto, e sim para transformar um laço infinito, causado por um
 * bug que deixe a assinatura vencida depois de processada, em erro visível em
 * vez de processo travado.
 */
const MAX_VOLTAS = 500;

/** Quantas assinaturas cada volta processa. */
const LOTE = 100;

export type CycleAction =
  'renovada' | 'ativada' | 'encerrada' | 'expirada' | 'cobrada' | 'recusada' | 'incobravel';

export interface CycleEffect {
  readonly subscriptionId: string;
  readonly customerName: string;
  readonly action: CycleAction;
  readonly at: Date;
}

export interface CycleReport {
  readonly ranAt: Date;
  readonly effects: readonly CycleEffect[];
}

/**
 * Ciclo de cobrança.
 *
 * Esta é a peça que dá sentido ao relógio virtual: adiantar o tempo só
 * significa alguma coisa se houver algo que reage a ele. Aqui é onde o fim do
 * período vira fatura nova, o fim do teste vira assinatura ativa e o
 * cancelamento agendado vira cancelamento de verdade.
 *
 * O laço é a parte que mais importa. Avançar dois meses em um plano mensal tem
 * de produzir duas renovações, e não uma: o ciclo roda até não sobrar nada
 * vencido, e cada volta enxerga o resultado da anterior. Um ciclo que
 * processasse uma vez só deixaria a assinatura com um período no passado e a
 * contabilidade com uma fatura faltando, e o erro só apareceria no fechamento.
 *
 * Nada aqui lê o relógio do sistema. Tudo vem do `Clock` injetado, que dentro
 * de um escopo devolve o instante congelado da organização. É por isso que a
 * mesma sequência de comandos produz sempre a mesma história.
 */
@Injectable()
export class BillingCycleService {
  private readonly logger = new Logger(BillingCycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventPublisher,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Processa tudo que venceu na organização até o instante atual.
   *
   * Cada assinatura é tratada na própria transação, sob advisory lock. Uma
   * transação única para o lote inteiro seria mais rápida e muito pior: uma
   * assinatura com problema derrubaria o ciclo de todas as outras, e o
   * relatório não teria como dizer o que deu certo antes de falhar.
   */
  async runDue(organizationId: string): Promise<CycleReport> {
    const ranAt = this.clock.now();
    const effects: CycleEffect[] = [];

    await this.virarCiclos(organizationId, ranAt, effects);
    await this.cobrarPendentes(organizationId, ranAt, effects);

    return { ranAt, effects };
  }

  /**
   * Cobra as faturas cuja próxima tentativa venceu.
   *
   * A recuperação roda depois da virada de ciclo, e não antes, porque a virada
   * emite faturas novas: cobrar primeiro deixaria a fatura recém emitida para
   * a rodada seguinte, e a assinatura passaria um ciclo inteiro sem tentativa.
   *
   * Cada cobrança fala com o provedor, então nada aqui roda dentro de
   * transação. Uma falha em uma fatura não derruba as outras: o relatório
   * registra o que aconteceu com cada uma.
   */
  private async cobrarPendentes(
    organizationId: string,
    agora: Date,
    effects: CycleEffect[],
  ): Promise<void> {
    const vencidas = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: InvoiceStatus.OPEN,
        nextAttemptAt: { lte: agora },
      },
      include: { customer: true },
      orderBy: { nextAttemptAt: 'asc' },
      take: LOTE,
    });

    for (const invoice of vencidas) {
      let resultado;

      try {
        resultado = await this.payments.chargeInvoice(organizationId, invoice.id);
      } catch (error) {
        // Cliente sem meio de pagamento é o caso comum aqui, e é condição de
        // negócio e não defeito. Deixar a exceção subir faria um cliente sem
        // cartão interromper a cobrança de todos os outros da organização, que
        // é o oposto do que uma passagem em lote deve fazer.
        //
        // A fatura é empurrada um dia para a frente em vez de ficar parada:
        // se o cartão for cadastrado nesse meio tempo, a passagem seguinte a
        // encontra sozinha. `attemptCount` não muda, porque não houve
        // tentativa de cobrança nenhuma.
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { nextAttemptAt: addDays(agora, 1) },
        });

        this.logger.warn(
          `Fatura ${invoice.number} de ${invoice.customer.name} não pôde ser cobrada: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );

        continue;
      }

      // PENDING é o provedor sem resposta. Não conta como cobrada nem como
      // recusada, porque nenhuma das duas é verdade, e a fatura já foi
      // reagendada por quem tentou.
      if (resultado.status === PaymentStatus.PENDING) {
        continue;
      }

      effects.push({
        subscriptionId: invoice.subscriptionId ?? invoice.id,
        customerName: invoice.customer.name,
        action:
          resultado.status === PaymentStatus.SUCCEEDED
            ? 'cobrada'
            : resultado.invoiceStatus === InvoiceStatus.UNCOLLECTIBLE
              ? 'incobravel'
              : 'recusada',
        at: agora,
      });
    }
  }

  /** Vira os ciclos vencidos, emitindo fatura a cada virada. */
  private async virarCiclos(
    organizationId: string,
    ranAt: Date,
    effects: CycleEffect[],
  ): Promise<void> {
    for (let volta = 0; volta < MAX_VOLTAS; volta += 1) {
      const vencidas = await this.prisma.subscription.findMany({
        where: {
          organizationId,
          currentPeriodEnd: { lte: ranAt },
          status: {
            in: [
              SubscriptionStatus.INCOMPLETE,
              SubscriptionStatus.TRIALING,
              SubscriptionStatus.ACTIVE,
            ],
          },
        },
        orderBy: { currentPeriodEnd: 'asc' },
        take: LOTE,
        select: { id: true },
      });

      if (vencidas.length === 0) {
        return;
      }

      for (const vencida of vencidas) {
        const effect = await this.processar(organizationId, vencida.id, ranAt);

        if (effect !== null) {
          effects.push(effect);
        }
      }
    }

    // Chegar aqui significa que uma assinatura continuou vencida depois de ter
    // sido processada, o que é bug e não carga de trabalho. Falhar alto é
    // melhor do que girar para sempre consumindo uma conexão do pool.
    throw new Error(
      `Ciclo de cobrança não convergiu em ${MAX_VOLTAS} voltas na organização ${organizationId}.`,
    );
  }

  private async processar(
    organizationId: string,
    subscriptionId: string,
    agora: Date,
  ): Promise<CycleEffect | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, hashtext(${subscriptionId})::int)`;

      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, organizationId },
        include: { customer: true, price: { include: { product: true } } },
      });

      // A assinatura pode ter mudado entre a consulta e o lock, inclusive por
      // uma troca de plano feita no painel neste exato instante. Reler sob o
      // lock e reconferir o vencimento é o que impede o ciclo de agir sobre um
      // estado que já não existe.
      if (subscription === null || !isAfterOrEqual(agora, subscription.currentPeriodEnd)) {
        return null;
      }

      if (subscription.cancelAtPeriodEnd) {
        return this.encerrar(
          tx,
          subscription,
          agora,
          'encerrada',
          'Cancelamento agendado cumprido',
        );
      }

      if (subscription.status === SubscriptionStatus.INCOMPLETE) {
        // O primeiro pagamento nunca confirmou. O que o cliente já devia
        // continua no razão: cancelar a assinatura não perdoa a dívida, e
        // baixa de valor a receber é decisão contábil separada, que entra com
        // a recuperação na fase 05.
        return this.encerrar(
          tx,
          subscription,
          agora,
          'expirada',
          'Primeiro pagamento não confirmou dentro do período',
        );
      }

      return this.renovar(tx, subscription, agora);
    });
  }

  /**
   * Abre o próximo ciclo e emite a fatura correspondente.
   *
   * O novo período começa onde o anterior terminou, e não no instante em que o
   * ciclo rodou. Ancorar no fim do período anterior é o que mantém a data de
   * aniversário da assinatura estável: sem isso, cada renovação processada com
   * atraso empurraria a cobrança um pouco para a frente, e em um ano a data já
   * seria outra.
   */
  private async renovar(
    tx: Prisma.TransactionClient,
    subscription: SubscriptionComTudo,
    agora: Date,
  ): Promise<CycleEffect> {
    const saindoDoTeste = subscription.status === SubscriptionStatus.TRIALING;
    const inicio = subscription.currentPeriodEnd;
    const fim = nextPeriodEnd(
      inicio,
      subscription.price.interval,
      subscription.price.intervalCount,
    );

    if (saindoDoTeste) {
      assertTransition(subscription.status, SubscriptionStatus.ACTIVE);
    }

    const atualizada = await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: inicio,
        currentPeriodEnd: fim,
        version: { increment: 1 },
      },
    });

    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        fromStatus: subscription.status,
        toStatus: SubscriptionStatus.ACTIVE,
        reason: saindoDoTeste
          ? 'Período de teste encerrado, primeiro ciclo cobrado'
          : 'Ciclo renovado',
        occurredAt: agora,
      },
    });

    await this.events.publish(
      {
        type: EVENT.SUBSCRIPTION_RENEWED,
        // Derivada do início do período, e não de um aleatório nem de um
        // contador: rodar o ciclo duas vezes sobre o mesmo período produz a
        // mesma chave, e o índice único do razão recusa a duplicata.
        id: `subscription-renewed:${subscription.id}:${inicio.toISOString()}`,
        organizationId: subscription.organizationId,
        occurredAt: agora,
        payload: {
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          customerName: subscription.customer.name,
          priceId: subscription.priceId,
          planName: subscription.price.product.name,
          amount: {
            amountMinor: subscription.price.amountMinor.toString(),
            currency: subscription.price.currency,
          },
          periodStart: inicio.toISOString(),
          periodEnd: fim.toISOString(),
        },
      },
      tx,
    );

    // A renovação é um fato de produto; a fatura é o fato contábil. Emitir a
    // fatura aqui, e não deixar o razão reagir à renovação, é o que permite
    // que exista renovação sem cobrança, como o fim de um teste gratuito.
    await this.invoices.issue(tx, {
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      amount: Money.fromMinor(subscription.price.amountMinor, subscription.price.currency),
      periodStart: inicio,
      periodEnd: fim,
      description: `Fatura de ${subscription.customer.name}, plano ${subscription.price.product.name}`,
      eventKey: `invoice-issued:${subscription.id}:${inicio.toISOString()}`,
    });

    this.logger.log(
      `Assinatura ${subscription.id} renovada para ${fim.toISOString()} ` +
        `(${Money.fromMinor(subscription.price.amountMinor, subscription.price.currency).toString()})`,
    );

    return {
      subscriptionId: atualizada.id,
      customerName: subscription.customer.name,
      action: saindoDoTeste ? 'ativada' : 'renovada',
      at: agora,
    };
  }

  private async encerrar(
    tx: Prisma.TransactionClient,
    subscription: SubscriptionComTudo,
    agora: Date,
    action: CycleAction,
    reason: string,
  ): Promise<CycleEffect> {
    assertTransition(subscription.status, SubscriptionStatus.CANCELED);

    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: agora,
        cancelAtPeriodEnd: false,
        version: { increment: 1 },
      },
    });

    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        fromStatus: subscription.status,
        toStatus: SubscriptionStatus.CANCELED,
        reason,
        occurredAt: agora,
      },
    });

    return {
      subscriptionId: subscription.id,
      customerName: subscription.customer.name,
      action,
      at: agora,
    };
  }
}

type SubscriptionComTudo = Prisma.SubscriptionGetPayload<{
  include: { customer: true; price: { include: { product: true } } };
}>;
