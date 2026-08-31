import { Module } from '@nestjs/common';

import { ClockModule } from './clock/clock.module';
import { EventsModule } from './events/events.module';
import { OrganizationRoleGuard } from './http/organization-role.guard';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/**
 * Primitivas transversais do sistema.
 *
 * Este é o único módulo que os módulos de domínio podem importar livremente
 * (ver ADR-0001 e a regra boundaries/element-types no eslint.config.mjs).
 * Ele existe justamente para que nenhum módulo de domínio precise conhecer
 * outro para funcionar.
 *
 * O relógio injetado (ADR-0009) já vive aqui. Ao longo das fases seguintes o
 * módulo recebe também o outbox transacional e a camada de idempotência.
 */
@Module({
  imports: [ClockModule, EventsModule, PrismaModule, RedisModule, HealthModule],
  providers: [OrganizationRoleGuard],
  exports: [OrganizationRoleGuard],
})
export class PlatformModule {}
