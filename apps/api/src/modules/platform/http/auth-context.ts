import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ApiKeyEnvironment, Membership, OrganizationRole } from '@prisma/client';
import type { Request } from 'express';

/**
 * Quem esta chamando.
 *
 * Vive em `platform`, e não em `identity`, por causa da ADR-0001: módulo de
 * domínio não importa módulo de domínio. O controller de saude já precisa do
 * `@Public()`, e a partir da fase 05 os módulos de pagamento vao precisar do
 * `@AllowApiKey()` e do `@CurrentApiKey()`. Quem implementa a verificação
 * continua sendo o `identity`; o que está aqui é apenas o contrato.
 *
 * O sistema tem dois tipos de chamador, e eles não se misturam: uma pessoa no
 * painel, autenticada por JWT, e o servidor de um merchant, autenticado por
 * chave de API. Modelar isso como uniao discriminada, e não como um objeto
 * `user` com campos opcionais, faz o compilador cobrar o tratamento dos dois
 * casos em todo lugar que importa.
 */
export type AuthContext =
  | { readonly kind: 'user'; readonly userId: string; readonly email: string }
  | {
      readonly kind: 'apiKey';
      readonly apiKeyId: string;
      readonly organizationId: string;
      readonly environment: ApiKeyEnvironment;
    };

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  membership?: Membership;
}

// ---------------------------------------------------------------------------
// Decorators de rota
// ---------------------------------------------------------------------------

export const IS_PUBLIC = 'paynow:isPublic';
export const ALLOWS_API_KEY = 'paynow:allowsApiKey';
export const REQUIRED_ROLE = 'paynow:requiredRole';

/** Dispensa autenticação. Usar com parcimonia é sempre com motivo óbvio. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Aceita chave de API além de JWT.
 *
 * Sem isto, apresentar uma chave `sk_` em uma rota do painel e rejeitado. A
 * separacao é deliberada: uma chave de servidor nunca deveria conseguir mexer
 * na conta de uma pessoa.
 */
export const AllowApiKey = () => SetMetadata(ALLOWS_API_KEY, true);

/** Exige papel mínimo na organização indicada pelo parâmetro de rota. */
export const RequireRole = (role: OrganizationRole) => SetMetadata(REQUIRED_ROLE, role);

// ---------------------------------------------------------------------------
// Decorators de parâmetro
// ---------------------------------------------------------------------------

/** Usuário autenticado. Lanca se a rota não passou pelo guard de JWT. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

  if (request.auth?.kind !== 'user') {
    throw new Error(
      'CurrentUser usado em rota que não exige autenticação de usuário. ' +
        'Remova o @Public() ou troque por @CurrentApiKey().',
    );
  }

  return request.auth;
});

/** Chave de API autenticada. */
export const CurrentApiKey = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

  if (request.auth?.kind !== 'apiKey') {
    throw new Error('CurrentApiKey usado em rota que não aceita chave de API.');
  }

  return request.auth;
});

/** Vínculo do usuário com a organização da rota, resolvido pelo guard de papel. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.membership === undefined) {
      throw new Error('CurrentMembership exige que a rota passe pelo OrganizationRoleGuard.');
    }

    return request.membership;
  },
);
