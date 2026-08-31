import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizationRole } from '@prisma/client';

import { OrganizationsService } from '../application/organizations.service';
import { InsufficientRoleError, NotAMemberError } from '../domain/identity.errors';
import { roleSatisfies } from '../domain/roles';
import { type AuthenticatedRequest, REQUIRED_ROLE } from '../../platform/http/auth-context';

/**
 * Autorizacao dentro da organizacao.
 *
 * Roda depois do guard de autenticacao e resolve o vinculo do usuario com a
 * organizacao do parametro de rota, deixando-o no request para quem precisar
 * do papel adiante. Pertencer a organizacao ja e exigido mesmo quando nenhum
 * papel minimo foi declarado: `@RequireRole` so eleva a exigencia.
 */
@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly organizations: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // O Express tipa parametros de rota como string ou lista de strings, porque
    // um padrao repetido produz varios valores. Aqui e sempre um so.
    const raw = request.params['organizationId'];
    const organizationId = Array.isArray(raw) ? raw[0] : raw;

    if (organizationId === undefined) {
      throw new Error(
        'OrganizationRoleGuard exige o parametro de rota :organizationId. ' +
          'Verifique o caminho declarado no controller.',
      );
    }

    // Chave de API ja nasce vinculada a uma organizacao, entao autorizacao por
    // papel nao se aplica: o escopo dela e a propria chave.
    if (request.auth?.kind !== 'user') {
      throw new NotAMemberError();
    }

    const membership = await this.organizations.findMembership(request.auth.userId, organizationId);

    if (membership === null) {
      throw new NotAMemberError();
    }

    const required = this.reflector.getAllAndOverride<OrganizationRole | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== undefined && !roleSatisfies(membership.role, required)) {
      throw new InsufficientRoleError(required, membership.role);
    }

    request.membership = membership;
    return true;
  }
}
