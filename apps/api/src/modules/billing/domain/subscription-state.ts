import { BadRequestException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';

export { SubscriptionStatus };

/**
 * Máquina de estados da assinatura.
 *
 * As transições válidas são declaradas, e não deduzidas do código que as
 * executa. Um campo de status com texto livre deixaria qualquer caminho
 * passar, e o erro só apareceria na cobrança.
 *
 *   INCOMPLETE ──> TRIALING ──> ACTIVE ──> PAST_DUE ──> ACTIVE
 *        │              │          │            │
 *        └──> CANCELED  └─> CANCELED           └──> UNPAID
 *                                  └──> CANCELED
 *
 * As duas setas entre ACTIVE e PAST_DUE são o coração da recuperação: voltar
 * de PAST_DUE para ACTIVE é tão importante quanto cair nele, e um desenho que
 * só previsse a queda deixaria receita na mesa.
 */
const TRANSICOES: Readonly<Record<SubscriptionStatus, readonly SubscriptionStatus[]>> = {
  [SubscriptionStatus.INCOMPLETE]: [
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
  ],
  [SubscriptionStatus.TRIALING]: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.CANCELED,
  ],
  [SubscriptionStatus.ACTIVE]: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELED],
  [SubscriptionStatus.PAST_DUE]: [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.UNPAID,
    SubscriptionStatus.CANCELED,
  ],
  // Estados finais. Uma assinatura encerrada não volta: cria-se outra.
  [SubscriptionStatus.CANCELED]: [],
  [SubscriptionStatus.UNPAID]: [SubscriptionStatus.CANCELED],
};

/** Estados em que a assinatura dá acesso ao produto. */
const ATIVOS: readonly SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  // PAST_DUE mantém o acesso de propósito: cortar no primeiro dia de atraso
  // transforma uma falha de cartão em cancelamento, e a recuperação existe
  // justamente para evitar isso.
  SubscriptionStatus.PAST_DUE,
];

export class InvalidTransitionError extends BadRequestException {
  constructor(
    readonly from: SubscriptionStatus,
    readonly to: SubscriptionStatus,
  ) {
    const permitidas = TRANSICOES[from];
    const alternativas =
      permitidas.length === 0
        ? `${from} é um estado final.`
        : `De ${from} só é possível ir para ${permitidas.join(', ')}.`;

    super(`Transição inválida de ${from} para ${to}. ${alternativas}`);
  }
}

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return TRANSICOES[from].includes(to);
}

export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isActive(status: SubscriptionStatus): boolean {
  return ATIVOS.includes(status);
}

export function isFinal(status: SubscriptionStatus): boolean {
  return TRANSICOES[status].length === 0;
}

/** Estados alcançáveis a partir deste. Usado pela interface e pela documentação. */
export function allowedTransitions(from: SubscriptionStatus): readonly SubscriptionStatus[] {
  return TRANSICOES[from];
}
