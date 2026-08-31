import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

/**
 * Exige PostgreSQL e Redis de pe. Rode `pnpm infra:up` antes.
 *
 * O teste sobe a aplicação inteira, sem substituir nenhuma dependência por
 * dublê: o objetivo do probe de prontidao é justamente afirmar que as conexões
 * reais funcionam, e verificar isso contra um mock não afirmaria nada.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  const http = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('responde 200 sem depender de banco ou fila', async () => {
      const response = await request(http()).get('/health/live').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        uptimeSeconds: expect.any(Number),
      });
    });
  });

  describe('GET /health/ready', () => {
    it('responde 200 com PostgreSQL e Redis acessiveis', async () => {
      const response = await request(http()).get('/health/ready').expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.checks.database.status).toBe('up');
      expect(response.body.checks.redis.status).toBe('up');
    });

    it('reporta a latência de cada dependência', async () => {
      const response = await request(http()).get('/health/ready').expect(200);

      expect(response.body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(response.body.checks.redis.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('prefixo de versão', () => {
    it('mantém as rotas de saude fora do prefixo /v1', async () => {
      await request(http()).get('/v1/health/live').expect(404);
    });
  });
});
