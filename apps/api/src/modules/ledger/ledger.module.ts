import { Module, type OnModuleInit } from '@nestjs/common';

import { LedgerService } from './application/ledger.service';
import { SubscriptionAccountingHandler } from './application/subscription-accounting.handler';
import { DomainEventPublisher } from '../platform/events/domain-event-publisher';
import { LedgerController } from './http/ledger.controller';

/**
 * O razão.
 *
 * Exporta o serviço porque, a partir da fase 05, pagamentos e assinaturas
 * precisam registrar lançamentos. A comunicação entre eles não será por import
 * direto, que a ADR-0001 proíbe, e sim pelo outbox: quem move dinheiro pública
 * o evento, e o consumidor do ledger o transforma em lançamento.
 */
@Module({
  controllers: [LedgerController],
  providers: [LedgerService, SubscriptionAccountingHandler],
  exports: [LedgerService],
})
export class LedgerModule implements OnModuleInit {
  constructor(
    private readonly publisher: DomainEventPublisher,
    private readonly subscriptionAccounting: SubscriptionAccountingHandler,
  ) {}

  onModuleInit(): void {
    this.publisher.register(this.subscriptionAccounting);
  }
}
