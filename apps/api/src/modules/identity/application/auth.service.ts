import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrganizationRole, Prisma } from '@prisma/client';

import type { Env } from '../../../config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  UserNotFoundError,
} from '../domain/identity.errors';
import { resolveUniqueSlug } from '../domain/slug';
import { PasswordHasher } from '../infrastructure/password-hasher';
import { RefreshTokenService } from './refresh-token.service';

/** Conteúdo assinado no token de acesso. Nada sensível entra aqui. */
export interface AccessTokenPayload {
  readonly sub: string;
  readonly email: string;
}

export interface AuthenticatedSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly user: { id: string; email: string; name: string };
}

interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly organizationName: string;
}

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class AuthService {
  private readonly accessTtlMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHasher,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.accessTtlMinutes = this.config.get('JWT_ACCESS_TTL_MINUTES', { infer: true });
  }

  /**
   * Cria a conta e a primeira organização em uma transação.
   *
   * Um usuário sem organização não consegue fazer nada no sistema, então criar
   * os dois separadamente abriria uma janela em que a conta existe e e inútil.
   */
  async register(input: RegisterInput, userAgent?: string): Promise<AuthenticatedSession> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwords.hash(input.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email, name: input.name.trim(), passwordHash },
        });

        const organization = await tx.organization.create({
          data: {
            name: input.organizationName.trim(),
            slug: await resolveUniqueSlug(tx, input.organizationName),
          },
        });

        await tx.membership.create({
          data: {
            userId: created.id,
            organizationId: organization.id,
            role: OrganizationRole.OWNER,
          },
        });

        return created;
      });

      return await this.startSession(user, userAgent);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async login(
    rawEmail: string,
    password: string,
    userAgent?: string,
  ): Promise<AuthenticatedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(rawEmail) } });

    // A verificação roda mesmo sem usuário, contra um hash descartável, para
    // que o tempo de resposta não revele quais emails existem.
    const valid =
      user === null
        ? await this.passwords.verifyAgainstDummy(password)
        : await this.passwords.verify(user.passwordHash, password);

    if (user === null || !valid) {
      throw new InvalidCredentialsError();
    }

    return this.startSession(user, userAgent);
  }

  async refresh(presentedToken: string, userAgent?: string): Promise<AuthenticatedSession> {
    const { userId, issued } = await this.refreshTokens.rotate(presentedToken, userAgent);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (user === null) {
      throw new UserNotFoundError();
    }

    return {
      accessToken: this.signAccessToken(user.id, user.email),
      refreshToken: issued.token,
      expiresInSeconds: this.accessTtlMinutes * 60,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  async logout(presentedToken: string): Promise<void> {
    await this.refreshTokens.revokeByToken(presentedToken);
  }

  /**
   * Confere que o dono de um token de acesso ainda existe.
   *
   * Um JWT é válido enquanto a assinatura confere e o prazo não venceu, e isso
   * não diz nada sobre o sujeito continuar existindo. Sem esta checagem, a
   * conta apagada segue autenticando até o token vencer, e cada request dela
   * quebra em um lugar diferente: aqui um 404, ali uma exceção não tratada.
   *
   * O email vem do banco, e não do token. Se a pessoa trocou de email depois
   * de o token ser emitido, o valor gravado nele está velho.
   */
  async findTokenSubject(userId: string): Promise<{ id: string; email: string } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
  }

  /** Perfil do usuário autenticado, com as organizações de que ele participa. */
  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (user === null) {
      throw new UserNotFoundError();
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      organizations: user.memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      })),
    };
  }

  private async startSession(
    user: { id: string; email: string; name: string },
    userAgent?: string,
  ): Promise<AuthenticatedSession> {
    const issued = await this.refreshTokens.issue(user.id, {
      ...(userAgent === undefined ? {} : { userAgent }),
    });

    return {
      accessToken: this.signAccessToken(user.id, user.email),
      refreshToken: issued.token,
      expiresInSeconds: this.accessTtlMinutes * 60,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  private signAccessToken(userId: string, email: string): string {
    const payload: AccessTokenPayload = { sub: userId, email };
    return this.jwt.sign(payload, { expiresIn: `${this.accessTtlMinutes}m` });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
