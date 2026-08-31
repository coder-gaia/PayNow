import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefreshTokenRevocationReason } from '@prisma/client';

import type { Env } from '../../../config/env';
import { CLOCK, type Clock } from '../../platform/clock/clock';
import { addDays, isBefore } from '../../platform/clock/duration';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { InvalidRefreshTokenError, RefreshTokenReuseError } from '../domain/identity.errors';
import { TokenHasher } from '../infrastructure/token-hasher';

export interface IssuedRefreshToken {
  /** Segredo em claro. Existe apenas nesta resposta, nunca no banco. */
  readonly token: string;
  readonly familyId: string;
  readonly expiresAt: Date;
}

export interface RotationResult {
  readonly userId: string;
  readonly issued: IssuedRefreshToken;
}

/**
 * Refresh token com rotacao e deteccao de reuso.
 *
 * O modelo e o de familias. Cada login abre uma familia. Cada uso do refresh
 * consome o token apresentado e emite um novo na mesma familia. Um token so
 * pode ser consumido uma vez.
 *
 * Se alguem apresentar um token ja consumido, existem duas explicacoes: o
 * cliente legitimo repetiu a chamada, ou o token vazou e o atacante esta
 * usando. Nao ha como distinguir, entao o sistema assume o pior e revoga a
 * familia inteira. O usuario legitimo faz login de novo; o atacante perde o
 * acesso junto.
 *
 * A deteccao depende de consumir o token de forma atomica. Dois refreshes
 * simultaneos com o mesmo token nao podem ambos ler `consumedAt` nulo e ambos
 * prosseguir, entao o consumo e um UPDATE condicional e quem nao afetar linha
 * nenhuma perdeu a corrida, o que e tratado como reuso.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);
  private readonly ttlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: TokenHasher,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.ttlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
  }

  /** Emite um token novo. Sem `familyId`, abre uma familia, ou seja, uma sessao. */
  async issue(
    userId: string,
    options: { familyId?: string; userAgent?: string } = {},
  ): Promise<IssuedRefreshToken> {
    const token = this.hasher.generateSecret();
    const familyId = options.familyId ?? randomUUID();
    const expiresAt = addDays(this.clock.now(), this.ttlDays);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hasher.hash(token),
        expiresAt,
        userAgent: options.userAgent ?? null,
      },
    });

    return { token, familyId, expiresAt };
  }

  /**
   * Troca um refresh token por outro, ou derruba a sessao inteira se detectar
   * reuso.
   */
  async rotate(presentedToken: string, userAgent?: string): Promise<RotationResult> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hasher.hash(presentedToken) },
    });

    if (existing === null) {
      throw new InvalidRefreshTokenError();
    }

    // A ordem destas duas checagens e a diferenca entre detectar um vazamento e
    // deixar passar. A rotacao marca o token como consumido e revogado ao mesmo
    // tempo, entao testar `revokedAt` primeiro faria todo token rotacionado
    // reapresentado cair no ramo generico, e a familia nunca seria revogada.
    // Consumo e a hipotese mais grave e vem antes.
    if (existing.consumedAt !== null) {
      await this.handleReuse(existing.familyId, existing.userId);
      throw new RefreshTokenReuseError();
    }

    if (existing.revokedAt !== null) {
      // Token que morreu sem ter sido usado: logout, ou familia derrubada por
      // reuso de um irmao.
      throw existing.revokedReason === RefreshTokenRevocationReason.REUSE_DETECTED
        ? new RefreshTokenReuseError()
        : new InvalidRefreshTokenError('Sessao encerrada. Faca login novamente.');
    }

    if (isBefore(existing.expiresAt, this.clock.now())) {
      throw new InvalidRefreshTokenError();
    }

    // Consumo atomico: quem nao afetar linha perdeu a corrida para outro
    // request que apresentou o mesmo token, o que e reuso por definicao.
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, consumedAt: null, revokedAt: null },
      data: {
        consumedAt: this.clock.now(),
        revokedAt: this.clock.now(),
        revokedReason: RefreshTokenRevocationReason.ROTATED,
      },
    });

    if (consumed.count === 0) {
      await this.handleReuse(existing.familyId, existing.userId);
      throw new RefreshTokenReuseError();
    }

    const issued = await this.issue(existing.userId, {
      familyId: existing.familyId,
      ...(userAgent === undefined ? {} : { userAgent }),
    });

    return { userId: existing.userId, issued };
  }

  /** Encerra uma sessao especifica, identificada pelo token apresentado. */
  async revokeByToken(presentedToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hasher.hash(presentedToken) },
      select: { familyId: true },
    });

    if (existing !== null) {
      await this.revokeFamily(existing.familyId, RefreshTokenRevocationReason.LOGOUT);
    }
  }

  /** Revoga todos os tokens vivos de uma familia, ou seja, de uma sessao. */
  async revokeFamily(familyId: string, reason: RefreshTokenRevocationReason): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });

    return result.count;
  }

  /** Encerra todas as sessoes de um usuario. */
  async revokeAllForUser(userId: string, reason: RefreshTokenRevocationReason): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });

    return result.count;
  }

  private async handleReuse(familyId: string, userId: string): Promise<void> {
    const revoked = await this.revokeFamily(familyId, RefreshTokenRevocationReason.REUSE_DETECTED);

    // Registrado como warn de proposito: e o sinal mais forte de credencial
    // vazada que o sistema consegue emitir sozinho.
    this.logger.warn(
      `Reuso de refresh token detectado. Familia ${familyId} do usuario ${userId} revogada, ` +
        `${revoked} token(s) atingido(s).`,
    );
  }
}
