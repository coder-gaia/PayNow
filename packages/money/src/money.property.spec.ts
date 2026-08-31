import fc from 'fast-check';

import { Money } from './money';
import { divideRounded, type RoundingMode } from './rounding';

/**
 * Testes de propriedade do nucleo monetario.
 *
 * Enquanto os testes de exemplo confirmam casos escolhidos a mão, estes
 * afirmam invariantes sobre entradas geradas. E o mesmo raciocinio que a fase
 * 02 aplica ao ledger inteiro: não verificar que um caso funciona, e sim que
 * uma propriedade nunca deixa de valer.
 */

/** Até um trilhao de unidades minimas, positivo ou negativo. */
const anyMinor = fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n });

/** Pesos de rateio com ao menos um positivo. */
const anyWeights = fc
  .array(fc.nat({ max: 10_000 }), { minLength: 1, maxLength: 12 })
  .filter((weights) => weights.some((weight) => weight > 0));

const ROUNDING_MODES: readonly RoundingMode[] = [
  'half-even',
  'half-up',
  'half-down',
  'floor',
  'ceil',
  'truncate',
];

const anyRounding = fc.constantFrom(...ROUNDING_MODES);

const money = (minor: bigint): Money => Money.fromMinor(minor, 'BRL');

describe('propriedades de Money', () => {
  describe('allocate', () => {
    it('a soma das partes é sempre igual ao valor original', () => {
      fc.assert(
        fc.property(anyMinor, anyWeights, (minor, weights) => {
          const original = money(minor);
          const parts = original.allocate(weights);

          expect(Money.sum(parts).equals(original)).toBe(true);
        }),
      );
    });

    it('devolve exatamente uma parte por peso', () => {
      fc.assert(
        fc.property(anyMinor, anyWeights, (minor, weights) => {
          expect(money(minor).allocate(weights)).toHaveLength(weights.length);
        }),
      );
    });

    it('cada parte fica a menos de uma unidade mínima da fracao exata', () => {
      fc.assert(
        fc.property(anyMinor, anyWeights, (minor, weights) => {
          const parts = money(minor).allocate(weights);
          const totalWeight = weights.reduce((total, weight) => total + BigInt(weight), 0n);

          parts.forEach((part, index) => {
            const exactNumerator = minor * BigInt(weights[index]!);
            const deviation = part.minor * totalWeight - exactNumerator;
            const absDeviation = deviation < 0n ? -deviation : deviation;

            expect(absDeviation < totalWeight).toBe(true);
          });
        }),
      );
    });

    it('parte com fracao exata inteira nunca recebe sobra', () => {
      fc.assert(
        fc.property(anyMinor, anyWeights, (minor, weights) => {
          const parts = money(minor).allocate(weights);
          const totalWeight = weights.reduce((total, weight) => total + BigInt(weight), 0n);

          parts.forEach((part, index) => {
            const exactNumerator = minor * BigInt(weights[index]!);
            if (exactNumerator % totalWeight === 0n) {
              expect(part.minor).toBe(exactNumerator / totalWeight);
            }
          });
        }),
      );
    });

    it('peso zero nunca recebe valor', () => {
      fc.assert(
        fc.property(anyMinor, anyWeights, (minor, weights) => {
          const parts = money(minor).allocate(weights);

          weights.forEach((weight, index) => {
            if (weight === 0) {
              expect(parts[index]!.isZero()).toBe(true);
            }
          });
        }),
      );
    });

    it('split preserva o total para qualquer número de partes', () => {
      fc.assert(
        fc.property(anyMinor, fc.integer({ min: 1, max: 50 }), (minor, parts) => {
          const original = money(minor);

          expect(Money.sum(original.split(parts)).equals(original)).toBe(true);
        }),
      );
    });
  });

  describe('aritmetica', () => {
    it('soma e comutativa', () => {
      fc.assert(
        fc.property(anyMinor, anyMinor, (a, b) => {
          expect(
            money(a)
              .plus(money(b))
              .equals(money(b).plus(money(a))),
          ).toBe(true);
        }),
      );
    });

    it('soma e associativa', () => {
      fc.assert(
        fc.property(anyMinor, anyMinor, anyMinor, (a, b, c) => {
          const left = money(a).plus(money(b)).plus(money(c));
          const right = money(a).plus(money(b).plus(money(c)));

          expect(left.equals(right)).toBe(true);
        }),
      );
    });

    it('subtrair desfaz somar', () => {
      fc.assert(
        fc.property(anyMinor, anyMinor, (a, b) => {
          expect(money(a).plus(money(b)).minus(money(b)).equals(money(a))).toBe(true);
        }),
      );
    });

    it('negar duas vezes e identidade', () => {
      fc.assert(
        fc.property(anyMinor, (a) => {
          expect(money(a).negated().negated().equals(money(a))).toBe(true);
        }),
      );
    });

    it('multiplicar por uma razão de termos iguais e identidade', () => {
      fc.assert(
        fc.property(anyMinor, fc.integer({ min: 1, max: 10_000 }), anyRounding, (a, n, mode) => {
          expect(money(a).multiplyRatio(n, n, mode).equals(money(a))).toBe(true);
        }),
      );
    });
  });

  describe('representacao', () => {
    it('a string decimal sempre volta ao mesmo valor', () => {
      fc.assert(
        fc.property(anyMinor, (minor) => {
          const original = money(minor);
          const roundTrip = Money.fromDecimal(original.toDecimalString(), 'BRL');

          expect(roundTrip.equals(original)).toBe(true);
        }),
      );
    });

    it('a serialização JSON sempre volta ao mesmo valor', () => {
      fc.assert(
        fc.property(anyMinor, (minor) => {
          const original = money(minor);

          expect(Money.fromJSON(original.toJSON()).equals(original)).toBe(true);
        }),
      );
    });
  });

  describe('divideRounded', () => {
    const nonZero = fc
      .bigInt({ min: -1_000_000n, max: 1_000_000n })
      .filter((value) => value !== 0n);

    it('nunca se afasta mais de uma unidade do quociente truncado', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }),
          nonZero,
          anyRounding,
          (numerator, denominator, mode) => {
            const truncated = numerator / denominator;
            const rounded = divideRounded(numerator, denominator, mode);
            const distance = rounded - truncated;

            expect(distance === -1n || distance === 0n || distance === 1n).toBe(true);
          },
        ),
      );
    });

    it('half-even nunca erra mais do que meia unidade', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }),
          nonZero,
          (numerator, denominator) => {
            const rounded = divideRounded(numerator, denominator, 'half-even');

            // |rounded * den - num| * 2 <= |den|
            const residual = rounded * denominator - numerator;
            const absResidual = residual < 0n ? -residual : residual;
            const absDenominator = denominator < 0n ? -denominator : denominator;

            expect(absResidual * 2n <= absDenominator).toBe(true);
          },
        ),
      );
    });

    it('trocar o sinal do numerador e do denominador não muda o resultado', () => {
      fc.assert(
        fc.property(
          fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
          nonZero,
          anyRounding,
          (numerator, denominator, mode) => {
            expect(divideRounded(numerator, denominator, mode)).toBe(
              divideRounded(-numerator, -denominator, mode),
            );
          },
        ),
      );
    });
  });
});
