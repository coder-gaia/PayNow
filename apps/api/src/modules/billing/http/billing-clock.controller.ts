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
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { OrganizationClockService } from '../../platform/clock/organization-clock.service';
import { ClockScopeStorage } from '../../platform/clock/clock-scope';
import { RequireRole } from '../../platform/http/auth-context';
import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { BillingCycleService, type CycleReport } from '../application/billing-cycle.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

const MS_POR_DIA = 24 * 60 * 60 * 1000;

class AdvanceDto {
  @IsOptional() @IsInt() @Min(0) @Max(366) days?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) hours?: number;
  @IsOptional() @IsInt() @Min(0) @Max(59) minutes?: number;
}

/**
 * Controle do tempo, e do que o tempo provoca.
 *
 * O relógio em si é capacidade de plataforma, mas o endereço que o move mora
 * em cobrança de propósito: avançar o tempo sem liquidar as consequências
 * deixaria o sistema em um estado que nenhuma passagem real de tempo produz,
 * com períodos vencidos e faturas faltando. Quem adianta o relógio recebe de
 * volta o que isso causou, na mesma resposta.
 *
 * Quando os pagamentos da fase 05 também passarem a reagir ao tempo, a
 * liquidação sai daqui e vira um evento de domínio que cada módulo consome,
 * que é a costura que a ADR-0001 já prevê. Enquanto cobrança é a única que
 * reage, um evento seria indireção sem leitor.
 */
@ApiTags('relógio')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId/clock')
@UseGuards(OrganizationRoleGuard)
export class BillingClockController {
  constructor(
    private readonly clocks: OrganizationClockService,
    private readonly scopes: ClockScopeStorage,
    private readonly cycle: BillingCycleService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Estado do relógio da organização',
    description:
      'Sem congelamento, responde o relógio de parede. Congelado, responde o instante parado e ' +
      'quanto de tempo virtual já foi percorrido.',
  })
  async state(@Param('organizationId', uuid()) organizationId: string) {
    return apresentar(await this.clocks.state(organizationId));
  }

  @Post('freeze')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Congela o tempo desta organização',
    description:
      'A partir daqui o tempo só anda por comando. O congelamento vale só para esta ' +
      'organização: as outras seguem no relógio de parede.',
  })
  async freeze(@Param('organizationId', uuid()) organizationId: string) {
    return apresentar(await this.clocks.freeze(organizationId));
  }

  @Post('advance')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Avança o tempo e liquida o que vencer',
    description:
      'Roda o ciclo de cobrança até não sobrar nada vencido, então avançar dois meses em um ' +
      'plano mensal produz duas renovações, e não uma. A resposta traz o que aconteceu.',
  })
  async advance(@Param('organizationId', uuid()) organizationId: string, @Body() dto: AdvanceDto) {
    const milliseconds =
      (dto.days ?? 0) * MS_POR_DIA + (dto.hours ?? 0) * 3_600_000 + (dto.minutes ?? 0) * 60_000;

    const state = await this.clocks.advance(organizationId, milliseconds);

    // O ciclo roda dentro do escopo do relógio novo. Sem isto ele leria o
    // instante que o interceptor resolveu no início do request, que é o de
    // antes do avanço, e não encontraria nada vencido.
    const report = await this.scopes.run({ organizationId, now: state.now, virtual: true }, () =>
      this.cycle.runDue(organizationId),
    );

    return { clock: apresentar(state), cycle: apresentarCiclo(report) };
  }

  @Post('reset')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Devolve a organização ao relógio de parede',
    description:
      'O que foi cobrado enquanto o tempo estava adiantado continua lançado. O razão é ' +
      'append-only: desfazer o relógio não desfaz a história.',
  })
  async reset(@Param('organizationId', uuid()) organizationId: string) {
    return apresentar(await this.clocks.reset(organizationId));
  }

  @Post('run-cycle')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Roda o ciclo sem mexer no relógio',
    description:
      'Útil quando algo venceu por passagem real de tempo. Na fase 05 esta mesma rotina passa ' +
      'a ser chamada pelo worker agendado.',
  })
  async runCycle(@Param('organizationId', uuid()) organizationId: string) {
    return apresentarCiclo(await this.cycle.runDue(organizationId));
  }
}

function apresentar(state: Awaited<ReturnType<OrganizationClockService['state']>>) {
  return {
    virtual: state.virtual,
    now: state.now,
    frozenSince: state.frozenSince,
    advancedDays: Math.floor(state.advancedMs / MS_POR_DIA),
    advancedMs: state.advancedMs,
  };
}

function apresentarCiclo(report: CycleReport) {
  return {
    ranAt: report.ranAt,
    effects: report.effects.map((effect) => ({
      subscriptionId: effect.subscriptionId,
      customerName: effect.customerName,
      action: effect.action,
      at: effect.at,
    })),
  };
}
