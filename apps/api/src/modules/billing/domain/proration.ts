import { BillingInterval } from '@prisma/client';
import { type Money } from '@paynow/money';

import { addCalendarMonths, addDays, differenceInDays } from '../../platform/clock/duration';

/**
 * Rateio proporcional na troca de plano.
 *
 * É onde a maioria dos sistemas de cobrança erra em silêncio, porque o erro
 * não quebra nada: só produz um valor um pouco diferente do justo, e ninguém
 * confere. O desenho aqui evita isso de três formas.
 *
 * Primeira: tudo em unidade mínima, sem ponto flutuante em lugar nenhum
 * (ADR-0002).
 *
 * Segunda: a proporção é aplicada como fração exata, com um único
 * arredondamento no fim, e não como multiplicação por um decimal já
 * arredondado. `valor.multiplyRatio(diasRestantes, diasDoCiclo)` erra no
 * máximo meio centavo; `valor * (diasRestantes / diasDoCiclo)` acumula erro a
 * cada operação.
 *
 * Terceira: o crédito do plano antigo e a cobrança do novo são calculados
 * separadamente e só depois subtraídos. Calcular a diferença de preço e
 * ratear o resultado dá outro número quando os dois planos têm ciclos
 * diferentes, e dá o número errado.
 *
 * A contagem é em dias corridos, e não em milissegundos, porque é assim que a
 * fatura é explicada para quem paga: "você usou 15 dos 30 dias".
 */

export interface ProrationInput {
  /** Preço do plano que está saindo, por ciclo. */
  readonly currentAmount: Money;
  /** Preço do plano que está entrando, por ciclo. */
  readonly nextAmount: Money;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** Instante da troca, vindo do relógio injetado. */
  readonly changedAt: Date;
}

export interface Proration {
  /** Crédito pelo que não foi usado do plano antigo. */
  readonly credit: Money;
  /** Cobrança pelo proporcional do plano novo. */
  readonly charge: Money;
  /** Cobrança menos crédito. Negativo significa saldo a favor do cliente. */
  readonly net: Money;
  readonly remainingDays: number;
  readonly cycleDays: number;
}

/**
 * Calcula o rateio de uma troca de plano no meio do ciclo.
 *
 * Uma troca no primeiro instante do ciclo credita tudo e cobra tudo; no último
 * dia, não credita nem cobra nada. Os dois extremos têm teste.
 */
export function prorate(input: ProrationInput): Proration {
  const cycleDays = differenceInDays(input.periodEnd, input.periodStart);
  const usedDays = Math.min(
    Math.max(differenceInDays(input.changedAt, input.periodStart), 0),
    cycleDays,
  );
  const remainingDays = cycleDays - usedDays;

  const credit = input.currentAmount.multiplyRatio(remainingDays, cycleDays);
  const charge = input.nextAmount.multiplyRatio(remainingDays, cycleDays);

  return {
    credit,
    charge,
    net: charge.minus(credit),
    remainingDays,
    cycleDays,
  };
}

/**
 * Fim do ciclo a partir do início e do intervalo do preço.
 *
 * Mês e ano usam calendário, e não dias corridos: quem assina dia 31 de janeiro
 * espera ser cobrado dia 28 de fevereiro, e não dia 2 de março. O ajuste vive
 * em `platform/clock/duration`, junto com o resto da aritmética de tempo, pela
 * mesma razão da ADR-0009: módulo de domínio não manipula `Date` diretamente.
 */
export function nextPeriodEnd(start: Date, interval: BillingInterval, intervalCount: number): Date {
  switch (interval) {
    case BillingInterval.DAY:
      return addDays(start, intervalCount);

    case BillingInterval.WEEK:
      return addDays(start, intervalCount * 7);

    case BillingInterval.MONTH:
      return addCalendarMonths(start, intervalCount);

    case BillingInterval.YEAR:
      return addCalendarMonths(start, intervalCount * 12);
  }
}
