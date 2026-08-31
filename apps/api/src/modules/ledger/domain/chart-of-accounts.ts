import { AccountKind } from '@prisma/client';

/**
 * Plano de contas do Paynow.
 *
 * Espelha docs/plano-de-contas.md, que é o documento que manda: o código aqui
 * só torna a lista executável. Uma conta nova entra por ADR, com os lançamentos
 * de referência e os testes correspondentes escritos antes da implementação.
 *
 * Seis contas cobrem a primeira versão inteira. A restrição é deliberada: cada
 * conta multiplica os casos de teste do ledger.
 */

export const ACCOUNT = {
  /** O que o cliente deve ao merchant por faturas já emitidas. */
  CUSTOMER_RECEIVABLE: 'customer:receivable',
  /** Dinheiro capturado pelo gateway e ainda não liquidado ao merchant. */
  GATEWAY_CLEARING: 'gateway:clearing',
  /** Receita reconhecida do merchant. */
  MERCHANT_REVENUE: 'merchant:revenue',
  /** Taxa da plataforma sobre a transação. */
  PLATFORM_FEE: 'platform:fee',
  /** Crédito do cliente vindo de downgrade ou estorno parcial. */
  CUSTOMER_CREDIT: 'customer:credit',
  /** Estornos concedidos, deduzidos da receita. */
  MERCHANT_REFUNDS: 'merchant:refunds',
} as const;

export type AccountCode = (typeof ACCOUNT)[keyof typeof ACCOUNT];

export interface AccountDefinition {
  readonly code: AccountCode;
  readonly kind: AccountKind;
  /** Lado em que o saldo normalmente fica, para leitura humana. */
  readonly normalBalance: 'debit' | 'credit';
  readonly label: string;
  readonly description: string;
}

export const CHART_OF_ACCOUNTS: readonly AccountDefinition[] = [
  {
    code: ACCOUNT.CUSTOMER_RECEIVABLE,
    kind: AccountKind.ASSET,
    normalBalance: 'debit',
    label: 'Contas a receber',
    description: 'O que o cliente deve ao merchant por faturas já emitidas.',
  },
  {
    code: ACCOUNT.GATEWAY_CLEARING,
    kind: AccountKind.ASSET,
    normalBalance: 'debit',
    label: 'Em liquidação no gateway',
    description: 'Dinheiro capturado pelo gateway e ainda não liquidado ao merchant.',
  },
  {
    code: ACCOUNT.MERCHANT_REVENUE,
    kind: AccountKind.REVENUE,
    normalBalance: 'credit',
    label: 'Receita do merchant',
    description: 'Receita reconhecida do merchant.',
  },
  {
    code: ACCOUNT.PLATFORM_FEE,
    kind: AccountKind.REVENUE,
    normalBalance: 'credit',
    label: 'Taxa da plataforma',
    description: 'Taxa da plataforma sobre a transação.',
  },
  {
    code: ACCOUNT.CUSTOMER_CREDIT,
    kind: AccountKind.LIABILITY,
    normalBalance: 'credit',
    label: 'Crédito do cliente',
    description: 'Crédito do cliente vindo de downgrade ou estorno parcial.',
  },
  {
    code: ACCOUNT.MERCHANT_REFUNDS,
    kind: AccountKind.CONTRA_REVENUE,
    normalBalance: 'debit',
    label: 'Estornos',
    description: 'Estornos concedidos, deduzidos da receita.',
  },
];

const BY_CODE = new Map<string, AccountDefinition>(
  CHART_OF_ACCOUNTS.map((definition) => [definition.code, definition]),
);

export function isAccountCode(code: string): code is AccountCode {
  return BY_CODE.has(code);
}

export function accountDefinition(code: AccountCode): AccountDefinition {
  const definition = BY_CODE.get(code);

  if (definition === undefined) {
    throw new Error(`Conta ${code} não existe no plano de contas.`);
  }

  return definition;
}
