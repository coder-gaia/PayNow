import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com Argon2id.
 *
 * Senha e segredo de entropia baixa: uma pessoa escolhe, e boa parte das
 * escolhas cabe em uma lista. A defesa e tornar cada tentativa cara, e por isso
 * o algoritmo e deliberadamente lento e consome memoria.
 *
 * Isso e o oposto do que se quer para chave de API e refresh token, que sao
 * aleatorios de entropia alta e precisam de verificacao rapida. Esses usam
 * SHA-256, e o motivo esta em token-hasher.ts.
 *
 * Parametros conforme a recomendacao de primeira escolha do OWASP para
 * Argon2id: 19 MiB de memoria, duas iteracoes e paralelismo 1.
 */
@Injectable()
export class PasswordHasher {
  private static readonly OPTIONS = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  private dummy?: Promise<string>;

  hash(plain: string): Promise<string> {
    return hash(plain, PasswordHasher.OPTIONS);
  }

  /**
   * Verificacao contra um hash descartavel, usada quando o email nao existe.
   *
   * Devolve sempre falso, mas gasta o mesmo tempo de uma verificacao real. Sem
   * isso, a diferenca de latencia entre "email inexistente" e "senha errada"
   * transforma o login em um verificador de quais emails estao cadastrados.
   *
   * O hash e gerado uma unica vez, sob demanda, a partir de bytes aleatorios:
   * um literal fixo no codigo nao passaria pelo parser do Argon2 e retornaria
   * rapido demais, justamente perdendo a propriedade que se quer.
   */
  async verifyAgainstDummy(plain: string): Promise<boolean> {
    this.dummy ??= this.hash(randomBytes(32).toString('hex'));
    return this.verify(await this.dummy, plain);
  }

  /**
   * Verifica a senha. Devolve falso em vez de lancar quando o hash gravado esta
   * corrompido ou em formato desconhecido, para que a resposta ao usuario seja
   * a mesma de senha errada e nao revele o estado interno.
   */
  async verify(digest: string, plain: string): Promise<boolean> {
    try {
      return await verify(digest, plain, PasswordHasher.OPTIONS);
    } catch {
      return false;
    }
  }
}
