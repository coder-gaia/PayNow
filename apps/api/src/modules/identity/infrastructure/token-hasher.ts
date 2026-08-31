import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * Geracao e verificacao de segredos opacos: chaves de API e refresh tokens.
 *
 * Estes segredos usam SHA-256, e nao Argon2, e a diferenca e proposital.
 *
 * Argon2 existe para compensar entropia baixa: uma senha escolhida por uma
 * pessoa precisa que cada tentativa seja cara. Um segredo gerado aqui tem 256
 * bits de aleatoriedade criptografica, entao forca bruta ja e inviavel por
 * construcao, e o hash lento so acrescentaria latencia em um caminho que roda
 * a cada request autenticado por chave.
 *
 * O que continua valendo e a comparacao em tempo constante, que evita que o
 * tempo de resposta revele quantos bytes do segredo o atacante acertou.
 */
@Injectable()
export class TokenHasher {
  /** 32 bytes, codificados em base64url: 43 caracteres seguros para URL. */
  private static readonly SECRET_BYTES = 32;

  /** Gera um segredo novo. O valor so existe em memoria e na resposta. */
  generateSecret(): string {
    return randomBytes(TokenHasher.SECRET_BYTES).toString('base64url');
  }

  hash(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  /** Compara em tempo constante. Falso quando o formato nao bate. */
  matches(secret: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(secret), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');

    if (actual.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(actual, expected);
  }
}
