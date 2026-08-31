/**
 * Ensina o JSON a serializar bigint.
 *
 * Esta e a consequência negativa prevista na ADR-0002: valores monetarios são
 * inteiros em unidade mínima, e `JSON.stringify` lanca TypeError ao encontrar
 * um bigint.
 *
 * Alternativas consideradas e rejeitadas:
 *
 *   Interceptor global que percorre a resposta convertendo bigint em string.
 *   Custo por request em todo endpoint, inclusive nos que não tem valor
 *   monetario, para resolver um problema que é de serialização e não de
 *   apresentação.
 *
 *   Converter na fronteira de cada DTO. Espalha a regra por dezenas de lugares
 *   e depende de disciplina, que é exatamente o que este projeto evita.
 *
 * A escolha e alterar o prototipo uma única vez, no boot, de forma explicita e
 * documentada. Bigint vira string em JSON, nunca number, porque number
 * reintroduziria a perda de precisao que a ADR-0002 existe para eliminar.
 *
 * Este arquivo precisa ser importado antes de qualquer serialização acontecer.
 */
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function toJSON(this: bigint): string {
  return this.toString();
};

export {};
