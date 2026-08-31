import { Module } from '@nestjs/common';

import { BillingCycleService } from './application/billing-cycle.service';
import { CatalogService } from './application/catalog.service';
import { SubscriptionsService } from './application/subscriptions.service';
import { BillingClockController } from './http/billing-clock.controller';
import { BillingController } from './http/billing.controller';

/**
 * Cobrança: clientes do merchant, produtos, preços e assinaturas.
 *
 * O desenho da fase 00 previa `catalog` e `subscriptions` como módulos
 * separados, e estava errado. A fronteira da ADR-0001 existe para separar o
 * que poderia um dia rodar em processos diferentes, e uma assinatura sem preço
 * não significa nada: os dois mudam juntos, são lidos juntos e nunca seriam
 * implantados separados. Separá-los teria criado uma porta em `platform` para
 * cada leitura de preço, que é cerimônia sem ganho.
 *
 * O que continua separado é o razão, e esse sim por um motivo real: política
 * contábil muda por decisão de negócio, não por mudança de produto.
 */
@Module({
  controllers: [BillingController, BillingClockController],
  providers: [BillingCycleService, CatalogService, SubscriptionsService],
  exports: [BillingCycleService, CatalogService, SubscriptionsService],
})
export class BillingModule {}
