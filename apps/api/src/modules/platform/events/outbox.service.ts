import { Inject, Injectable, Logger } from '@nestjs/common';
import { OutboxStatus, type Prisma } from '@prisma/client';

import { CLOCK, type Clock } from '../clock/clock';
import { addMilliseconds } from '../clock/duration';
import { PrismaService } from '../prisma/prisma.service';
import type { DomainEvent, EventType } from './domain-event';
import type { OutboxConsumer, OutboxMessage } from './outbox';

/**
 * Espera entre tentativas de entrega, em milissegundos.
 *
 * Cresce porque as causas mudam: os primeiros segundos cobrem um serviço
 * reiniciando, os minutos cobrem uma indisponibilidade curta, e a última espera
 * cobre alguém precisando acordar para consertar alguma coisa.
 */
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000] as const;

/** Quantas mensagens uma varredura entrega. */
const LOTE = 100;

/**
 * Por quanto tempo uma mensagem tomada some da fila.
 *
 * A janela precisa ser maior do que a entrega mais lenta que se admite, para
 * que ninguém a tome de novo enquanto ela está sendo entregue, e pequena o
 * bastante para que um processo morto no meio não a prenda por muito tempo.
 */
const VISIBILIDADE_MS = 60_000;

export interface RelayReport {
  readonly delivered: number;
  readonly failed: number;
  readonly retrying: number;
}

