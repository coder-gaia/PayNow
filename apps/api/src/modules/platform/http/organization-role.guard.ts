import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Membership, OrganizationRole } from '@prisma/client';

import { roleSatisfies } from '../authorization/roles';
import { type AuthenticatedRequest, REQUIRED_ROLE } from './auth-context';

/**
 * Porta de leitura de vínculo.
 *
 * O guard precisa saber se a pessoa participa da organização e com que papel,
 * mas não pode importar o módulo de identidade para descobrir: a ADR-0001
 * proíbe módulo de domínio importar módulo de domínio, e o guard é usado por
 * vários deles. Então `platform` declara o contrato e `identity` o implementa.
 */
export const ORGANIZATION_MEMBERSHIP = Symbol('OrganizationMembership');

export interface OrganizationMembershipReader {
  findMembership(userId: string, organizationId: string): Promise<Membership | null>;
}

/**
 * Autorização dentro da organização.
 *
 * Roda depois do guard de autenticação e resolve o vínculo da pessoa com a
 * organização do parâmetro de rota, deixando-o no request para quem precisar
 * do papel adiante. Pertencer a organização já e exigido mesmo quando nenhum
 * papel mínimo foi declarado: `@RequireRole` só eleva a exigência.
 */
@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ORGANIZATION_MEMBERSHIP)
    private readonly memberships: OrganizationMembershipReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // O Express tipa parâmetros de rota como string ou lista de strings, porque
    // um padrão repetido produz vários valores. Aqui é sempre um só.
    const raw = request.params['organizationId'];
    const organizationId = Array.isArray(raw) ? raw[0] : raw;

    if (organizationId === undefined) {
      throw new Error(
        'OrganizationRoleGuard exige o parâmetro de rota :organizationId. ' +
          'Verifique o caminho declarado no controller.',
      );
    }

    // Chave de API já nasce vinculada a uma organização, então autorização por
    // papel não se aplica: o escopo dela e a própria chave.
    if (request.auth?.kind !== 'user') {
      throw new ForbiddenException('Você não pertence a esta organização.');
    }

    const membership = await this.memberships.findMembership(request.auth.userId, organizationId);

    if (membership === null) {
      throw new ForbiddenException('Você não pertence a esta organização.');
    }

    const required = this.reflector.getAllAndOverride<OrganizationRole | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== undefined && !roleSatisfies(membership.role, required)) {
      throw new ForbiddenException(
        `Esta ação exige o papel ${required} ou superior. O seu papel é ${membership.role}.`,
      );
    }

    request.membership = membership;
    return true;
  }
}
