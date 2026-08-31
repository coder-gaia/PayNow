import { Global, Module } from '@nestjs/common';

import { DomainEventPublisher } from './domain-event-publisher';

/**
 * Barramento de eventos de domínio.
 *
 * Global porque publicar é uma capacidade transversal, do mesmo jeito que ler
 * o relógio. Quem consome se registra com o token DOMAIN_EVENT_HANDLER no
 * próprio módulo.
 */
@Global()
@Module({
  providers: [DomainEventPublisher],
  exports: [DomainEventPublisher],
})
export class EventsModule {}
