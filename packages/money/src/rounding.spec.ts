import { InvalidAmountError } from './errors';
import { divideRounded, type RoundingMode } from './rounding';

describe('divideRounded', () => {
  it('recusa divisão por zero', () => {
    expect(() => divideRounded(10n, 0n)).toThrow(InvalidAmountError);
  });

  it('devolve o quociente exato quando não há resto', () => {
    expect(divideRounded(100n, 4n)).toBe(25n);
    expect(divideRounded(-100n, 4n)).toBe(-25n);
    expect(divideRounded(100n, -4n)).toBe(-25n);
  });

  // A tabela abaixo e o contrato do arredondamento. Os casos negativos existem
  // porque são exatamente onde implementações caseiras costumam divergir.
  const cases: ReadonlyArray<[bigint, bigint, RoundingMode, bigint]> = [
    // empate exato em 2.5
    [5n, 2n, 'half-even', 2n],
    [5n, 2n, 'half-up', 3n],
    [5n, 2n, 'half-down', 2n],
    [5n, 2n, 'floor', 2n],
    [5n, 2n, 'ceil', 3n],
    [5n, 2n, 'truncate', 2n],

    // empate exato em 3.5, onde half-even sobe para o par
    [7n, 2n, 'half-even', 4n],
    [7n, 2n, 'half-up', 4n],
    [7n, 2n, 'half-down', 3n],

    // empate exato em -2.5
    [-5n, 2n, 'half-even', -2n],
    [-5n, 2n, 'half-up', -3n],
    [-5n, 2n, 'half-down', -2n],
    [-5n, 2n, 'floor', -3n],
    [-5n, 2n, 'ceil', -2n],
    [-5n, 2n, 'truncate', -2n],

    // sem empate, abaixo da metade
    [10n, 3n, 'half-even', 3n],
    [10n, 3n, 'half-up', 3n],
    [10n, 3n, 'floor', 3n],
    [10n, 3n, 'ceil', 4n],

    // sem empate, acima da metade
    [11n, 3n, 'half-even', 4n],
    [11n, 3n, 'truncate', 3n],
    [-11n, 3n, 'half-even', -4n],
    [-11n, 3n, 'floor', -4n],
    [-11n, 3n, 'ceil', -3n],
    [-11n, 3n, 'truncate', -3n],
  ];

  it.each(cases)('divideRounded(%s, %s, %s) = %s', (num, den, mode, expected) => {
    expect(divideRounded(num, den, mode)).toBe(expected);
  });

  it('usa half-even como padrão', () => {
    expect(divideRounded(5n, 2n)).toBe(divideRounded(5n, 2n, 'half-even'));
  });

  it('trata denominador negativo como inversao de sinal', () => {
    expect(divideRounded(5n, -2n, 'half-up')).toBe(-3n);
    expect(divideRounded(-5n, -2n, 'half-up')).toBe(3n);
  });
});
