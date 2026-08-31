import { Injectable } from '@nestjs/common';
import { type Membership, OrganizationRole, Prisma } from '@prisma/client';

import { PrismaService } from '../../platform/prisma/prisma.service';
import {
  CannotDemoteLastOwnerError,
  InsufficientRoleError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  OrganizationNotFoundError,
  UserNotFoundError,
} from '../domain/identity.errors';
import { outranks, roleSatisfies } from '../../platform/authorization/roles';
import { resolveUniqueSlug } from '../domain/slug';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Vínculo do usuário com a organização, ou null. Usado pelo guard de papel. */
  findMembership(userId: string, organizationId: string): Promise<Membership | null> {
    return this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
      createdAt: membership.organization.createdAt,
    }));
  }

  async findById(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { _count: { select: { memberships: true, apiKeys: true } } },
    });

    if (organization === null) {
      throw new OrganizationNotFoundError();
    }

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      memberCount: organization._count.memberships,
      apiKeyCount: organization._count.apiKeys,
    };
  }

  async listMembers(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    return memberships.map((membership) => ({
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      joinedAt: membership.createdAt,
    }));
  }

  /** Cria uma organização e coloca quem criou como OWNER. */
  async create(userId: string, name: string) {
    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: name.trim(), slug: await resolveUniqueSlug(tx, name) },
      });

      await tx.membership.create({
        data: { userId, organizationId: created.id, role: OrganizationRole.OWNER },
      });

      return created;
    });

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: OrganizationRole.OWNER,
      createdAt: organization.createdAt,
    };
  }

  /**
   * Adiciona alguém que já tem conta.
   *
   * Convite por email para quem ainda não tem conta e outro fluxo, com token de
   * uso único e expiração, e não entra na fase 01.
   */
  async addMember(
    organizationId: string,
    actorRole: OrganizationRole,
    email: string,
    role: OrganizationRole,
  ) {
    this.assertCanGrant(actorRole, role);

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (user === null) {
      throw new UserNotFoundError();
    }

    try {
      const membership = await this.prisma.membership.create({
        data: { userId: user.id, organizationId, role },
      });

      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        joinedAt: membership.createdAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new MemberAlreadyExistsError();
      }
      throw error;
    }
  }

  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    actorRole: OrganizationRole,
    targetUserId: string,
    role: OrganizationRole,
  ) {
    const target = await this.requireMembership(organizationId, targetUserId);

    this.assertCanGrant(actorRole, role);
    this.assertCanActOn(actorUserId, actorRole, target);

    if (target.role === OrganizationRole.OWNER && role !== OrganizationRole.OWNER) {
      await this.assertNotLastOwner(organizationId);
    }

    const updated = await this.prisma.membership.update({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
      data: { role },
      include: { user: true },
    });

    return {
      userId: updated.user.id,
      name: updated.user.name,
      email: updated.user.email,
      role: updated.role,
      joinedAt: updated.createdAt,
    };
  }

  async removeMember(
    organizationId: string,
    actorUserId: string,
    actorRole: OrganizationRole,
    targetUserId: string,
  ): Promise<void> {
    const target = await this.requireMembership(organizationId, targetUserId);

    // Sair da própria organização é permitido a qualquer papel. Remover outra
    // pessoa exige poder estritamente maior.
    if (targetUserId !== actorUserId) {
      this.assertCanActOn(actorUserId, actorRole, target);
    }

    if (target.role === OrganizationRole.OWNER) {
      await this.assertNotLastOwner(organizationId);
    }

    await this.prisma.membership.delete({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    });
  }

  private async requireMembership(organizationId: string, userId: string): Promise<Membership> {
    const membership = await this.findMembership(userId, organizationId);

    if (membership === null) {
      throw new MemberNotFoundError();
    }

    return membership;
  }

  /** Ninguém concede um papel igual ou superior ao próprio. */
  private assertCanGrant(actorRole: OrganizationRole, granted: OrganizationRole): void {
    if (!outranks(actorRole, granted) && actorRole !== OrganizationRole.OWNER) {
      throw new InsufficientRoleError(`superior a ${granted}`, actorRole);
    }
  }

  /** Ninguém altera alguém de papel igual ou superior ao próprio. */
  private assertCanActOn(
    actorUserId: string,
    actorRole: OrganizationRole,
    target: Membership,
  ): void {
    if (target.userId === actorUserId) {
      return;
    }

    if (!outranks(actorRole, target.role)) {
      throw new InsufficientRoleError(`superior a ${target.role}`, actorRole);
    }
  }

  /**
   * Uma organização sem OWNER fica sem ninguém que possa promover alguém, e
   * portanto travada para sempre.
   */
  private async assertNotLastOwner(organizationId: string): Promise<void> {
    const owners = await this.prisma.membership.count({
      where: { organizationId, role: OrganizationRole.OWNER },
    });

    if (owners <= 1) {
      throw new CannotDemoteLastOwnerError();
    }
  }
}

export { roleSatisfies };
