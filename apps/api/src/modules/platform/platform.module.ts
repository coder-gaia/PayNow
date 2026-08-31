import { Module } from '@nestjs/common';

import { ClockModule } from './clock/clock.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/**
 * Primitivas transversais do sistema.
 *
 * Este e o unico modulo que os modulos de dominio podem importar livremente
 * (ver ADR-0001 e a regra boundaries/element-types no eslint.config.mjs).
 * Ele existe justamente para que nenhum modulo de dominio precise conhecer
 * outro para funcionar.
 *
 * O relogio injetado (ADR-0009) ja vive aqui. Ao longo das fases seguintes o
 * modulo recebe tambem o outbox transacional e a camada de idempotencia.
 */
@Module({
  imports: [ClockModule, PrismaModule, RedisModule, HealthModule],
})
export class PlatformModule {}
