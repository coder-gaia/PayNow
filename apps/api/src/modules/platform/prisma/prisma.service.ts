import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import type { Env } from '../../../config/env';

/**
 * Cliente do banco, com ciclo de vida amarrado ao do modulo.
 *
 * Ver ADR-0005 (fase 02): o Prisma cuida de schema, migrations e tipos, e o
 * nucleo transacional do ledger usa SQL cru onde precisa de FOR UPDATE,
 * advisory locks e constraints deferrable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    super({ datasourceUrl: config.get('DATABASE_URL', { infer: true }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado ao PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Consulta minima usada pelo probe de prontidao. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
