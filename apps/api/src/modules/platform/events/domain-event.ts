import type { Prisma } from '@prisma/client';

/**
 * Eventos de domínio.
 *
 * São o único caminho pelo qual um módulo de domínio provoca efeito em outro.
 * A ADR-0001 proíbe import direto entre eles, e a razão não é purismo: é que
 * essa mesma costura é a que uma extração para serviço independente usaria.
 * Quando o dia chegar, o publicador continua igual e só o transporte muda.
 *
 * O contrato vive em `platform` porque pertence aos dois lados. O nome do
 * evento e o formato do payload são acordo, não implementação.
 *
 * Na fase 03 a entrega é síncrona e dentro da transação de quem publicou:
 * mudar a assinatura e lançar no razão acontecem juntos ou não acontecem. A
 * fase 05 troca isso pelo outbox transacional, que grava o evento na mesma
 * transação e entrega depois, sem perder a atomicidade e ganhando reentrega.
 */

export const EVENT = {
  SUBSCRIPTION_STARTED: 'subscription.started',
  SUBSCRIPTION_TRIAL_STARTED: 'subscription.trial_started',
  SUBSCRIPTION_PLAN_CHANGED: 'subscription.plan_changed',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  SUBSCRIPTION_RENEWED: 'subscription.renewed',
  INVOICE_ISSUED: 'invoice.issued',
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];

/** Valor monetário dentro de um payload, em unidade mínima. */
export interface MoneyPayload {
  readonly amountMinor: string;
  readonly currency: string;
}

/**
 * Os payloads carregam nome, e não apenas identificador.
 *
 * O razão escreve a descrição do lançamento uma vez e nunca mais a altera, e
 * ela precisa dizer o que era verdade no instante do fato. Resolver o nome na
 * hora da leitura teria dois defeitos: obrigaria o razão a consultar tabelas
 * de cobrança, que a ADR-0001 proíbe, e reescreveria a história toda vez que
 * alguém renomeasse um produto. Um extrato que muda quando o catálogo muda não
 * serve para conferir nada.
 */
export interface SubscriptionStartedPayload {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly priceId: string;
  readonly planName: string;
  readonly amount: MoneyPayload;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface SubscriptionTrialStartedPayload {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly planName: string;
  readonly trialEndsAt: string;
}

/**
 * Troca de plano no meio do ciclo.
 *
 * Carrega os dois lados do rateio separados, e não apenas o líquido, porque
 * quem contabiliza precisa dos dois: crédito do não usado do plano antigo e
 * cobrança do proporcional do novo são fatos distintos.
 */
export interface SubscriptionPlanChangedPayload {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly fromPriceId: string;
  readonly fromPlanName: string;
  readonly toPriceId: string;
  readonly toPlanName: string;
  readonly credit: MoneyPayload;
  readonly charge: MoneyPayload;
  readonly net: MoneyPayload;
  readonly remainingDays: number;
  readonly cycleDays: number;
}

/**
 * Fatura emitida.
 *
 * É este evento, e não o de assinatura, que move o razão. A separação importa:
 * uma assinatura renovada é um fato de produto, e uma fatura emitida é um fato
 * contábil. Nem toda renovação emite fatura, o fim de um período de teste é a
 * mesma renovação sem cobrança, e amarrar a contabilidade ao evento de produto
 * obrigaria a política contábil a conhecer essas exceções.
 */
export interface InvoiceIssuedPayload {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly customerId: string;
  readonly subscriptionId?: string;
  readonly description: string;
  readonly amount: MoneyPayload;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dueAt: string;
}

/**
 * Cobrança confirmada.
 *
 * Carrega o valor e a taxa separados porque são fatos contábeis distintos: o
 * dinheiro que entrou no gateway e a parte dele que é da plataforma. Somá-los
 * antes de lançar perderia a informação de quanto o merchant vai receber de
 * fato, que é justamente o que ele quer saber.
 */
export interface PaymentSucceededPayload {
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly attempt: number;
  readonly amount: MoneyPayload;
  readonly platformFee: MoneyPayload;
  readonly gateway: string;
  readonly gatewayRef: string;
}

/**
 * Cobrança recusada.
 *
 * Não move o razão: recusa não é fato contábil, porque nada mudou de mão. O
 * que ela move é a recuperação, e é por isso que `retriable` viaja no payload.
 */
export interface PaymentFailedPayload {
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly attempt: number;
  readonly amount: MoneyPayload;
  readonly code: string;
  readonly message: string;
  readonly retriable: boolean;
}

export interface SubscriptionCanceledPayload {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly immediate: boolean;
  readonly effectiveAt: string;
}

export interface DomainEventPayloads {
  [EVENT.SUBSCRIPTION_STARTED]: SubscriptionStartedPayload;
  [EVENT.SUBSCRIPTION_TRIAL_STARTED]: SubscriptionTrialStartedPayload;
  [EVENT.SUBSCRIPTION_PLAN_CHANGED]: SubscriptionPlanChangedPayload;
  [EVENT.SUBSCRIPTION_CANCELED]: SubscriptionCanceledPayload;
  [EVENT.SUBSCRIPTION_RENEWED]: SubscriptionStartedPayload;
  [EVENT.INVOICE_ISSUED]: InvoiceIssuedPayload;
  [EVENT.PAYMENT_SUCCEEDED]: PaymentSucceededPayload;
  [EVENT.PAYMENT_FAILED]: PaymentFailedPayload;
}

export interface DomainEvent<T extends EventType = EventType> {
  readonly type: T;
  /**
   * Identificador do evento, único dentro da organização.
   *
   * É a chave de idempotência: o razão tem índice único sobre ele, então o
   * mesmo evento nunca vira dois lançamentos, por mais vezes que seja
   * entregue. Vale a pena derivá-lo de algo estável do domínio, e não de um
   * aleatório, para que uma reentrega produza a mesma chave.
   */
  readonly id: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly payload: DomainEventPayloads[T];
}

/**
 * Quem reage a eventos.
 *
 * O handler recebe a transação de quem publicou, e não abre a sua. É o que
 * garante que o efeito no razão e a mudança na assinatura vivam ou morram
 * juntos.
 */
export interface DomainEventHandler {
  readonly handles: readonly EventType[];
  handle(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void>;
}

export const DOMAIN_EVENT_HANDLER = Symbol('DomainEventHandler');
