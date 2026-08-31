import { currencyOf, type Currency } from './currency';
import { AllocationError, CurrencyMismatchError, InvalidAmountError } from './errors';
import { DEFAULT_ROUNDING, divideRounded, type RoundingMode } from './rounding';

/** Formato de serialização. O valor viaja como string porque bigint não e JSON. */
export interface MoneyJSON {
  /** Valor em unidade mínima, como string decimal. */
  readonly amount: string;
  /** Código ISO 4217. */
  readonly currency: string;
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

function toBigInt(value: bigint | number, label: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (!Number.isInteger(value)) {
    throw new InvalidAmountError(
      `${label} precisa ser inteiro, recebeu ${String(value)}. ` +
        'Valores fracionarios não existem em unidade mínima (ADR-0002).',
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new InvalidAmountError(`${label} excede o inteiro seguro de JavaScript. Use bigint.`);
  }
  return BigInt(value);
}

/**
 * Valor monetario imutavel, representado como inteiro em unidade mínima.
 *
 * Implementa a ADR-0002. Duas propriedades sustentam o resto do sistema:
 *
 * 1. Não existe ponto flutuante em lugar nenhum do caminho.
 * 2. Nenhuma operação aceita moedas diferentes. Não há conversão implicita.
 *
 * @example
 * const preço = Money.fromDecimal('100.00', 'BRL');
 * const taxa = preço.percentage(300);          // 3% = R$ 3,00
 * const [a, b, c] = preço.split(3);            // 33,34 + 33,33 + 33,33
 */
export class Money {
  private constructor(
    /** Valor em unidade mínima da moeda. Positivo, negativo ou zero. */
    readonly minor: bigint,
    readonly currency: Currency,
  ) {
    Object.freeze(this);
  }

  // ------------------------------------------------------------------
  // construção
  // ------------------------------------------------------------------

  /** Cria a partir do valor já em unidade mínima. Ex.: 10000 centavos = R$ 100,00. */
  static fromMinor(minor: bigint | number, currency: string): Money {
    return new Money(toBigInt(minor, 'Valor em unidade mínima'), currencyOf(currency));
  }

  /**
   * Cria a partir de uma string decimal, sem passar por ponto flutuante.
   *
   * Recusa mais casas decimais do que a moeda permite, em vez de arredondar em
   * silêncio: perder centavo na borda de entrada e o pior lugar para perder.
   */
  static fromDecimal(value: string, currency: string): Money {
    const resolved = currencyOf(currency);
    const match = DECIMAL_PATTERN.exec(value.trim());

    if (match === null) {
      throw new InvalidAmountError(
        `Valor decimal inválido: "${value}". Formato esperado: "100", "100.00" ou "-4.50".`,
      );
    }

    const sign = match[1] === '-' ? -1n : 1n;
    const whole = match[2] ?? '0';
    const fraction = match[3] ?? '';

    if (fraction.length > resolved.exponent) {
      throw new InvalidAmountError(
        `"${value}" tem ${fraction.length} casas decimais, mas ${resolved.code} ` +
          `admite no máximo ${resolved.exponent}.`,
      );
    }

    const padded = fraction.padEnd(resolved.exponent, '0');
    return new Money(BigInt(whole + padded) * sign, resolved);
  }

  /** Zero na moeda informada. */
  static zero(currency: string): Money {
    return new Money(0n, currencyOf(currency));
  }

  /** Soma uma lista de valores. Lanca se a lista misturar moedas. */
  static sum(values: readonly Money[], currency?: string): Money {
    const first = values[0];
    if (first === undefined) {
      if (currency === undefined) {
        throw new AllocationError(
          'Soma de lista vazia exige que a moeda seja informada explicitamente.',
        );
      }
      return Money.zero(currency);
    }
    return values.reduce((total, value) => total.plus(value), Money.zero(first.currency.code));
  }

  // ------------------------------------------------------------------
  // aritmetica
  // ------------------------------------------------------------------

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negated(): Money {
    return new Money(-this.minor, this.currency);
  }

  abs(): Money {
    return this.minor < 0n ? this.negated() : this;
  }

  /** Multiplica por um inteiro. Exato, sem arredondamento possível. */
  times(factor: bigint | number): Money {
    return new Money(this.minor * toBigInt(factor, 'Fator'), this.currency);
  }

  /**
   * Multiplica por uma fracao exata, arredondando uma única vez no fim.
   *
   * Usado por rateio proporcional: `valor.multiplyRatio(diasUsados, diasDoCiclo)`.
   */
  multiplyRatio(
    numerator: bigint | number,
    denominator: bigint | number,
    rounding: RoundingMode = DEFAULT_ROUNDING,
  ): Money {
    const num = toBigInt(numerator, 'Numerador');
    const den = toBigInt(denominator, 'Denominador');
    return new Money(divideRounded(this.minor * num, den, rounding), this.currency);
  }

  /**
   * Aplica um percentual expresso em pontos base, evitando decimal na entrada.
   * 300 pontos base = 3%. 25 = 0,25%.
   */
  percentage(basisPoints: bigint | number, rounding: RoundingMode = DEFAULT_ROUNDING): Money {
    return this.multiplyRatio(basisPoints, 10_000n, rounding);
  }

  // ------------------------------------------------------------------
  // distribuição
  // ------------------------------------------------------------------

  /**
   * Distribui o valor entre partes proporcionais aos pesos, garantindo que a
   * soma das partes seja exatamente igual ao valor original.
   *
   * Esta e a resposta do Paynow ao arredondamento em rateio: em vez de escolher
   * um modo e aceitar a sobra, o resto e distribuido unidade a unidade. A
   * conservacao do total é propriedade de construção, e não consequência de
   * sorte no arredondamento.
   *
   * O resto vai para as partes com maior fracao pendente, e não para as
   * primeiras da lista. Isso e o metodo do maior resto, e ele garante uma
   * propriedade que a distribuição por ordem de índice não garante: **nenhuma
   * parte se afasta uma unidade mínima inteira da sua fracao exata**. Uma parte
   * cuja fracao exata já e inteira nunca recebe sobra.
   *
   * O empate é resolvido pelo menor índice, então o resultado é determinístico
   * e reproduzível.
   *
   * @example
   * Money.fromDecimal('100.00', 'BRL').allocate([1, 1, 1]);
   * // R$ 33,34 + R$ 33,33 + R$ 33,33 = R$ 100,00
   */
  allocate(weights: readonly (bigint | number)[]): Money[] {
    if (weights.length === 0) {
      throw new AllocationError('E preciso informar ao menos um peso.');
    }

    const parsed = weights.map((weight, index) => {
      const value = toBigInt(weight, `Peso na posição ${index}`);
      if (value < 0n) {
        throw new AllocationError(`Peso negativo na posição ${index}: ${value.toString()}.`);
      }
      return value;
    });

    const totalWeight = parsed.reduce((total, weight) => total + weight, 0n);
    if (totalWeight === 0n) {
      throw new AllocationError('A soma dos pesos precisa ser maior que zero.');
    }

    // Primeira passada: parte inteira, truncada em direcao ao zero.
    const shares = parsed.map((weight) => (this.minor * weight) / totalWeight);
    let remainder = this.minor - shares.reduce((total, share) => total + share, 0n);

    if (remainder === 0n) {
      return shares.map((share) => new Money(share, this.currency));
    }

    // Fracao pendente de cada parte, ainda multiplicada por totalWeight para
    // continuar em inteiros. Comparar estes numeradores equivale a comparar as
    // frações, sem introduzir divisão e sem introduzir ponto flutuante.
    const pending = parsed.map((weight, index) => {
      const exactNumerator = this.minor * weight;
      const takenNumerator = (shares[index] ?? 0n) * totalWeight;
      const gap = exactNumerator - takenNumerator;
      return { index, gap: gap < 0n ? -gap : gap };
    });

    // Segunda passada: as sobras vao para as maiores fracoes pendentes, com
    // empate resolvido pelo menor índice. Parte sem fracao pendente tem gap
    // zero e fica no fim, então nunca recebe sobra.
    const queue = pending
      .filter((entry) => entry.gap > 0n)
      .sort((left, right) => {
        if (left.gap !== right.gap) return left.gap > right.gap ? -1 : 1;
        return left.index - right.index;
      });

    const step = remainder < 0n ? -1n : 1n;
    for (const { index } of queue) {
      if (remainder === 0n) break;
      shares[index] = (shares[index] ?? 0n) + step;
      remainder -= step;
    }

    return shares.map((share) => new Money(share, this.currency));
  }

  /** Divide em partes iguais, distribuindo a sobra entre as primeiras. */
  split(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new AllocationError(`Número de partes precisa ser inteiro positivo, recebeu ${parts}.`);
    }
    return this.allocate(Array.from({ length: parts }, () => 1));
  }

  // ------------------------------------------------------------------
  // comparação
  // ------------------------------------------------------------------

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency.code === other.currency.code && this.minor === other.minor;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  // ------------------------------------------------------------------
  // representacao
  // ------------------------------------------------------------------

  get currencyCode(): string {
    return this.currency.code;
  }

  /** Representacao decimal exata, sem simbolo. Ex.: "-1234.50". */
  toDecimalString(): string {
    const { exponent } = this.currency;
    const negative = this.minor < 0n;
    const digits = (negative ? -this.minor : this.minor).toString().padStart(exponent + 1, '0');

    const whole = digits.slice(0, digits.length - exponent);
    const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';

    return `${negative ? '-' : ''}${whole}${fraction}`;
  }

  /** Ex.: "R$ 1234.50". Para exibicao ao usuário final, use Intl na camada de UI. */
  toString(): string {
    return `${this.currency.symbol} ${this.toDecimalString()}`;
  }

  toJSON(): MoneyJSON {
    return { amount: this.minor.toString(), currency: this.currency.code };
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.fromMinor(BigInt(json.amount), json.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency.code !== other.currency.code) {
      throw new CurrencyMismatchError(this.currency.code, other.currency.code);
    }
  }
}
