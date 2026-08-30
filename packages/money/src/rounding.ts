import { InvalidAmountError } from './errors';

/**
 * Modos de arredondamento suportados.
 *
 * O padrao do Paynow e `half-even` (arredondamento bancario), porque ele nao
 * enviesa somas grandes sempre na mesma direcao, como o `half-up` faz.
 * O modo e sempre explicito na assinatura das operacoes que arredondam.
 */
export type RoundingMode =
  /** Empate vai para o vizinho par. Padrao do sistema. */
  | 'half-even'
  /** Empate se afasta do zero. */
  | 'half-up'
  /** Empate se aproxima do zero. */
  | 'half-down'
  /** Sempre para menos infinito. */
  | 'floor'
  /** Sempre para mais infinito. */
  | 'ceil'
  /** Sempre em direcao ao zero, descartando a fracao. */
  | 'truncate';

export const DEFAULT_ROUNDING: RoundingMode = 'half-even';

/**
 * Divide dois inteiros arbitrarios aplicando o modo de arredondamento pedido.
 *
 * Toda a aritmetica com fracao do sistema passa por aqui. Concentrar o
 * arredondamento em uma funcao unica e o que torna possivel testa-lo de forma
 * exaustiva, inclusive nos casos negativos, onde a maioria das implementacoes
 * caseiras erra.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = DEFAULT_ROUNDING,
): bigint {
  if (denominator === 0n) {
    throw new InvalidAmountError('Divisao por zero.');
  }

  // Normaliza para denominador positivo, o que simplifica o raciocinio de sinal.
  const num = denominator < 0n ? -numerator : numerator;
  const den = denominator < 0n ? -denominator : denominator;

  const quotient = num / den; // trunca em direcao ao zero
  const remainder = num % den; // carrega o sinal de num

  if (remainder === 0n) {
    return quotient;
  }

  const negative = num < 0n;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const twiceRemainder = absRemainder * 2n;
  const awayFromZero = negative ? quotient - 1n : quotient + 1n;

  switch (mode) {
    case 'truncate':
      return quotient;

    case 'floor':
      return negative ? quotient - 1n : quotient;

    case 'ceil':
      return negative ? quotient : quotient + 1n;

    case 'half-up':
      return twiceRemainder >= den ? awayFromZero : quotient;

    case 'half-down':
      return twiceRemainder > den ? awayFromZero : quotient;

    case 'half-even':
      if (twiceRemainder > den) return awayFromZero;
      if (twiceRemainder < den) return quotient;
      return quotient % 2n === 0n ? quotient : awayFromZero;
  }
}
