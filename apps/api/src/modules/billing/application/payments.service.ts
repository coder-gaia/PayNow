import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { addHours } from '../../platform/clock/duration';
import { DomainEventPublisher } from '../../platform/events/domain-event-publisher';
import { EVENT } from '../../platform/events/domain-event';
import {
  GatewayUnavailableError,
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type PaymentMethodRef,
} from '../../platform/payments/payment-gateway';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { assertTransition, isFinal } from '../domain/subscription-state';
import { nextAttemptDelayHours, RETRY_SCHEDULE_HOURS } from '../domain/dunning';

/** Chave de advisory lock por fatura. Mesmo desenho da ADR-0008. */
const INVOICE_LOCK_NAMESPACE = 0x70617969; // "payi"

/**
 * Fatia da plataforma, em pontos-base. 300 = 3%.
 *
 * Constante por enquanto, e o lugar certo para ela virar configuração é o
 * plano contratado da organização. Deixá-la aqui, visível e com nome, é melhor
 * do que espalhar `0.03` por três arquivos.
 */
const PLATFORM_FEE_BASIS_POINTS = 300;

/**
 * O que o passo 1 descobriu.
 *
 * União marcada em vez de "objeto com campo opcional" porque os dois casos não
 * têm nada em comum: ou há uma tentativa aberta para enviar ao provedor, ou a
 * fatura já estava resolvida e não há o que enviar.
 */
type Preparo =
  | { readonly kind: 'resolvida'; readonly resultado: ChargeResult }
  | {
      readonly kind: 'tentativa';
      readonly paymentId: string;
      readonly idempotencyKey: string;
      readonly amountMinor: bigint;
      readonly currency: string;
      readonly method: PaymentMethodRef;
      readonly description: string;
    };

export interface ChargeResult {
  readonly paymentId: string;
  readonly status: PaymentStatus;
  readonly attempt: number;
  readonly invoiceStatus: InvoiceStatus;
  readonly failureCode?: string;
  readonly nextAttemptAt?: Date;
}

