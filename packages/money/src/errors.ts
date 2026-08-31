/**
 * Erros do pacote monetario.
 *
 * Todos herdam de MoneyError para que a borda da API consiga distinguir
 * "o valor enviado e inválido" (erro do cliente) de qualquer outra falha.
 */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Operação entre valores de moedas diferentes. Nunca há conversão implicita. */
export class CurrencyMismatchError extends MoneyError {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(
      `Operação entre moedas diferentes: ${left} e ${right}. ` +
        'Converta explicitamente antes de operar.',
    );
  }
}

/** Código de moeda fora da tabela suportada. */
export class UnknownCurrencyError extends MoneyError {
  constructor(readonly code: string) {
    super(`Moeda desconhecida: ${code}.`);
  }
}

/** Valor que não pode ser representado como inteiro em unidade mínima. */
export class InvalidAmountError extends MoneyError {}

/** Pesos inválidos em uma distribuição de valor. */
export class AllocationError extends MoneyError {}
