import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../../config/env';
import { ApiKeysService } from './application/api-keys.service';
import { AuthService } from './application/auth.service';
import { OrganizationsService } from './application/organizations.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { ApiKeysController, MerchantContextController } from './http/api-keys.controller';
import { AuthController } from './http/auth.controller';
import { AuthenticationGuard } from './http/authentication.guard';
import { OrganizationsController } from './http/organizations.controller';
import { PasswordHasher } from './infrastructure/password-hasher';
import { TokenHasher } from './infrastructure/token-hasher';

/**
 * Identidade: usuarios, organizacoes, papeis e chaves de API.
 *
 * O guard de autenticacao e registrado como APP_GUARD, ou seja, vale para toda
 * a aplicacao. Autenticacao passa a ser o padrao e a excecao precisa ser
 * declarada com `@Public()`, e nao o contrario: esquecer de proteger uma rota
 * e um erro silencioso, esquecer de liberar uma e um 401 obvio no primeiro
 * teste.
 */
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
  ],
  exports: [OrganizationsService],
})
export class IdentityModule {}
