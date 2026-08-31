import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { LivenessReport, ReadinessReport } from './health.dto';
import { HealthService } from './health.service';

@ApiTags('saude')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
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
