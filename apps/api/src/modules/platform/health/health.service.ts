import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { DependencyCheck, LivenessReport, ReadinessReport } from './health.dto';

/**
 * Probes de saude, escritos a mão em vez de usar @nestjs/terminus.
 *
 * As duas verificações de que o projeto precisa cabem em poucas linhas, e
 * escreve-las deixa explicito o comportamento que importa: cada dependência
 * tem tempo limite próprio e as verificações correm em paralelo, para que uma
 * dependência lenta não mascare a outra. Uma dependência a mais para setenta
 * linhas testadas não se paga.
 */
@Injectable()
export class HealthService {
  /** Um probe que demora mais do que isso já e um probe que falhou. */
  private static readonly TIMEOUT_MS = 2_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Responde se o processo esta vivo. Não toca em dependência externa de
   * propósito: um banco fora do ar não e motivo para o orquestrador reiniciar
   * o container, e sim para tira-lo do balanceador.
   */
  liveness(): LivenessReport {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Responde se o processo consegue atender tráfego de verdade. */
  async readiness(): Promise<ReadinessReport> {
    const [database, cache] = await Promise.all([
      this.probe(() => this.prisma.ping()),
      this.probe(() => this.redis.ping()),
    ]);

    const checks: Record<string, DependencyCheck> = { database, redis: cache };
    const healthy = Object.values(checks).every((check) => check.status === 'up');

    return {
      status: healthy ? 'ok' : 'error',
      // Uso legitimo do relógio de parede: o probe reporta hora real de
      // observacao, e não tempo de domínio. A ADR-0009 rege o tempo do
      // domínio, é por isso o módulo platform esta fora da regra de lint.
      checkedAt: new Date().toISOString(),
      checks,
    };
  }

  private async probe(run: () => Promise<void>): Promise<DependencyCheck> {
    const startedAt = performance.now();

    try {
      await this.withTimeout(run());
      return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withTimeout(operation: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Tempo esgotado após ${HealthService.TIMEOUT_MS}ms`)),
        HealthService.TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
