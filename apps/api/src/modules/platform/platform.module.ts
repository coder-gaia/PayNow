import { Module } from '@nestjs/common';

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
 * Ao longo das fases seguintes ele recebe tambem o relogio injetado (fase 04),
 * o outbox transacional e a camada de idempotencia (fase 05).
 */
@Module({
  imports: [PrismaModule, RedisModule, HealthModule],
})
export class PlatformModule {}
