import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ClockModule } from './clock/clock.module';
import { PaymentsGatewayModule } from './payments/payments-gateway.module';
import { EventsModule } from './events/events.module';
import { IdempotencyInterceptor } from './http/idempotency.interceptor';
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
 * O relógio injetado (ADR-0009) e a idempotência de requisição (ADR-0007) já
 * vivem aqui, assim como a porta de gateway (ADR-0011). O outbox transacional
 * entra em seguida.
 */
@Module({
  imports: [
    ClockModule,
    EventsModule,
    PaymentsGatewayModule,
    PrismaModule,
    RedisModule,
    HealthModule,
  ],
  providers: [
    OrganizationRoleGuard,
    // Global, mas inerte sem o cabeçalho `Idempotency-Key`. Ver ADR-0007: quem
    // decide usar idempotência é quem chama, exatamente como no Stripe.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [OrganizationRoleGuard],
})
export class PlatformModule {}
