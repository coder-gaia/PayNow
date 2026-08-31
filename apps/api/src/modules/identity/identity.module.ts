import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../../config/env';
import { ApiKeysService } from './application/api-keys.service';
import { AuthService } from './application/auth.service';
import { OrganizationsService } from './application/organizations.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { ORGANIZATION_MEMBERSHIP } from '../platform/http/organization-role.guard';
import { ApiKeysController, MerchantContextController } from './http/api-keys.controller';
import { AuthController } from './http/auth.controller';
import { AuthenticationGuard } from './http/authentication.guard';
import { OrganizationsController } from './http/organizations.controller';
import { PasswordHasher } from './infrastructure/password-hasher';
import { TokenHasher } from './infrastructure/token-hasher';

/**
 * Identidade: usuários, organizações, papéis e chaves de API.
 *
 * O guard de autenticação e registrado como APP_GUARD, ou seja, vale para toda
 * a aplicação. Autenticação passa a ser o padrão e a exceção precisa ser
 * declarada com `@Public()`, e não o contrario: esquecer de proteger uma rota
 * é um erro silencioso, esquecer de liberar uma e um 401 óbvio no primeiro
 * teste.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { issuer: 'paynow', audience: 'paynow-api' },
        verifyOptions: { issuer: 'paynow', audience: 'paynow-api' },
      }),
    }),
  ],
  controllers: [
    AuthController,
    OrganizationsController,
    ApiKeysController,
    MerchantContextController,
  ],
  providers: [
    PasswordHasher,
    TokenHasher,
    RefreshTokenService,
    AuthService,
    OrganizationsService,
    ApiKeysService,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    // O guard de papel vive em platform e depende desta porta. Ver ADR-0001:
    // módulo de domínio não importa módulo de domínio, então platform declara
    // o contrato e identity, que é quem sabe ler vínculo, o implementa.
    { provide: ORGANIZATION_MEMBERSHIP, useExisting: OrganizationsService },
  ],
  exports: [OrganizationsService, ORGANIZATION_MEMBERSHIP],
})
export class IdentityModule {}
