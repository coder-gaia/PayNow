import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../http/auth-context';
import { LivenessReport, ReadinessReport } from './health.dto';
import { HealthService } from './health.service';

// Probes ficam publicos: um orquestrador nao carrega credencial, e um health
// check que responde 401 e indistinguivel de um servico morto.
@ApiTags('saude')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Public()
  @ApiOperation({
    summary: 'Liveness',
    description:
      'Responde 200 enquanto o processo estiver respondendo. Nao consulta dependencias: ' +
      'banco fora do ar nao e motivo para reiniciar o container.',
  })
  @ApiOkResponse({ type: LivenessReport })
  live(): LivenessReport {
    return this.health.liveness();
  }

  @Get('ready')
  @Public()
  @ApiOperation({
    summary: 'Readiness',
    description:
      'Verifica PostgreSQL e Redis em paralelo, com tempo limite por dependencia. ' +
      'Responde 503 com o detalhe de cada verificacao se alguma falhar.',
  })
  @ApiOkResponse({ type: ReadinessReport })
  @ApiServiceUnavailableResponse({ type: ReadinessReport })
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();

    if (report.status === 'error') {
      throw new ServiceUnavailableException(report);
    }

    return report;
  }
}
