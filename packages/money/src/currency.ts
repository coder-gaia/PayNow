import { UnknownCurrencyError } from './errors';

/**
 * Tabela de moedas suportadas.
 *
 * O expoente vem da ISO 4217 e não e assumido como 2: JPY não tem casas
 * decimais, e tratar toda moeda como se tivesse centavos é um erro comum que
 * só aparece quando já e tarde.
 */
export const CURRENCIES = {
  BRL: { code: 'BRL', exponent: 2, symbol: 'R$' },
  USD: { code: 'USD', exponent: 2, symbol: '$' },
  EUR: { code: 'EUR', exponent: 2, symbol: '€' },
  JPY: { code: 'JPY', exponent: 0, symbol: '¥' },
} as const satisfies Record<string, Currency>;

export interface Currency {
  /** Código ISO 4217 de três letras. */
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

/** Resolve um código para a moeda correspondente, ou lanca UnknownCurrencyError. */
export function currencyOf(code: string): Currency {
  const normalized = code.toUpperCase();
  if (!isCurrencyCode(normalized)) {
    throw new UnknownCurrencyError(code);
  }
  return CURRENCIES[normalized];
}
