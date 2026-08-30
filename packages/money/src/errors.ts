/**
 * Erros do pacote monetario.
 *
 * Todos herdam de MoneyError para que a borda da API consiga distinguir
 * "o valor enviado e invalido" (erro do cliente) de qualquer outra falha.
 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Operacao entre valores de moedas diferentes. Nunca ha conversao implicita. */
export class CurrencyMismatchError extends MoneyError {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(
      `Operacao entre moedas diferentes: ${left} e ${right}. ` +
        'Converta explicitamente antes de operar.',
    );
  }
}

/** Codigo de moeda fora da tabela suportada. */
export class UnknownCurrencyError extends MoneyError {
  constructor(readonly code: string) {
    super(`Moeda desconhecida: ${code}.`);
  }
}

/** Valor que nao pode ser representado como inteiro em unidade minima. */
export class InvalidAmountError extends MoneyError {}

/** Pesos invalidos em uma distribuicao de valor. */
export class AllocationError extends MoneyError {}
