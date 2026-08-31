import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { Env } from '../../../config/env';

/**
 * Conexão única com o Redis, compartilhada pelas filas e pelo cache.
 *
 * `maxRetriesPerRequest: null` e exigência do BullMQ, que precisa que comandos
 * bloqueantes fiquem pendurados em vez de falharem por limite de tentativas.
 * Deixar o padrão aqui quebra o worker de um jeito difícil de diagnosticar.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Conectado ao Redis');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Comando mínimo usado pelo probe de prontidao. */
  async ping(): Promise<void> {
    const reply: string = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`Resposta inesperada do Redis ao PING: ${reply}`);
    }
  }
}
