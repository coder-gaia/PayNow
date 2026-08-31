/**
 * Ensina o JSON a serializar bigint.
 *
 * Esta e a consequencia negativa prevista na ADR-0002: valores monetarios sao
 * inteiros em unidade minima, e `JSON.stringify` lanca TypeError ao encontrar
 * um bigint.
 *
 * Alternativas consideradas e rejeitadas:
 *
 *   Interceptor global que percorre a resposta convertendo bigint em string.
 *   Custo por request em todo endpoint, inclusive nos que nao tem valor
 *   monetario, para resolver um problema que e de serializacao e nao de
 *   apresentacao.
 *
 *   Converter na fronteira de cada DTO. Espalha a regra por dezenas de lugares
 *   e depende de disciplina, que e exatamente o que este projeto evita.
 *
 * A escolha e alterar o prototipo uma unica vez, no boot, de forma explicita e
 * documentada. Bigint vira string em JSON, nunca number, porque number
 * reintroduziria a perda de precisao que a ADR-0002 existe para eliminar.
 *
 * Este arquivo precisa ser importado antes de qualquer serializacao acontecer.
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
