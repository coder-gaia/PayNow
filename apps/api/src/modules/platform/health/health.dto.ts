import { ApiProperty } from '@nestjs/swagger';

export type CheckStatus = 'up' | 'down';
export type ReportStatus = 'ok' | 'error';

export class LivenessReport {
  @ApiProperty({ example: 'ok', description: 'O processo esta respondendo.' })
  status!: 'ok';

  @ApiProperty({ example: 42, description: 'Segundos desde o inicio do processo.' })
  uptimeSeconds!: number;
}

export class DependencyCheck {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status!: CheckStatus;

  @ApiProperty({ example: 3, description: 'Tempo de resposta da verificação, em milissegundos.' })
  latencyMs!: number;

  @ApiProperty({
    required: false,
    example: 'Tempo esgotado após 2000ms',
    description: 'Presente apenas quando a dependência esta indisponível.',
  })
  error?: string;
}

export class ReadinessReport {
  @ApiProperty({
    enum: ['ok', 'error'],
    example: 'ok',
    description: 'Vale "ok" apenas se todas as dependências responderem.',
  })
  status!: ReportStatus;

  @ApiProperty({ example: '2026-08-30T18:24:11.482Z' })
  checkedAt!: string;

  @ApiProperty({
    type: DependencyCheck,
    isArray: false,
    additionalProperties: { $ref: '#/components/schemas/DependencyCheck' },
    description: 'Uma entrada por dependência verificada.',
  })
  checks!: Record<string, DependencyCheck>;
}
