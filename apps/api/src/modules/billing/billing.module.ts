import { Module } from '@nestjs/common';

import { BillingCycleService } from './application/billing-cycle.service';
import { CatalogService } from './application/catalog.service';
import { InvoicesService } from './application/invoices.service';
import { PaymentsService } from './application/payments.service';
import { SubscriptionsService } from './application/subscriptions.service';
import { BillingClockController } from './http/billing-clock.controller';
import { BillingController } from './http/billing.controller';
import { PaymentsController } from './http/payments.controller';

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
 * Pagamentos e faturas entraram aqui pelo mesmo argumento, na fase 05. Uma
 * fatura sem pagamento e um pagamento sem fatura não significam nada, e as
 * duas coisas mudam sempre juntas com a assinatura que as origina. Separá-las
 * teria criado uma porta em `platform` para cada leitura de fatura, que é a
 * cerimônia que a fronteira existe para evitar, não para criar.
 *
 * O que continua separado é o razão, e esse sim por um motivo real: política
 * contábil muda por decisão de negócio, não por mudança de produto. O gateway
 * também fica fora, mas como porta em `platform`: ele é infraestrutura, e a
 * escolha de quem o implementa é da raiz de composição. Ver ADR-0011.
 */
@Module({
  controllers: [BillingController, BillingClockController, PaymentsController],
  providers: [
    BillingCycleService,
    CatalogService,
    InvoicesService,
    PaymentsService,
    SubscriptionsService,
  ],
  exports: [
    BillingCycleService,
    CatalogService,
    InvoicesService,
    PaymentsService,
    SubscriptionsService,
  ],
})
export class BillingModule {}
