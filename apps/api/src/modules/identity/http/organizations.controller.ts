import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Membership, OrganizationRole } from '@prisma/client';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OrganizationsService } from '../application/organizations.service';
import { CurrentMembership, CurrentUser, RequireRole } from '../../platform/http/auth-context';
import type { AuthContext } from '../../platform/http/auth-context';
import {
  AddMemberDto,
  CreateOrganizationDto,
  MemberResponse,
  OrganizationSummary,
  UpdateMemberRoleDto,
} from './identity.dto';
import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';

type UserContext = AuthContext & { kind: 'user' };

const uuid = () => new ParseUUIDPipe({ version: '7' });

@ApiTags('organizações')
@ApiBearerAuth('usuário')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Organizações das quais o usuário participa' })
  @ApiOkResponse({ type: [OrganizationSummary] })
  list(@CurrentUser() user: UserContext) {
    return this.organizations.listForUser(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma organização, com quem criou como OWNER' })
  create(@CurrentUser() user: UserContext, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(user.userId, dto.name);
  }

  @Get(':organizationId')
  @UseGuards(OrganizationRoleGuard)
  @ApiOperation({ summary: 'Detalhe da organização' })
  findOne(@Param('organizationId', uuid()) organizationId: string) {
    return this.organizations.findById(organizationId);
  }

  @Get(':organizationId/members')
  @UseGuards(OrganizationRoleGuard)
  @ApiOperation({ summary: 'Membros da organização' })
  @ApiOkResponse({ type: [MemberResponse] })
  listMembers(@Param('organizationId', uuid()) organizationId: string) {
    return this.organizations.listMembers(organizationId);
  }

  @Post(':organizationId/members')
  @UseGuards(OrganizationRoleGuard)
  @RequireRole(OrganizationRole.ADMIN)
  @ApiOperation({
    summary: 'Adiciona um membro',
    description:
      'A pessoa precisa já ter conta. Ninguém concede um papel igual ou superior ao próprio.',
  })
  addMember(
    @Param('organizationId', uuid()) organizationId: string,
    @CurrentMembership() membership: Membership,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizations.addMember(organizationId, membership.role, dto.email, dto.role);
  }

  @Patch(':organizationId/members/:userId')
  @UseGuards(OrganizationRoleGuard)
  @RequireRole(OrganizationRole.ADMIN)
  @ApiOperation({
    summary: 'Muda o papel de um membro',
    description: 'A organização nunca fica sem OWNER: rebaixar o último é recusado.',
  })
  updateMemberRole(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('userId', uuid()) userId: string,
    @CurrentUser() user: UserContext,
    @CurrentMembership() membership: Membership,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizations.updateMemberRole(
      organizationId,
      user.userId,
      membership.role,
      userId,
      dto.role,
    );
  }

  @Delete(':organizationId/members/:userId')
  @UseGuards(OrganizationRoleGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove um membro',
    description:
      'Sair da própria organização é permitido a qualquer papel. Remover outra pessoa ' +
      'exige poder estritamente maior que o dela.',
  })
  async removeMember(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('userId', uuid()) userId: string,
    @CurrentUser() user: UserContext,
    @CurrentMembership() membership: Membership,
  ): Promise<void> {
    await this.organizations.removeMember(organizationId, user.userId, membership.role, userId);
  }
}
