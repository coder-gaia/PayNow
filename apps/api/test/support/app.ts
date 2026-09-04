import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';

import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';

/**
 * Sobe a aplicação com a mesma configuração do main.ts.
 *
 * Se o teste subisse a aplicação com outra configuração, ele estaria
 * verificando um sistema que não existe: o prefixo de rota e o pipe de
 * validação fazem parte do comportamento observavel da API.
 */
export interface TestAppOptions {
  /**
   * Provedores trocados por dublê.
   *
   * Usado com parcimônia: quase todo teste aqui roda contra o sistema inteiro
   * de propósito. A exceção legítima é o que sai do processo, como o envio de
   * email, onde o que interessa verificar é a mecânica de entrega e não o
   * servidor de terceiro.
   */
  readonly overrides?: readonly { token: unknown; value: unknown }[];
}

export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });

  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef = await builder.compile();
  // `rawBody` como no main.ts: sem ele o webhook de entrada recusaria tudo.
  const app = moduleRef.createNestApplication({ rawBody: true });

  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();
  return app;
}

export const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

/**
 * Email único por execução.
 *
 * Os testes rodam contra um banco de verdade que não e limpo entre execuções,
 * então isolar pelos dados é mais barato e mais rápido do que truncar tabelas,
 * e ainda deixa os testes seguros para rodar em paralelo.
 */
export const uniqueEmail = (prefix = 'teste'): string =>
  `${prefix}-${randomBytes(6).toString('hex')}@paynow.test`;

export const DEFAULT_PASSWORD = 'uma senha longa de teste';
