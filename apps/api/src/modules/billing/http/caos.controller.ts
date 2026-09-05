import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { RequireRole } from '../../platform/http/auth-context';
import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { FakeGateway, type FakeScenario } from '../../platform/payments/fake-gateway';

const uuid = () => new ParseUUIDPipe({ version: '7' });

class ProgramarDto {
  @IsIn(['succeed', 'decline', 'timeout', 'failThenSucceed'])
  kind!: 'succeed' | 'decline' | 'timeout' | 'failThenSucceed';

  /** Só para `timeout`: o que aconteceu do lado do provedor, apesar do silêncio. */
  @IsOptional()
  @IsIn(['succeeded', 'failed'])
  desfechoReal?: 'succeeded' | 'failed';

  /** Só para `failThenSucceed`: quantas recusas antes de passar. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  failures?: number;
}

/**
 * Console de caos.
 *
 * A tese do projeto é que corretude se verifica, e verificar exige poder
 * provocar. Um provedor de pagamento real falha raramente e nunca sob demanda,
 * então demonstrar recuperação com um provedor real é esperar dar sorte.
 *
 * Aqui a falha é um botão. Quem estiver olhando programa o provedor para
 * recusar, para não responder, ou para não responder **tendo cobrado**, que é o
 * caso difícil de verdade, e vê o sistema reagir.
 *
 * Duas coisas que este controlador não é:
 *
 * Não é ferramenta de teste. Os testes dirigem o gateway falso direto, sem
 * passar por HTTP. Isto existe para a demonstração ter o que mostrar.
 *
 * Não é seguro por organização. O gateway falso guarda o cenário no processo,
 * então programá-lo afeta todas as organizações daquele processo. Está exposto
 * assim mesmo porque o ambiente de demonstração tem um processo e um público, e
 * a alternativa, cenário por organização, seria complexidade a serviço de um
 * requisito que não existe. Fora de desenvolvimento a rota some.
 */
@ApiTags('caos')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId/caos')
@UseGuards(OrganizationRoleGuard)
export class CaosController {
  constructor(private readonly gateway: FakeGateway) {}

  @Get()
  @ApiOperation({ summary: 'O que o provedor falso vai fazer na próxima cobrança' })
  estado(@Param('organizationId', uuid()) _organizationId: string) {
    return {
      scenario: this.gateway.currentScenario(),
      naoContadas: this.gateway.pendingCount(),
      cenarios: [
        {
          kind: 'succeed',
          titulo: 'Aprovar',
          descricao: 'O caminho feliz. A fatura é quitada e o razão recebe quatro linhas.',
        },
        {
          kind: 'decline',
          titulo: 'Recusar',
          descricao:
            'O emissor nega. A assinatura cai para PAST_DUE e entra no calendário de recuperação.',
        },
        {
          kind: 'timeout',
          titulo: 'Não responder',
          descricao:
            'O provedor some. A tentativa fica pendente, e o sistema não sabe se o dinheiro saiu.',
        },
        {
          kind: 'timeout',
          desfechoReal: 'succeeded',
          titulo: 'Não responder, tendo cobrado',
          descricao:
            'O caso difícil. O dinheiro saiu e ninguém aqui sabe. Só o webhook de entrada resolve.',
        },
        {
          kind: 'failThenSucceed',
          failures: 2,
          titulo: 'Falhar duas vezes e passar',
          descricao: 'Recuperação completa: duas recusas, e a terceira tentativa entra.',
        },
      ],
    };
  }

  @Post()
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Programa a próxima cobrança',
    description: 'Vale para toda cobrança deste processo até ser trocado ou zerado.',
  })
  programar(@Param('organizationId', uuid()) _organizationId: string, @Body() dto: ProgramarDto) {
    const cenario: FakeScenario =
      dto.kind === 'failThenSucceed'
        ? { kind: 'failThenSucceed', failures: dto.failures ?? 2 }
        : dto.kind === 'timeout'
          ? {
              kind: 'timeout',
              ...(dto.desfechoReal === undefined ? {} : { desfechoReal: dto.desfechoReal }),
            }
          : { kind: dto.kind };

    this.gateway.setScenario(cenario);
    return { scenario: this.gateway.currentScenario() };
  }

  @Post('reset')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Volta ao caminho feliz e esquece o que já respondeu' })
  reset(@Param('organizationId', uuid()) _organizationId: string) {
    this.gateway.reset();
    return { scenario: this.gateway.currentScenario() };
  }
}
