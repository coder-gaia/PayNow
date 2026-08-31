import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from '../prisma/prisma.module';
import { CLOCK, ScopedClock } from './clock';
import { ClockScopeStorage } from './clock-scope';
import { ClockScopeInterceptor } from './clock-scope.interceptor';
import { OrganizationClockService } from './organization-clock.service';

/**
 * Ver ADR-0009 e ADR-0015. O relógio é global porque praticamente todo módulo
 * precisa de tempo, e obrigá-los a importar um módulo só para isso criaria
 * acoplamento sem benefício.
 *
 * O interceptor é registrado aqui, e não na raiz de composição, porque ele é
 * parte indissociável de como este módulo entrega tempo: sem ele o relógio
 * virtual nunca entra em cena, e o defeito seria silencioso.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    ClockScopeStorage,
    OrganizationClockService,
    { provide: CLOCK, useClass: ScopedClock },
    { provide: APP_INTERCEPTOR, useClass: ClockScopeInterceptor },
  ],
  exports: [CLOCK, ClockScopeStorage, OrganizationClockService],
})
export class ClockModule {}
