import { Injectable, Logger } from '@nestjs/common';

import type {
  GatewayNotification,
  GatewayNotificationHandler,
  GatewayNotificationResult,
} from './gateway-notification';

/**
 * Onde o módulo de webhooks encontra quem sabe conciliar uma cobrança.
 *
 * Um handler só, e não uma lista como no outbox. A diferença não é preguiça: um
 * evento do outbox é um fato anunciado, e quantos quiserem podem escutar. Uma
 * notificação de provedor é uma **instrução** sobre uma cobrança específica, e
 * ela tem um dono correto. Dois handlers conciliando o mesmo pagamento
 * disputariam a mesma linha, e o segundo veria o trabalho do primeiro já feito.
 */
@Injectable()
export class GatewayNotifications {
  private readonly logger = new Logger(GatewayNotifications.name);
  private handler: GatewayNotificationHandler | null = null;

  register(handler: GatewayNotificationHandler): void {
    if (this.handler !== null) {
      throw new Error(
        `Já existe um handler de notificação de gateway registrado (${this.handler.name}).`,
      );
    }

    this.handler = handler;
    this.logger.log(`Notificações de gateway serão aplicadas por ${handler.name}.`);
  }

  async apply(
    notification: GatewayNotification,
  ): Promise<{ result: GatewayNotificationResult; organizationId?: string; note: string }> {
    if (this.handler === null) {
      // Sem handler, a notificação não pode ser aplicada nem descartada em
      // silêncio: descartar perderia o desfecho de uma cobrança de verdade.
      throw new Error('Nenhum handler de notificação de gateway foi registrado.');
    }

    return this.handler.applyGatewayNotification(notification);
  }
}