/**
 * Cobrança de faturas.
 *
 * A parte difícil deste serviço não é o caminho feliz. É que a chamada ao
 * provedor acontece **fora** de qualquer transação, e é obrigatório que seja
 * assim: uma transação aberta durante uma chamada de rede segura conexão do
 * pool pelo tempo que o outro lado quiser demorar, e um provedor lento vira
 * banco indisponível.
 *
 * Isso divide a cobrança em três tempos:
 *
 * 1. **Antes.** Grava a tentativa como PENDING e commita. Se o processo morrer
 *    no passo seguinte, fica o registro de que houve tentativa, com a chave de
 *    idempotência que foi usada.
 * 2. **Durante.** Chama o provedor, sem transação nenhuma aberta.
 * 3. **Depois.** Grava o resultado e publica o fato, em transação nova.
 *
 * O passo 1 existir separado é o que torna o passo 2 seguro de repetir. Sem
 * ele, um timeout deixaria o sistema sem saber sequer que tentou.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventPublisher,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Tenta cobrar uma fatura.
   *
   * Cobrar uma fatura já paga não é erro: é uma repetição, e a resposta é o
   * estado atual. Quem chama pode ser um retry de rede, e responder 400 nesse
   * caso transformaria uma repetição inofensiva em alarme.
   */
  async chargeInvoice(organizationId: string, invoiceId: string): Promise<ChargeResult> {
    const preparo = await this.abrirTentativa(organizationId, invoiceId);

    if (preparo.kind === 'resolvida') {
      return preparo.resultado;
    }

    try {
      const outcome = await this.gateway.charge({
        idempotencyKey: preparo.idempotencyKey,
        amountMinor: preparo.amountMinor,
        currency: preparo.currency,
        method: preparo.method,
        description: preparo.description,
      });

      return outcome.status === 'succeeded'
        ? this.registrarSucesso(preparo.paymentId, outcome.reference)
        : this.registrarFalha(preparo.paymentId, outcome.code, outcome.message, outcome.retriable);
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        // O provedor pode ter cobrado. Não dá para lançar no razão nem para
        // recusar: a tentativa fica PENDING e volta para a fila. A chave de
        // idempotência é a mesma, então repetir não cobra duas vezes.
        return this.registrarIndefinido(preparo.paymentId, error.message);
      }

      throw error;
    }
  }

  /**
   * Passo 1: reserva a tentativa e commita.
   *
   * Tudo que precisa ser verdade antes de falar com o provedor acontece aqui,
   * sob advisory lock: a fatura ainda está aberta, o cliente tem meio de
   * pagamento, e este número de tentativa é meu.
   */
  private async abrirTentativa(organizationId: string, invoiceId: string): Promise<Preparo> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVOICE_LOCK_NAMESPACE}::int, hashtext(${invoiceId})::int)`;

      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organizationId },
        include: { customer: true },
      });

      if (invoice === null) {
        throw new NotFoundException('Fatura não encontrada.');
      }

      if (invoice.status !== InvoiceStatus.OPEN) {
        return {
          kind: 'resolvida',
          resultado: {
            paymentId: '',
            status:
              invoice.status === InvoiceStatus.PAID
                ? PaymentStatus.SUCCEEDED
                : PaymentStatus.FAILED,
            attempt: invoice.attemptCount,
            invoiceStatus: invoice.status,
          },
        };
      }

      const token = invoice.customer.paymentMethodToken;

      if (token === null) {
        throw new BadRequestException(
          'O cliente não tem meio de pagamento cadastrado. Cadastre um antes de cobrar.',
        );
      }

      const attempt = invoice.attemptCount + 1;

      const payment = await tx.payment.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          attempt,
          status: PaymentStatus.PENDING,
          amountMinor: invoice.amountMinor,
          currency: invoice.currency,
          gateway: this.gateway.name,
          // A chave inclui a tentativa, então cada tentativa é uma cobrança
          // distinta para o provedor. Sem a tentativa na chave, a segunda
          // cobrança de uma recuperação seria reconhecida como repetição da
          // primeira e devolveria a recusa antiga para sempre.
          idempotencyKey: `charge:${invoice.id}:${attempt}`,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { attemptCount: attempt, nextAttemptAt: null },
      });

      return {
        kind: 'tentativa',
        paymentId: payment.id,
        idempotencyKey: payment.idempotencyKey,
        amountMinor: invoice.amountMinor,
        currency: invoice.currency,
        method: {
          token,
          ...(invoice.customer.paymentMethodBrand === null
            ? {}
            : { brand: invoice.customer.paymentMethodBrand }),
          ...(invoice.customer.paymentMethodLast4 === null
            ? {}
            : { last4: invoice.customer.paymentMethodLast4 }),
        },
        description: `Fatura ${invoice.number} de ${invoice.customer.name}`,
      };
    });
  }

  /** Passo 3, caminho feliz: quita a fatura e reconhece o dinheiro. */
  private async registrarSucesso(paymentId: string, reference: string): Promise<ChargeResult> {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.SUCCEEDED, gatewayRef: reference },
        include: { invoice: { include: { customer: true } } },
      });

      const invoice = await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: InvoiceStatus.PAID, paidAt: agora, nextAttemptAt: null },
      });

      const amount = Money.fromMinor(payment.amountMinor, payment.currency);
      const fee = amount.percentage(PLATFORM_FEE_BASIS_POINTS);

      await this.events.publish(
        {
          type: EVENT.PAYMENT_SUCCEEDED,
          id: `payment-succeeded:${payment.id}`,
          organizationId: payment.organizationId,
          occurredAt: agora,
          payload: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            customerId: invoice.customerId,
            customerName: payment.invoice.customer.name,
            attempt: payment.attempt,
            amount: { amountMinor: amount.minor.toString(), currency: amount.currencyCode },
            platformFee: { amountMinor: fee.minor.toString(), currency: fee.currencyCode },
            gateway: payment.gateway,
            gatewayRef: reference,
          },
        },
        tx,
      );

      await this.acertarAssinatura(tx, invoice.subscriptionId, true, agora);

      return {
        paymentId: payment.id,
        status: PaymentStatus.SUCCEEDED,
        attempt: payment.attempt,
        invoiceStatus: InvoiceStatus.PAID,
      };
    });
  }

  /** Passo 3, recusa: agenda a próxima tentativa e avisa. */
  private async registrarFalha(
    paymentId: string,
    code: string,
    message: string,
    retriable: boolean,
  ): Promise<ChargeResult> {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: code,
          failureMessage: message,
          retriable,
        },
        include: { invoice: { include: { customer: true } } },
      });

      // Recusa definitiva não volta para a fila. Insistir em um cartão
      // cancelado queima a relação com o cliente e ainda conta como tentativa
      // fracassada para o adquirente, que é algo que se paga.
      const horas = retriable ? nextAttemptDelayHours(payment.attempt) : null;
      const nextAttemptAt = horas === null ? null : addHours(agora, horas);

      const esgotou = horas === null;

      const invoice = await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          nextAttemptAt,
          ...(esgotou ? { status: InvoiceStatus.UNCOLLECTIBLE } : {}),
        },
      });

      const amount = Money.fromMinor(payment.amountMinor, payment.currency);

      await this.events.publish(
        {
          type: EVENT.PAYMENT_FAILED,
          id: `payment-failed:${payment.id}`,
          organizationId: payment.organizationId,
          occurredAt: agora,
          payload: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            customerId: invoice.customerId,
            customerName: payment.invoice.customer.name,
            attempt: payment.attempt,
            amount: { amountMinor: amount.minor.toString(), currency: amount.currencyCode },
            code,
            message,
            retriable,
          },
        },
        tx,
      );

      await this.acertarAssinatura(tx, invoice.subscriptionId, false, agora, esgotou);

      return {
        paymentId: payment.id,
        status: PaymentStatus.FAILED,
        attempt: payment.attempt,
        invoiceStatus: invoice.status,
        failureCode: code,
        ...(nextAttemptAt === null ? {} : { nextAttemptAt }),
      };
    });
  }

  /**
   * Passo 3, incerteza: não sabemos se cobrou.
   *
   * Nada é lançado no razão e a fatura continua aberta. A tentativa fica
   * PENDING para sempre, como registro de que houve uma chamada cujo desfecho
   * se desconhece, e uma tentativa nova é agendada. Reconciliar PENDING contra
   * o provedor é trabalho da fase 09.
   */
  private async registrarIndefinido(paymentId: string, motivo: string): Promise<ChargeResult> {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: { failureMessage: motivo },
      });

      const nextAttemptAt = addHours(agora, nextAttemptDelayHours(payment.attempt) ?? 1);

      const invoice = await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { nextAttemptAt },
      });

      this.logger.warn(
        `Cobrança sem desfecho conhecido na fatura ${invoice.number}: ${motivo}. ` +
          'A tentativa fica PENDING até ser reconciliada.',
      );

      return {
        paymentId: payment.id,
        status: PaymentStatus.PENDING,
        attempt: payment.attempt,
        invoiceStatus: invoice.status,
        nextAttemptAt,
      };
    });
  }

  /**
   * Move a assinatura conforme o desfecho da cobrança.
   *
   * A chamada é direta, e não por evento, porque assinatura e fatura vivem no
   * mesmo módulo: um evento aqui seria indireção sem fronteira para atravessar.
   * O que atravessa fronteira é o lançamento contábil, e esse sim vai por
   * evento.
   */
  private async acertarAssinatura(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    subscriptionId: string | null,
    pago: boolean,
    agora: Date,
    recuperacaoEsgotada = false,
  ): Promise<void> {
    if (subscriptionId === null) {
      return;
    }

    const subscription = await tx.subscription.findUnique({ where: { id: subscriptionId } });

    if (subscription === null || isFinal(subscription.status)) {
      return;
    }

    // Recusa só derruba quem estava em dia. Uma assinatura INCOMPLETE nunca
    // teve pagamento nenhum, então ela não "atrasou": continua sendo o que
    // era, esperando o primeiro pagamento, e quem a encerra é o ciclo de
    // cobrança quando o período vencer. PAST_DUE significa "já esteve em dia e
    // caiu", e é essa distinção que faz o painel poder dizer, sem consultar o
    // histórico, se aquele cliente já pagou alguma vez.
    if (!pago && subscription.status === SubscriptionStatus.INCOMPLETE) {
      return;
    }

    // A recuperação esgotada é o fim da linha, e o caminho até lá passa por
    // PAST_DUE mesmo quando a primeira recusa já é definitiva. A máquina de
    // estados não aceita ACTIVE indo direto para UNPAID, e ela está certa: o
    // histórico da assinatura precisa mostrar a queda antes do desfecho, senão
    // fica parecendo que o corte veio do nada.
    const caminho = pago
      ? [SubscriptionStatus.ACTIVE]
      : recuperacaoEsgotada
        ? [SubscriptionStatus.PAST_DUE, SubscriptionStatus.UNPAID]
        : [SubscriptionStatus.PAST_DUE];

    let atual = subscription.status;

    for (const destino of caminho) {
      if (atual === destino) {
        continue;
      }

      assertTransition(atual, destino);

      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: destino, version: { increment: 1 } },
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: atual,
          toStatus: destino,
          reason: motivoDaTransicao(destino),
          occurredAt: agora,
        },
      });

      atual = destino;
    }
  }

  /** O calendário de novas tentativas, para a interface poder explicá-lo. */
  retrySchedule(): readonly number[] {
    return RETRY_SCHEDULE_HOURS;
  }
}

function motivoDaTransicao(destino: SubscriptionStatus): string {
  switch (destino) {
    case SubscriptionStatus.ACTIVE:
      return 'Pagamento confirmado';
    case SubscriptionStatus.PAST_DUE:
      return 'Cobrança recusada, recuperação em andamento';
    case SubscriptionStatus.UNPAID:
      return 'Recuperação esgotada sem pagamento';
    default:
      return 'Mudança provocada por cobrança';
  }
}
