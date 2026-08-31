import { Money } from '@paynow/money';

import type { AccountCode } from './chart-of-accounts';
import { UnbalancedEntryError, EmptyEntryError } from './ledger.errors';

/**
 * Uma perna do lançamento.
 *
 * Convenção de sinal único, conforme docs/plano-de-contas.md: valor positivo e
 * débito na conta, negativo é crédito. Uma coluna em vez de duas, e o
 * invariante "débitos igualam créditos" vira a verificação mais simples
 * possível, que é somar e comparar com zero.
 */
export interface EntryLine {
  readonly account: AccountCode;
  readonly amount: Money;
}

export interface DraftEntry {
  readonly lines: readonly EntryLine[];
}

/**
 * Confere que o lançamento esta balanceado, por moeda.
 *
 * O banco também verifica, e e ele quem garante: esta função existe para
 * falhar cedo, com uma mensagem que diz qual moeda sobrou e quanto, em vez de
 * deixar o erro aparecer no commit como violação de constraint.
 *
 * Agrupar por moeda em vez de somar tudo mantém a regra correta se um
 * lançamento vier a envolver mais de uma moeda.
 */
export function assertBalanced(draft: DraftEntry): void {
  if (draft.lines.length < 2) {
    throw new EmptyEntryError(draft.lines.length);
  }

  const byCurrency = new Map<string, Money>();

  for (const line of draft.lines) {
    const currency = line.amount.currencyCode;
    const running = byCurrency.get(currency) ?? Money.zero(currency);
    byCurrency.set(currency, running.plus(line.amount));
  }

  const unbalanced = [...byCurrency.values()].filter((total) => !total.isZero());

  if (unbalanced.length > 0) {
    throw new UnbalancedEntryError(unbalanced);
  }
}

/** Soma dos débitos do lançamento, por moeda. Usado em relatório e conferência. */
export function debitTotals(draft: DraftEntry): Map<string, Money> {
  return totalsWhere(draft, (line) => line.amount.isPositive());
}

/** Soma dos créditos, em valor absoluto. */
export function creditTotals(draft: DraftEntry): Map<string, Money> {
  return totalsWhere(draft, (line) => line.amount.isNegative());
}

function totalsWhere(
  draft: DraftEntry,
  predicate: (line: EntryLine) => boolean,
): Map<string, Money> {
  const totals = new Map<string, Money>();

  for (const line of draft.lines) {
    if (!predicate(line)) {
      continue;
    }

    const currency = line.amount.currencyCode;
    const running = totals.get(currency) ?? Money.zero(currency);
    totals.set(currency, running.plus(line.amount.abs()));
  }

  return totals;
}
