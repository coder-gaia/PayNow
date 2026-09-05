import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './config/env';
import { ScheduleModule } from '@nestjs/schedule';

import { BillingModule } from './modules/billing/billing.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { IdentityModule } from './modules/identity/identity.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PlatformModule } from './modules/platform/platform.module';
import type { Env } from './config/env';

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
    /**
     * Limite de taxa por IP.
     *
     * Existe por causa de duas superfícies: o login, onde sem limite uma força
     * bruta é só uma questão de tempo, e o webhook de entrada, que é público por
     * necessidade.
     *
     * Por IP e em memória, o que tem uma limitação que precisa estar dita: com
     * mais de um processo, cada um conta o seu, e o limite efetivo é o número
     * de processos vezes este valor. Contar em Redis resolveria, e o Redis já
     * está no projeto, mas com um processo isto não é um problema que exista.
     * Está anotado como gatilho de revisão na ADR-0019.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const limite = config.get('RATE_LIMIT_PER_MINUTE', { infer: true });

        return {
          throttlers: [
            { name: 'padrao', ttl: 60_000, limit: limite === 0 ? Number.MAX_SAFE_INTEGER : limite },
          ],
        };
      },
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
  providers: [
    // Global de propósito, e não por rota. Proteção que precisa ser lembrada em
    // cada rota nova é proteção que uma hora alguém esquece, e o esquecimento
    // não aparece em teste nenhum.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
