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
 * Porta de leitura de vinculo.
 *
 * O guard precisa saber se a pessoa participa da organizacao e com que papel,
 * mas nao pode importar o modulo de identidade para descobrir: a ADR-0001
 * proibe modulo de dominio importar modulo de dominio, e o guard e usado por
 * varios deles. Entao `platform` declara o contrato e `identity` o implementa.
 */
export const ORGANIZATION_MEMBERSHIP = Symbol('OrganizationMembership');

export interface OrganizationMembershipReader {
  findMembership(userId: string, organizationId: string): Promise<Membership | null>;
}

/**
 * Autorizacao dentro da organizacao.
 *
 * Roda depois do guard de autenticacao e resolve o vinculo da pessoa com a
 * organizacao do parametro de rota, deixando-o no request para quem precisar
 * do papel adiante. Pertencer a organizacao ja e exigido mesmo quando nenhum
 * papel minimo foi declarado: `@RequireRole` so eleva a exigencia.
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
      throw new ForbiddenException('Voce nao pertence a esta organizacao.');
    }

    const membership = await this.memberships.findMembership(request.auth.userId, organizationId);

    if (membership === null) {
      throw new ForbiddenException('Voce nao pertence a esta organizacao.');
    }

    const required = this.reflector.getAllAndOverride<OrganizationRole | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== undefined && !roleSatisfies(membership.role, required)) {
      throw new ForbiddenException(
        `Esta acao exige o papel ${required} ou superior. O seu papel e ${membership.role}.`,
      );
    }

    request.membership = membership;
    return true;
  }
}
