import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { DomainEvent, DomainEventHandler, EventType } from './domain-event';
import { OutboxService } from './outbox.service';

/**
 * Publicador de eventos de domínio.
 *
 * Entrega para todos os handlers registrados, dentro da transação de quem
 * publicou. Se qualquer handler falhar, a transação inteira volta atrás: a
 * assinatura não muda se o lançamento contábil não puder ser escrito.
 *
 * A ordem de entrega não é garantida e nenhum handler deve depender de outro.
 * Handler que precisa de resultado de handler é acoplamento disfarçado, e o
 * lugar certo para essa lógica é quem publicou.
 *
 * Um `publish` faz duas coisas, e as duas na mesma transação: chama os
 * handlers síncronos e grava a mensagem no outbox para quem consome depois do
 * commit. Não são alternativas, são garantias diferentes. Ver ADR-0006.
 */
@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name);
  private readonly porTipo = new Map<EventType, DomainEventHandler[]>();

  constructor(private readonly outbox: OutboxService) {}

  /**
   * Registra um consumidor.
   *
   * O Nest não tem provider múltiplo como o Angular, então o registro é
   * explícito: cada módulo chama isto no seu `onModuleInit`. O efeito colateral
   * é bom, aliás: fica visível no módulo quais eventos ele consome, em vez de
   * escondido em uma anotação.
   */
  register(handler: DomainEventHandler): void {
    for (const tipo of handler.handles) {
      const lista = this.porTipo.get(tipo) ?? [];
      lista.push(handler);
      this.porTipo.set(tipo, lista);
    }
  }

  async publish(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    const handlers = this.porTipo.get(event.type) ?? [];

    if (handlers.length === 0) {
      // Não é erro: nem todo evento interessa a alguém hoje. Vale registrar,
      // porque um evento que ninguém consome costuma indicar handler esquecido.
      this.logger.debug(`Evento ${event.type} publicado sem nenhum handler síncrono.`);
    }

    for (const handler of handlers) {
      await handler.handle(event, tx);
    }

    // A mensagem entra na mesma transação. Se qualquer handler acima falhar, ou
    // se quem publicou desistir depois, ela desaparece junto: não se anuncia
    // para fora um fato que não aconteceu.
    await this.outbox.enqueue(event, tx);
  }
}
