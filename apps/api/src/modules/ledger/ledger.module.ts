import { Module, type OnModuleInit } from '@nestjs/common';

import { BillingAccountingHandler } from './application/billing-accounting.handler';
import { LedgerService } from './application/ledger.service';
import { DomainEventPublisher } from '../platform/events/domain-event-publisher';
import { LedgerController } from './http/ledger.controller';

/**
 * O razão.
 *
 * Não importa nenhum módulo de domínio e não é importado por nenhum. O que o
 * liga ao resto do sistema é o barramento de eventos: quem move dinheiro
 * publica o fato, e a política contábil daqui o transforma em lançamento.
 *
 * O registro do consumidor é explícito, e não por anotação, porque assim fica
 * visível no módulo quais eventos ele consome em vez de escondido em um
 * decorador longe daqui.
 */
@Module({
  controllers: [LedgerController],
  providers: [LedgerService, BillingAccountingHandler],
  exports: [LedgerService],
})
export class LedgerModule implements OnModuleInit {
  constructor(
    private readonly publisher: DomainEventPublisher,
    private readonly billingAccounting: BillingAccountingHandler,
  ) {}

  onModuleInit(): void {
    this.publisher.register(this.billingAccounting);
  }
}
