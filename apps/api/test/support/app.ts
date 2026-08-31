import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';

/**
 * Sobe a aplicacao com a mesma configuracao do main.ts.
 *
 * Se o teste subisse a aplicacao com outra configuracao, ele estaria
 * verificando um sistema que nao existe: o prefixo de rota e o pipe de
 * validacao fazem parte do comportamento observavel da API.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();
  return app;
}

export const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

/**
 * Email unico por execucao.
 *
 * Os testes rodam contra um banco de verdade que nao e limpo entre execucoes,
 * entao isolar pelos dados e mais barato e mais rapido do que truncar tabelas,
 * e ainda deixa os testes seguros para rodar em paralelo.
 */
export const uniqueEmail = (prefix = 'teste'): string =>
  `${prefix}-${randomBytes(6).toString('hex')}@paynow.test`;

export const DEFAULT_PASSWORD = 'uma senha longa de teste';
