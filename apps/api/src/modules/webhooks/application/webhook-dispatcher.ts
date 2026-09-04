import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Prisma, WebhookDeliveryStatus } from '@prisma/client';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { addMilliseconds } from '../../platform/clock/duration';
import type { EventType } from '../../platform/events/domain-event';
import type { OutboxConsumer, OutboxMessage } from '../../platform/events/outbox';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { nextDelaySeconds, shouldRetry } from '../domain/delivery-schedule';
import { signWebhook, SIGNATURE_HEADER } from '../domain/signature';

/** Quantas entregas uma varredura tenta. */
const LOTE = 100;

/** Quanto tempo esperamos por uma resposta antes de desistir da tentativa. */
const TIMEOUT_MS = 10_000;

/** Quanto do corpo de resposta é guardado quando a entrega falha. */
const ERRO_MAX = 500;

export interface DispatchReport {
  readonly delivered: number;
  readonly retrying: number;
  readonly failed: number;
}

/**
 * Entrega de eventos aos endereços do merchant.
 *
 * O desenho tem uma sutileza que é o ponto inteiro desta classe.
 *
 * O outbox entrega uma mensagem a todos os consumidores registrados, e se
 * qualquer um falhar a mensagem inteira volta para a fila, o que faz os que já
 * receberam receberem de novo. Com vários endereços assinando o mesmo evento,
 * um endereço fora do ar causaria reentrega a todos os outros.
 *
 * Por isso **este consumidor não faz chamada HTTP nenhuma**. Ele só cria uma
 * linha de entrega por endereço, que é escrita local e não falha por motivo
 * transitório. Quem chama a rede é `dispatch`, uma varredura separada, com
 * retentativa por endereço.
 *
 * O índice único sobre (endereço, evento) fecha o desenho: o consumidor pode
 * ser reexecutado à vontade, porque criar a mesma entrega duas vezes é recusado
 * pelo banco.
 */
@Injectable()
export class WebhookDispatcher implements OutboxConsumer {
  readonly name = 'webhooks';

  private readonly logger = new Logger(WebhookDispatcher.name);

  /**
   * Todos os eventos.
   *
   * O filtro por tipo é do endereço, e não do consumidor: quem integra decide o
   * que quer receber. Decidir aqui exigiria mudar código para cada assinatura
   * nova.
   */
  readonly handles: readonly EventType[] = [
    'subscription.started',
    'subscription.trial_started',
    'subscription.plan_changed',
    'subscription.canceled',
    'subscription.renewed',
    'invoice.issued',
    'payment.succeeded',
    'payment.failed',
    'refund.issued',
  ];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Enfileira uma entrega por endereço interessado.
   *
   * Nada de rede acontece aqui. Se um endereço for cadastrado depois deste
   * momento, ele não recebe o evento passado, e isso é deliberado: assinar não
   * é pedir histórico. Reenvio de evento antigo é operação explícita.
   */
  async deliver(message: OutboxMessage): Promise<void> {
    const enderecos = await this.prisma.webhookEndpoint.findMany({
      where: { organizationId: message.organizationId, enabled: true },
    });

    const interessados = enderecos.filter(
      (endereco) =>
        endereco.eventTypes.length === 0 || endereco.eventTypes.includes(message.eventType),
    );

    if (interessados.length === 0) {
      return;
    }

    await this.prisma.webhookDelivery.createMany({
      data: interessados.map((endereco) => ({
        organizationId: message.organizationId,
        endpointId: endereco.id,
        eventType: message.eventType,
        eventId: message.eventId,
        // O payload vem do outbox como `unknown`, porque passou pelo banco.
        // A conversão é explícita aqui, no ponto em que ele volta a ser JSON.
        payload: this.envelope(message) as Prisma.InputJsonValue,
        occurredAt: message.occurredAt,
        nextAttemptAt: this.clock.now(),
      })),
      // Uma reentrega do outbox não pode criar entregas duplicadas. O índice
      // único recusa, e aqui a recusa é o comportamento desejado e não erro.
      skipDuplicates: true,
    });
  }