/**
 * Outbox transacional.
 *
 * O problema que ele resolve é velho e não tem meio-termo. Você mudou o estado
 * no banco e precisa contar isso a alguém de fora. Se contar antes do commit,
 * pode estar anunciando um fato que a transação vai desfazer. Se contar depois,
 * o processo pode morrer entre o commit e o anúncio, e ninguém nunca saberá.
 *
 * A saída é não contar: **gravar a intenção de contar**, na mesma transação. O
 * commit que salva a mudança salva também a mensagem, e as duas coisas passam a
 * ser um fato só. A entrega vem depois, quantas vezes for preciso.
 *
 * Isto **não substitui** a entrega síncrona dentro da transação, e a diferença
 * é deliberada. O razão continua sendo escrito no mesmo commit que a mudança
 * que o originou, porque ali a garantia necessária é atomicidade, e o outbox
 * entrega no máximo "eventualmente". Trocar um pelo outro seria rebaixar a
 * garantia mais importante do sistema. As duas coisas convivem: um `publish`
 * dispara os handlers em transação **e** grava a mensagem para quem está fora.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private readonly porTipo = new Map<EventType, OutboxConsumer[]>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Registra quem recebe depois do commit. Ver o comentário em outbox.ts. */
  register(consumer: OutboxConsumer): void {
    for (const tipo of consumer.handles) {
      const lista = this.porTipo.get(tipo) ?? [];
      lista.push(consumer);
      this.porTipo.set(tipo, lista);
    }

    this.logger.log(`Consumidor ${consumer.name} registrado para ${consumer.handles.join(', ')}`);
  }

  /**
   * Grava a mensagem na transação de quem publicou.
   *
   * Mensagem sem consumidor nenhum não é gravada. Guardar tudo daria um log de
   * eventos, que é outra coisa e teria outro desenho: aqui a linha existe
   * porque alguém precisa recebê-la, e uma linha que ninguém vai ler só ocupa
   * espaço e confunde quem for inspecionar a fila.
   */
  async enqueue(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    if (!this.porTipo.has(event.type)) {
      return;
    }

    await tx.outboxMessage.create({
      data: {
        organizationId: event.organizationId,
        eventType: event.type,
        eventId: event.id,
        payload: JSON.parse(JSON.stringify(event.payload)) as Prisma.InputJsonValue,
        occurredAt: event.occurredAt,
        nextAttemptAt: event.occurredAt,
      },
    });
  }

  /**
   * Entrega o que está pendente.
   *
   * Cada mensagem é entregue a todos os consumidores do tipo, e só é marcada
   * como entregue se todos aceitarem. Um consumidor que falha faz a mensagem
   * inteira voltar para a fila, o que significa que os outros vão recebê-la de
   * novo. É a consequência de "pelo menos uma vez", e é por isso que o contrato
   * exige que quem consome aguente repetição.
   */
  async relay(): Promise<RelayReport> {
    const agora = this.clock.now();

    const pendentes = await this.tomar(agora);

    let delivered = 0;
    let failed = 0;
    let retrying = 0;

    for (const linha of pendentes) {
      const consumidores = this.porTipo.get(linha.event_type as EventType) ?? [];

      const mensagem: OutboxMessage = {
        id: linha.id,
        organizationId: linha.organization_id,
        eventType: linha.event_type as EventType,
        eventId: linha.event_id,
        payload: linha.payload,
        occurredAt: linha.occurred_at,
        attempts: linha.attempts,
      };

      try {
        for (const consumidor of consumidores) {
          await consumidor.deliver(mensagem);
        }

        await this.prisma.outboxMessage.update({
          where: { id: linha.id },
          data: {
            status: OutboxStatus.DELIVERED,
            deliveredAt: this.clock.now(),
            attempts: linha.attempts + 1,
            nextAttemptAt: null,
            lastError: null,
          },
        });

        delivered += 1;
      } catch (error) {
        const tentativas = linha.attempts + 1;
        const espera = BACKOFF_MS[tentativas - 1];
        const motivo = error instanceof Error ? error.message : String(error);

        await this.prisma.outboxMessage.update({
          where: { id: linha.id },
          data: {
            attempts: tentativas,
            lastError: motivo.slice(0, 500),
            // Esgotadas as tentativas, a mensagem fica como FAILED e não some.
            // Apagar o que não conseguiu ser entregue é apagar a única
            // evidência de que alguém lá fora não soube de algo que aconteceu
            // aqui.
            ...(espera === undefined
              ? { status: OutboxStatus.FAILED, nextAttemptAt: null }
              : { nextAttemptAt: addMilliseconds(agora, espera) }),
          },
        });

        if (espera === undefined) {
          failed += 1;
          this.logger.error(
            `Mensagem ${linha.id} (${linha.event_type}) desistiu após ${tentativas} tentativas: ${motivo}`,
          );
        } else {
          retrying += 1;
          this.logger.warn(
            `Mensagem ${linha.id} (${linha.event_type}) falhou na tentativa ${tentativas}: ${motivo}`,
          );
        }
      }
    }

    return { delivered, failed, retrying };
  }

  /**
   * Toma um lote para si, de forma que ninguém mais o tome.
   *
   * Duas varreduras rodando ao mesmo tempo, seja em dois processos ou em dois
   * testes, leriam as mesmas linhas pendentes e entregariam tudo duas vezes.
   * Ler e depois marcar não resolve: a corrida está entre a leitura e a marca.
   *
   * `FOR UPDATE SKIP LOCKED` resolve dentro do banco. Quem chega primeiro
   * trava as linhas; quem chega depois as pula e pega as seguintes, em vez de
   * esperar. O `UPDATE` empurra a próxima tentativa para o futuro, o que tira
   * a mensagem da fila pela janela de visibilidade: se este processo morrer no
   * meio da entrega, ela reaparece sozinha e alguém tenta de novo.
   *
   * A ordenação tem desempate por `id` de propósito. Com o relógio congelado,
   * vários fatos compartilham o mesmo `occurred_at`, e ordenar só por ele
   * deixaria a ordem de entrega a critério do banco. O `id` é UUIDv7, que
   * cresce com o tempo de inserção, então o desempate reproduz a ordem em que
   * as mensagens foram gravadas. Ordem de entrega nunca foi garantia do
   * contrato, mas determinismo é: a fase 07 depende de a mesma sequência de
   * comandos produzir a mesma história.
   *
   * A entrega continua sendo pelo menos uma vez. Isto não promete exatamente
   * uma vez, e nada prometeria: o processo pode morrer entre a entrega e a
   * marca de entregue, e o consumidor receberá de novo. O que isto elimina é a
   * duplicação sistemática de dois relays paralelos, que é diferente da
   * duplicação rara de uma falha no meio.
   */
  private async tomar(agora: Date) {
    return this.prisma.$queryRaw<
      {
        id: string;
        organization_id: string;
        event_type: string;
        event_id: string;
        payload: unknown;
        occurred_at: Date;
        attempts: number;
      }[]
    >`
      UPDATE outbox_messages
         SET next_attempt_at = ${addMilliseconds(agora, VISIBILIDADE_MS)}
       WHERE id IN (
         SELECT id
           FROM outbox_messages
          WHERE status = 'PENDING'
            AND (next_attempt_at IS NULL OR next_attempt_at <= ${agora})
          ORDER BY occurred_at, id
          LIMIT ${LOTE}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING id, organization_id, event_type, event_id, payload, occurred_at, attempts
    `;
  }

  /** Números da fila, para o painel e para o health check. */
  async stats(organizationId?: string) {
    const where = organizationId === undefined ? {} : { organizationId };

    const [pending, failed, delivered] = await Promise.all([
      this.prisma.outboxMessage.count({ where: { ...where, status: OutboxStatus.PENDING } }),
      this.prisma.outboxMessage.count({ where: { ...where, status: OutboxStatus.FAILED } }),
      this.prisma.outboxMessage.count({ where: { ...where, status: OutboxStatus.DELIVERED } }),
    ]);

    return { pending, failed, delivered };
  }
}
