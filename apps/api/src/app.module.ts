import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env';
import { ScheduleModule } from '@nestjs/schedule';

import { BillingModule } from './modules/billing/billing.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { IdentityModule } from './modules/identity/identity.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // O ambiente e validado no boot. Configuração inválida derruba o
      // processo em vez de virar erro obscuro na primeira cobrança.
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    PlatformModule,
    IdentityModule,
    LedgerModule,
    // O agendador sobe para a raiz agora que dois modulos agendam trabalho:
    // cobranca e webhooks. Registrar em cada um faria dois registros do mesmo
    // agendador global.
    ScheduleModule.forRoot(),
    BillingModule,
    WebhooksModule,
  ],
})
export class AppModule {}
