import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { Env } from '../../../config/env';
import { InboundWebhooksService } from './inbound-webhooks.service';
import { WebhookDispatcher } from './webhook-dispatcher';

/**
 * Quem entrega os webhooks, e quem retoma os que chegaram, quando ninguém
 * está olhando.
 *
 * Módulo próprio, e não uma linha a mais no worker de cobrança, porque a
 * fronteira da ADR-0001 proíbe cobrança de importar webhooks. A regra de lint
 * recusou a versão preguiçosa disto, e estava certa: cada módulo de domínio
 * agenda o próprio trabalho de fundo.
 *
 * Ligado por `WORKER_ENABLED`, o mesmo interruptor do ciclo de cobrança. Ver
 * ADR-0012 para o motivo de o worker morar no processo da API.
 *
 * A retomada dos recibos pendentes acontece aqui pelo mesmo motivo que a
 * entrega: sem gatilho automático, um evento que chegou e cujo efeito ficou
 * pela metade esperaria alguém reparar nele. É exatamente o caso que o desenho
 * da ADR-0016 existe para cobrir, e deixá-lo dependendo de atenção humana
 * anularia o argumento.
 */
@Injectable()
export class WebhookWorker {
  private readonly logger = new Logger(WebhookWorker.name);
  private readonly enabled: boolean;

  /** Trava de reentrada, pelo mesmo motivo do worker de cobrança. */
  private rodando = false;

  constructor(
    private readonly dispatcher: WebhookDispatcher,
    private readonly inbound: InboundWebhooksService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled || this.rodando) {
      return;
    }

    this.rodando = true;

    try {
      const relatorio = await this.dispatcher.dispatch();

      if (relatorio.delivered > 0 || relatorio.failed > 0) {
        this.logger.log(
          `Webhooks: ${relatorio.delivered} entregue(s), ` +
            `${relatorio.retrying} reagendada(s), ${relatorio.failed} desistida(s)`,
        );
      }
    } catch (error) {
      this.logger.error('Varredura de entrega de webhooks falhou', error);
    }

    // Separado do try acima de propósito: a entrega falhar não pode impedir a
    // retomada. As duas varreduras não dependem uma da outra, e juntá-las num
    // bloco só faria a primeira sequestrar a segunda.
    try {
      const { retomados } = await this.inbound.reprocessPending();

      if (retomados > 0) {
        this.logger.log(`Webhooks de entrada: ${retomados} recibo(s) retomado(s)`);
      }
    } catch (error) {
      this.logger.error('Retomada de webhooks de entrada falhou', error);
    } finally {
      this.rodando = false;
    }
  }
}
