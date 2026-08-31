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
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];

/** Valor monetário dentro de um payload, em unidade mínima. */
export interface MoneyPayload {
  readonly amountMinor: string;
  readonly currency: string;
}

export interface SubscriptionStartedPayload {
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly priceId: string;
  readonly amount: MoneyPayload;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface SubscriptionTrialStartedPayload {
  readonly subscriptionId: string;
  readonly customerId: string;
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
  readonly fromPriceId: string;
  readonly toPriceId: string;
  readonly credit: MoneyPayload;
  readonly charge: MoneyPayload;
  readonly net: MoneyPayload;
  readonly remainingDays: number;
  readonly cycleDays: number;
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
