import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, Length } from 'class-validator';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { RequireRole } from '../../platform/http/auth-context';
import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { WebhookDispatcher } from '../application/webhook-dispatcher';
import { WebhookEndpointsService } from '../application/webhook-endpoints.service';
import { MAX_DELIVERY_ATTEMPTS, DELIVERY_BACKOFF_SECONDS } from '../domain/delivery-schedule';
import { SIGNATURE_HEADER, TOLERANCE_SECONDS } from '../domain/signature';

const uuid = () => new ParseUUIDPipe({ version: '7' });

class CreateEndpointDto {
  @IsUrl({ require_tld: false, require_protocol: true }) url!: string;
  @IsOptional() @IsString() @Length(1, 200) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) eventTypes?: string[];
}

/**
 * Webhooks de saída.
 *
 * O merchant cadastra um endereço, escolhe os eventos que quer, e passa a
 * receber cada fato assinado. A assinatura e o histórico completo de tentativas
 * são a parte que importa: um webhook sem histórico transforma "não recebi" em
 * uma discussão sem árbitro.
 */
@ApiTags('webhooks')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId/webhooks')
@UseGuards(OrganizationRoleGuard)
export class WebhooksController {
  constructor(
    private readonly endpoints: WebhookEndpointsService,
    private readonly dispatcher: WebhookDispatcher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Endereços cadastrados' })
  async list(@Param('organizationId', uuid()) organizationId: string) {
    const enderecos = await this.endpoints.list(organizationId);

    return enderecos.map((endereco) => apresentar(endereco));
  }

  @Post()
  @RequireRole(OrganizationRole.ADMIN)
  @ApiOperation({
    summary: 'Cadastra um endereço',
    description:
      'O segredo de assinatura volta uma única vez, nesta resposta. Guarde: não há como ' +
      'consultá-lo depois, só gerar outro.',
  })
  async create(
    @Param('organizationId', uuid()) organizationId: string,
    @Body() dto: CreateEndpointDto,
  ) {
    const { endpoint, secret } = await this.endpoints.create(organizationId, {
      url: dto.url,
      ...(dto.description === undefined ? {} : { description: dto.description }),
      ...(dto.eventTypes === undefined ? {} : { eventTypes: dto.eventTypes }),
    });

    return { ...apresentar(endpoint), secret };
  }

  @Post(':endpointId/rotate-secret')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gera um segredo novo',
    description: 'O anterior deixa de valer imediatamente, e entregas em voo passam a falhar.',
  })
  async rotate(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('endpointId', uuid()) endpointId: string,
  ) {
    const { endpoint, secret } = await this.endpoints.rotateSecret(organizationId, endpointId);
    return { ...apresentar(endpoint), secret };
  }

  @Post(':endpointId/disable')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Para de enviar para este endereço' })
  async disable(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('endpointId', uuid()) endpointId: string,
  ) {
    return apresentar(
      await this.endpoints.setEnabled(organizationId, endpointId, false, this.clock.now()),
    );
  }

  @Post(':endpointId/enable')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Volta a enviar para este endereço' })
  async enable(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('endpointId', uuid()) endpointId: string,
  ) {
    return apresentar(
      await this.endpoints.setEnabled(organizationId, endpointId, true, this.clock.now()),
    );
  }

  @Delete(':endpointId')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove o endereço e o histórico de entregas dele' })
  async remove(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('endpointId', uuid()) endpointId: string,
  ): Promise<void> {
    await this.endpoints.remove(organizationId, endpointId);
  }

  @Get('deliveries')
  @ApiQuery({ name: 'endpointId', required: false })
  @ApiOperation({
    summary: 'Histórico de entregas',
    description:
      'Cada tentativa registra o código de resposta, o tempo e o erro. É o que transforma ' +
      '"não recebi" em uma pergunta com resposta.',
  })
  async deliveries(
    @Param('organizationId', uuid()) organizationId: string,
    @Query('endpointId') endpointId?: string,
  ) {
    const entregas = await this.endpoints.deliveries(organizationId, {
      ...(endpointId === undefined ? {} : { endpointId }),
    });

    return entregas.map((entrega) => ({
      id: entrega.id,
      url: entrega.endpoint.url,
      eventType: entrega.eventType,
      eventId: entrega.eventId,
      status: entrega.status,
      attempts: entrega.attempts,
      lastStatusCode: entrega.lastStatusCode,
      lastError: entrega.lastError,
      lastDurationMs: entrega.lastDurationMs,
      nextAttemptAt: entrega.nextAttemptAt,
      deliveredAt: entrega.deliveredAt,
      createdAt: entrega.createdAt,
    }));
  }

  @Post('deliveries/:deliveryId/replay')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenvia uma entrega',
    description:
      'Vale inclusive para uma que já tinha desistido. As tentativas voltam a zero: um reenvio ' +
      'pedido por uma pessoa merece o calendário inteiro de novo.',
  })
  async replay(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('deliveryId', uuid()) deliveryId: string,
  ) {
    await this.dispatcher.replay(organizationId, deliveryId);
    return { replayed: true };
  }

  @Post('dispatch')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Força uma rodada de entrega',
    description: 'O worker faz isso sozinho a cada minuto. Esta rota existe para a demonstração.',
  })
  async dispatch() {
    return this.dispatcher.dispatch();
  }

  @Get('signature')
  @ApiOperation({
    summary: 'Como verificar a assinatura',
    description: 'O que um integrador precisa saber para conferir o que recebe.',
  })
  signature() {
    return {
      header: SIGNATURE_HEADER,
      format: 't=<unix>,v1=<hex>',
      algorithm: 'HMAC-SHA256',
      signedPayload: '`${t}.${corpoExatoRecebido}`',
      toleranceSeconds: TOLERANCE_SECONDS,
      notes: [
        'Assine o corpo exatamente como recebido, sem reserializar: a ordem das chaves pode mudar.',
        'Compare em tempo constante. Comparar com igualdade simples vaza quantos bytes conferiram.',
        'Recuse o que estiver fora da janela de tolerância: sem isso, uma entrega capturada vale para sempre.',
      ],
      retrySchedule: {
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        backoffSeconds: DELIVERY_BACKOFF_SECONDS,
      },
    };
  }
}

type Endpoint = Awaited<ReturnType<WebhookEndpointsService['findById']>>;

function apresentar(endpoint: Endpoint) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    enabled: endpoint.enabled,
    eventTypes: endpoint.eventTypes,
    createdAt: endpoint.createdAt,
    disabledAt: endpoint.disabledAt,
  };
}
