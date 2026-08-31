import { Inject, Injectable } from '@nestjs/common';
import { ApiKeyEnvironment } from '@prisma/client';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ApiKeyNotFoundError } from '../domain/identity.errors';
import { TokenHasher } from '../infrastructure/token-hasher';

/** Quantos caracteres do segredo entram no prefixo visível. */
const PREFIX_SAMPLE_LENGTH = 8;

const ENVIRONMENT_LABEL: Readonly<Record<ApiKeyEnvironment, string>> = {
  [ApiKeyEnvironment.TEST]: 'test',
  [ApiKeyEnvironment.LIVE]: 'live',
};

export interface CreatedApiKey {
  readonly id: string;
  readonly name: string;
  readonly environment: ApiKeyEnvironment;
  readonly prefix: string;
  /** Segredo completo. Devolvido uma única vez, nunca recuperável depois. */
  readonly secret: string;
  readonly createdAt: Date;
}

export interface AuthenticatedApiKey {
  readonly apiKeyId: string;
  readonly organizationId: string;
  readonly environment: ApiKeyEnvironment;
}

/**
 * Chaves de API do merchant.
 *
 * Formato: `sk_test_<segredo>` ou `sk_live_<segredo>`, com o segredo em
 * base64url de 32 bytes. O banco guarda o prefixo, que é `sk_test_` mais os
 * oito primeiros caracteres do segredo, e o hash do valor inteiro.
 *
 * O prefixo tem duas funções: permite achar a linha por índice sem varrer a
 * tabela comparando hashes, e da a interface algo para exibir depois que o
 * segredo some, do jeito que qualquer painel de pagamentos faz.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: TokenHasher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(organizationId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      environment: key.environment,
      prefix: key.prefix,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      createdAt: key.createdAt,
    }));
  }

  async create(
    organizationId: string,
    name: string,
    environment: ApiKeyEnvironment,
  ): Promise<CreatedApiKey> {
    const secretPart = this.hasher.generateSecret();
    const namespace = `sk_${ENVIRONMENT_LABEL[environment]}_`;
    const secret = `${namespace}${secretPart}`;
    const prefix = `${namespace}${secretPart.slice(0, PREFIX_SAMPLE_LENGTH)}`;

    const created = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: name.trim(),
        environment,
        prefix,
        tokenHash: this.hasher.hash(secret),
      },
    });

    return {
      id: created.id,
      name: created.name,
      environment: created.environment,
      prefix: created.prefix,
      secret,
      createdAt: created.createdAt,
    };
  }

  async revoke(organizationId: string, apiKeyId: string): Promise<void> {
    const revoked = await this.prisma.apiKey.updateMany({
      where: { id: apiKeyId, organizationId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });

    if (revoked.count === 0) {
      throw new ApiKeyNotFoundError();
    }
  }

  /**
   * Resolve uma chave apresentada em um request.
   *
   * Devolve null para qualquer falha, sem distinguir chave inexistente de
   * chave revogada: quem apresenta uma chave inválida não tem direito a saber
   * qual dos dois casos ocorreu.
   */
  async authenticate(presented: string): Promise<AuthenticatedApiKey | null> {
    const prefix = extractPrefix(presented);

    if (prefix === null) {
      return null;
    }

    const key = await this.prisma.apiKey.findUnique({ where: { prefix } });

    if (key === null || key.revokedAt !== null) {
      return null;
    }

    if (!this.hasher.matches(presented, key.tokenHash)) {
      return null;
    }

    // Registro de uso sem bloquear a resposta: saber que a chave esta viva vale
    // muito na operação, mas não vale somar uma escrita a latência de cada
    // request autenticado.
    void this.touch(key.id);

    return {
      apiKeyId: key.id,
      organizationId: key.organizationId,
      environment: key.environment,
    };
  }

  private async touch(apiKeyId: string): Promise<void> {
    try {
      await this.prisma.apiKey.update({
        where: { id: apiKeyId },
        data: { lastUsedAt: this.clock.now() },
      });
    } catch {
      // Carimbo de último uso e informação operacional. Falhar aqui não pode
      // derrubar um request que já foi autenticado com sucesso.
    }
  }
}

/** Extrai o prefixo indexado de uma chave apresentada, ou null se o formato não bate. */
function extractPrefix(presented: string): string | null {
  const match = /^(sk_(?:test|live)_)([A-Za-z0-9_-]{8,})$/.exec(presented.trim());

  if (match === null) {
    return null;
  }

  const [, namespace, secretPart] = match;

  if (namespace === undefined || secretPart === undefined) {
    return null;
  }

  return `${namespace}${secretPart.slice(0, PREFIX_SAMPLE_LENGTH)}`;
}
