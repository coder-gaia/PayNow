import { Global, Module } from '@nestjs/common';

import { DomainEventPublisher } from './domain-event-publisher';
import { OutboxService } from './outbox.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Barramento de eventos de domínio.
 *
 * Global porque publicar é uma capacidade transversal, do mesmo jeito que ler
 * o relógio. Quem consome se registra no `onModuleInit` do próprio módulo, o
 * que deixa visível ali quais eventos aquele módulo escuta.
 *
 * São dois caminhos de entrega, com garantias diferentes: handler síncrono
 * dentro da transação, e consumidor de outbox depois do commit. Ver ADR-0006.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [DomainEventPublisher, OutboxService],
  exports: [DomainEventPublisher, OutboxService],
})
export class EventsModule {}
