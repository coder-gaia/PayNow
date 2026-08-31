import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { HealthService } from './health.service';

const ok = (): Promise<void> => Promise.resolve();
const fail = (message: string) => (): Promise<void> => Promise.reject(new Error(message));

const buildService = (database: () => Promise<void>, redis: () => Promise<void>): HealthService =>
  new HealthService(
    { ping: database } as unknown as PrismaService,
    { ping: redis } as unknown as RedisService,
  );

describe('HealthService', () => {
  describe('liveness', () => {
    it('responde ok sem consultar dependencia alguma', () => {
      const nunca = (): Promise<void> => new Promise(() => {});
      const report = buildService(nunca, nunca).liveness();

      expect(report.status).toBe('ok');
      expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('readiness', () => {
    it('responde ok quando todas as dependencias respondem', async () => {
      const report = await buildService(ok, ok).readiness();

      expect(report.status).toBe('ok');
      expect(report.checks.database?.status).toBe('up');
      expect(report.checks.redis?.status).toBe('up');
      expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('responde erro se qualquer dependencia falhar', async () => {
      const report = await buildService(ok, fail('conexao recusada')).readiness();

      expect(report.status).toBe('error');
      expect(report.checks.database?.status).toBe('up');
      expect(report.checks.redis?.status).toBe('down');
      expect(report.checks.redis?.error).toBe('conexao recusada');
    });

    it('reporta cada dependencia separadamente, sem uma mascarar a outra', async () => {
      const report = await buildService(fail('banco caiu'), fail('redis caiu')).readiness();

      expect(report.checks.database?.error).toBe('banco caiu');
      expect(report.checks.redis?.error).toBe('redis caiu');
    });

    it('mede a latencia de cada verificacao', async () => {
      const report = await buildService(ok, ok).readiness();

      expect(report.checks.database?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(report.checks.redis?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('trata dependencia pendurada como falha, e nao como espera infinita', async () => {
      jest.useFakeTimers();

      const pendurada = (): Promise<void> => new Promise(() => {});
      const pending = buildService(ok, pendurada).readiness();

      await jest.advanceTimersByTimeAsync(2_000);
      const report = await pending;

      expect(report.status).toBe('error');
      expect(report.checks.redis?.error).toMatch(/Tempo esgotado/);

      jest.useRealTimers();
    });
  });
});
