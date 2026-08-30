import { UnknownCurrencyError } from './errors';

/**
 * Tabela de moedas suportadas.
 *
 * O expoente vem da ISO 4217 e nao e assumido como 2: JPY nao tem casas
 * decimais, e tratar toda moeda como se tivesse centavos e um erro comum que
 * so aparece quando ja e tarde.
 */
export const CURRENCIES = {
  BRL: { code: 'BRL', exponent: 2, symbol: 'R$' },
  USD: { code: 'USD', exponent: 2, symbol: '$' },
  EUR: { code: 'EUR', exponent: 2, symbol: '€' },
  JPY: { code: 'JPY', exponent: 0, symbol: '¥' },
} as const satisfies Record<string, Currency>;

export interface Currency {
  /** Codigo ISO 4217 de tres letras. */
  readonly code: string;
  /** Quantidade de casas decimais da moeda. */
  readonly exponent: number;
  /** Simbolo usado apenas para exibicao. */
  readonly symbol: string;
}

export type CurrencyCode = keyof typeof CURRENCIES;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

/** Resolve um codigo para a moeda correspondente, ou lanca UnknownCurrencyError. */
export function currencyOf(code: string): Currency {
  const normalized = code.toUpperCase();
  if (!isCurrencyCode(normalized)) {
    throw new UnknownCurrencyError(code);
  }
  return CURRENCIES[normalized];
}
