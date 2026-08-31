import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env';
import { IdentityModule } from './modules/identity/identity.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // O ambiente e validado no boot. Configuracao invalida derruba o
      // processo em vez de virar erro obscuro na primeira cobranca.
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    PlatformModule,
    IdentityModule,
    LedgerModule,
  ],
})
export class AppModule {}
