import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiKeysService } from '../application/api-keys.service';
import { OrganizationsService } from '../application/organizations.service';
import { AllowApiKey, CurrentApiKey, RequireRole } from '../../platform/http/auth-context';
import type { AuthContext } from '../../platform/http/auth-context';
import { ApiKeyResponse, CreateApiKeyDto, CreatedApiKeyResponse } from './identity.dto';
import { OrganizationRoleGuard } from './organization-role.guard';

const uuid = () => new ParseUUIDPipe({ version: '7' });

@ApiTags('chaves de api')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId/api-keys')
@UseGuards(OrganizationRoleGuard)
@RequireRole(OrganizationRole.ADMIN)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista as chaves da organizacao',
    description: 'Apenas o prefixo e devolvido. O segredo nao e recuperavel depois da criacao.',
  })
  @ApiOkResponse({ type: [ApiKeyResponse] })
  list(@Param('organizationId', uuid()) organizationId: string) {
    return this.apiKeys.list(organizationId);
  }

  @Post()
  @ApiOperation({
    summary: 'Cria uma chave',
    description:
      'O segredo completo aparece uma unica vez, nesta resposta. Guarde antes de fechar.',
  })
  @ApiCreatedResponse({ type: CreatedApiKeyResponse })
  create(@Param('organizationId', uuid()) organizationId: string, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(organizationId, dto.name, dto.environment);
  }

  @Delete(':apiKeyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoga uma chave',
    description: 'A linha e mantida com a data de revogacao, para preservar a trilha de uso.',
  })
  async revoke(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('apiKeyId', uuid()) apiKeyId: string,
  ): Promise<void> {
    await this.apiKeys.revoke(organizationId, apiKeyId);
  }
}

/**
 * Ponta autenticada por chave de API.
 *
 * Existe para que o servidor do merchant confirme qual organizacao a chave
 * representa, e para exercitar o caminho de autenticacao por chave de ponta a
 * ponta. As rotas de cobranca da fase 05 entram por aqui.
 */
@ApiTags('merchant')
@ApiBearerAuth('merchant')
@Controller('merchant')
export class MerchantContextController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  @AllowApiKey()
  @ApiOperation({ summary: 'Organizacao e ambiente da chave apresentada' })
  async me(@CurrentApiKey() key: AuthContext & { kind: 'apiKey' }) {
    const organization = await this.organizations.findById(key.organizationId);

    return {
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
      environment: key.environment,
      apiKeyId: key.apiKeyId,
    };
  }
}
