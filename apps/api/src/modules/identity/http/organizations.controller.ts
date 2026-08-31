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
import { OrganizationRoleGuard } from './organization-role.guard';

type UserContext = AuthContext & { kind: 'user' };

const uuid = () => new ParseUUIDPipe({ version: '7' });

@ApiTags('organizacoes')
@ApiBearerAuth('usuario')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Organizacoes das quais o usuario participa' })
  @ApiOkResponse({ type: [OrganizationSummary] })
  list(@CurrentUser() user: UserContext) {
    return this.organizations.listForUser(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma organizacao, com quem criou como OWNER' })
  create(@CurrentUser() user: UserContext, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(user.userId, dto.name);
  }

  @Get(':organizationId')
  @UseGuards(OrganizationRoleGuard)
  @ApiOperation({ summary: 'Detalhe da organizacao' })
  findOne(@Param('organizationId', uuid()) organizationId: string) {
    return this.organizations.findById(organizationId);
  }

  @Get(':organizationId/members')
  @UseGuards(OrganizationRoleGuard)
  @ApiOperation({ summary: 'Membros da organizacao' })
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
      'A pessoa precisa ja ter conta. Ninguem concede um papel igual ou superior ao proprio.',
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
    description: 'A organizacao nunca fica sem OWNER: rebaixar o ultimo e recusado.',
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
      'Sair da propria organizacao e permitido a qualquer papel. Remover outra pessoa ' +
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
