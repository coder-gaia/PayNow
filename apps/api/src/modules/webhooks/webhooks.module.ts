import { Module, type OnModuleInit } from '@nestjs/common';

import { OutboxService } from '../platform/events/outbox.service';
import { InboundWebhooksService } from './application/inbound-webhooks.service';
import { WebhookDispatcher } from './application/webhook-dispatcher';
import { WebhookEndpointsService } from './application/webhook-endpoints.service';
import { WebhookWorker } from './application/webhook-worker';
import { InboundWebhooksController } from './http/inbound-webhooks.controller';
import { WebhooksController } from './http/webhooks.controller';

/**
 * Webhooks, nas duas direções.
 *
 * Módulo de domínio próprio, e não parte de cobrança, porque a pergunta que ele
 * responde é de natureza diferente: cobrança sabe o que aconteceu com o
 * dinheiro, e webhooks sabe quem lá fora precisa ser avisado e se conseguiu
 * receber. Os dois mudam por motivos independentes.
 *
 * O que os liga é o outbox, e nada mais: este módulo não importa cobrança nem é
 * importado por ela. Ele se registra como consumidor e recebe os fatos.
 *
 * A entrada segue a mesma disciplina, e por obrigação: as fronteiras de módulo
 * proíbem um domínio importar outro, então o evento que o provedor manda chega
 * à cobrança por uma porta em `platform`, e não por uma chamada direta. A
 * proibição aqui não atrapalhou o desenho, ela o escolheu.
 */
@Module({
  controllers: [WebhooksController, InboundWebhooksController],
  providers: [WebhookDispatcher, WebhookEndpointsService, WebhookWorker, InboundWebhooksService],
  exports: [WebhookDispatcher, WebhookEndpointsService, InboundWebhooksService],
})
export class WebhooksModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  onModuleInit(): void {
    this.outbox.register(this.dispatcher);
  }
}