  /**
   * Entrega o que está pendente.
   *
   * Cada entrega é independente: uma falha não afeta as outras, nem mesmo as do
   * mesmo endereço. Ordenar por `nextAttemptAt` faz o mais atrasado sair
   * primeiro.
   */
  async dispatch(): Promise<DispatchReport> {
    const agora = this.clock.now();

    const pendentes = await this.prisma.webhookDelivery.findMany({
      where: {
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: { lte: agora },
      },
      include: { endpoint: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: LOTE,
    });

    let delivered = 0;
    let retrying = 0;
    let failed = 0;

    for (const entrega of pendentes) {
      const resultado = await this.tentar(
        entrega.id,
        entrega.endpoint.url,
        entrega.endpoint.secret,
        entrega.payload,
      );

      if (resultado === 'entregue') {
        delivered += 1;
      } else if (resultado === 'desistiu') {
        failed += 1;
      } else {
        retrying += 1;
      }
    }

    return { delivered, retrying, failed };
  }

  /** Reenvia uma entrega, inclusive uma que já tinha desistido. */
  async replay(organizationId: string, deliveryId: string): Promise<void> {
    await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, organizationId },
      data: {
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: this.clock.now(),
        // As tentativas voltam a zero: um reenvio pedido por uma pessoa merece
        // o calendário inteiro de novo, e não o resto do que sobrou.
        attempts: 0,
        lastError: null,
      },
    });
  }

  private async tentar(
    deliveryId: string,
    url: string,
    secret: string,
    payload: unknown,
  ): Promise<'entregue' | 'reagendada' | 'desistiu'> {
    const agora = this.clock.now();
    const assinado = signWebhook(payload, secret, agora);
    // `performance.now()` e nao `Date.now()`: isto mede duracao, nao le hora.
    // O relogio de parede pode andar para tras com ajuste de NTP, e ai a
    // duracao sai negativa. O monotonico nunca anda para tras.
    const inicio = performance.now();

    let statusCode: number | null = null;
    let erro: string;

    try {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: assinado.header,
          'user-agent': 'Paynow-Webhooks/1.0',
        },
        body: assinado.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      statusCode = resposta.status;

      if (!shouldRetry(resposta.status)) {
        if (resposta.status >= 200 && resposta.status < 300) {
          await this.marcarEntregue(
            deliveryId,
            resposta.status,
            Math.round(performance.now() - inicio),
          );
          return 'entregue';
        }

        // 410 Gone: o endereço disse que não existe mais. Não é sucesso, e
        // insistir é desperdício dos dois lados.
        await this.desistir(deliveryId, resposta.status, 'O endereço respondeu 410 Gone.');
        return 'desistiu';
      }

      erro = `Resposta ${resposta.status}.`;
    } catch (causa) {
      erro = causa instanceof Error ? causa.message : String(causa);
    }

    return this.reagendar(deliveryId, statusCode, erro, Math.round(performance.now() - inicio));
  }

  private async marcarEntregue(
    deliveryId: string,
    statusCode: number,
    duracao: number,
  ): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.SUCCEEDED,
        deliveredAt: this.clock.now(),
        attempts: { increment: 1 },
        lastStatusCode: statusCode,
        lastDurationMs: duracao,
        lastError: null,
        nextAttemptAt: null,
      },
    });
  }

  private async reagendar(
    deliveryId: string,
    statusCode: number | null,
    erro: string | null,
    duracao: number,
  ): Promise<'reagendada' | 'desistiu'> {
    const atual = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: { attempts: true, endpoint: { select: { url: true } } },
    });

    const tentativas = atual.attempts + 1;
    const espera = nextDelaySeconds(tentativas);

    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: tentativas,
        lastStatusCode: statusCode,
        lastError: erro?.slice(0, ERRO_MAX) ?? null,
        lastDurationMs: duracao,
        ...(espera === null
          ? { status: WebhookDeliveryStatus.FAILED, nextAttemptAt: null }
          : { nextAttemptAt: addMilliseconds(this.clock.now(), espera * 1000) }),
      },
    });

    if (espera === null) {
      this.logger.error(
        `Entrega ${deliveryId} para ${atual.endpoint.url} desistiu após ${tentativas} tentativas: ${erro ?? 'sem motivo'}`,
      );
      return 'desistiu';
    }

    return 'reagendada';
  }

  private async desistir(deliveryId: string, statusCode: number, motivo: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        lastStatusCode: statusCode,
        lastError: motivo,
        nextAttemptAt: null,
      },
    });
  }

  /**
   * O que o merchant recebe.
   *
   * Envelope estável, com o payload dentro em vez de espalhado na raiz: assim
   * dá para acrescentar metadado depois sem colidir com nome de campo do
   * evento, e quem recebe pode rotear por `type` sem inspecionar o conteúdo.
   */
  private envelope(message: OutboxMessage) {
    return {
      id: message.eventId,
      type: message.eventType,
      occurredAt: message.occurredAt.toISOString(),
      organizationId: message.organizationId,
      data: message.payload,
    };
  }
}
