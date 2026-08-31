import { Money } from '@paynow/money';

import type { AccountCode } from './chart-of-accounts';
import { UnbalancedEntryError, EmptyEntryError } from './ledger.errors';

/**
 * Uma perna do lancamento.
 *
 * Convencao de sinal unico, conforme docs/plano-de-contas.md: valor positivo e
 * debito na conta, negativo e credito. Uma coluna em vez de duas, e o
 * invariante "debitos igualam creditos" vira a verificacao mais simples
 * possivel, que e somar e comparar com zero.
 */
export interface EntryLine {
  readonly account: AccountCode;
  readonly amount: Money;
}

export interface DraftEntry {
  readonly lines: readonly EntryLine[];
}

/**
 * Confere que o lancamento esta balanceado, por moeda.
 *
 * O banco tambem verifica, e e ele quem garante: esta funcao existe para
 * falhar cedo, com uma mensagem que diz qual moeda sobrou e quanto, em vez de
 * deixar o erro aparecer no commit como violacao de constraint.
 *
 * Agrupar por moeda em vez de somar tudo mantem a regra correta se um
 * lancamento vier a envolver mais de uma moeda.
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

/** Soma dos debitos do lancamento, por moeda. Usado em relatorio e conferencia. */
export function debitTotals(draft: DraftEntry): Map<string, Money> {
  return totalsWhere(draft, (line) => line.amount.isPositive());
}

/** Soma dos creditos, em valor absoluto. */
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
