import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { BillingCycleService } from '../src/modules/billing/application/billing-cycle.service';
import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../src/modules/billing/application/payments.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { RETRY_SCHEDULE_HOURS } from '../src/modules/billing/domain/dunning';
import { ClockScopeStorage } from '../src/modules/platform/clock/clock-scope';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { FakeGateway } from '../src/modules/platform/payments/fake-gateway';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { InboundWebhooksService } from '../src/modules/webhooks/application/inbound-webhooks.service';
import { signWebhook } from '../src/modules/webhooks/domain/signature';
import { createTestApp } from './support/app';

const SEGREDO = process.env['INBOUND_WEBHOOK_SECRET'] ?? 'whsec_fake_provider_desenvolvimento';

/**
 * Dinheiro que chega depois da recuperação ter desistido.
 *
 * A suíte adversarial da fase 07 encontrou este caso e não conseguia afirmar
 * nada sobre ele: a assinatura já tinha caído quando o provedor apareceu
 * dizendo que a cobrança tinha dado certo. É a situação em que o merchant fica
 * com o dinheiro na mão e sem assinatura.
 *
 * A decisão está na ADR-0018, e a linha que ela traça é entre uma assinatura
 * que ainda está viva e uma que já morreu.
 */
describe('Recuperação tardia (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let payments: PaymentsService;
  let inbound: InboundWebhooksService;
  let ledger: LedgerService;
  let cycle: BillingCycleService;
  let gateway: FakeGateway;
  let clocks: OrganizationClockService;
  let scopes: ClockScopeStorage;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    payments = app.get(PaymentsService);
    inbound = app.get(InboundWebhooksService);
    ledger = app.get(LedgerService);
    cycle = app.get(BillingCycleService);
    gateway = app.get(FakeGateway);
    clocks = app.get(OrganizationClockService);
    scopes = app.get(ClockScopeStorage);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gateway.reset();
  });

  const montar = async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Recuperação Tardia', slug: `rt-${randomUUID().slice(0, 8)}` },
    });

    await clocks.freeze(organization.id, new Date('2027-03-01T12:00:00.000Z'));

    const customer = await catalog.createCustomer(organization.id, {
      email: `rt-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Cliente Persistente',
    });

    await catalog.attachPaymentMethod(organization.id, customer.id, {
      token: `pm_${randomUUID()}`,
      brand: 'visa',
      last4: '4242',
    });

    const product = await catalog.createProduct(organization.id, { name: 'Plano Recuperação' });

    const price = await catalog.createPrice(organization.id, product.id, {
      amount: Money.fromDecimal('100.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    const subscription = await clocks.runFor(organization.id, () =>
      subscriptions.start({
        organizationId: organization.id,
        customerId: customer.id,
        priceId: price.id,
      }),
    );

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });

    return { organizationId: organization.id, subscription, invoice };
  };

  /** Adianta o relógio e roda o ciclo, como o worker faria. */
  const avancarHoras = async (organizationId: string, horas: number) => {
    const estado = await clocks.advance(organizationId, horas * 60 * 60 * 1000);

    return scopes.run({ organizationId, now: estado.now, virtual: true }, () =>
      cycle.runDue(organizationId),
    );
  };

  /**
   * Leva a assinatura até o fim do calendário de recuperação.
   *
   * A primeira cobrança é a que a torna ACTIVE, e ela precisa dar certo: uma
   * assinatura que nunca pagou fica em INCOMPLETE, e a queda para PAST_DUE não
   * se aplica a ela. Só depois de ter pago uma vez é que a recusa a derruba.
   *
   * A fatura recusada é a da renovação, que só existe depois de o ciclo virar.
   */
  const esgotarRecuperacao = async (organizationId: string, invoiceId: string) => {
    gateway.setScenario({ kind: 'succeed' });
    await clocks.runFor(organizationId, () => payments.chargeInvoice(organizationId, invoiceId));

    // Um mês adiante: o ciclo renova e emite a fatura seguinte, que o ciclo já
    // tenta cobrar. A partir daqui tudo é recusado.
    gateway.setScenario({ kind: 'decline' });
    await avancarHoras(organizationId, 24 * 31);

    const segunda = await prisma.invoice.findFirstOrThrow({
      where: { organizationId, status: { not: InvoiceStatus.PAID } },
    });

    // O calendário inteiro, mais a tentativa que o esgota.
    for (const horas of RETRY_SCHEDULE_HOURS) {
      await avancarHoras(organizationId, horas + 1);
    }

    return segunda;
  };

  const entregarDesfecho = async (idempotencyKey: string, reference: string) => {
    const corpo = {
      id: `evt_${randomUUID()}`,
      type: 'charge.succeeded',
      data: { idempotencyKey, reference },
    };

    const assinado = signWebhook(corpo, SEGREDO, new Date());
    return inbound.receive('fake', assinado.body, assinado.header);
  };

  it('a assinatura que ainda não morreu volta a valer quando o dinheiro entra', async () => {
    const { organizationId, invoice } = await montar();
    const segunda = await esgotarRecuperacao(organizationId, invoice.id);

    const antes = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
    expect(antes.status).toBe(SubscriptionStatus.UNPAID);

    // O provedor aparece agora, dizendo que uma das tentativas tinha dado certo.
    const tentativa = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: segunda.id },
      orderBy: { attempt: 'desc' },
    });

    await prisma.payment.update({
      where: { id: tentativa.id },
      data: { status: PaymentStatus.PENDING },
    });

    await entregarDesfecho(tentativa.idempotencyKey, 'fake_ch_chegou_tarde');

    const depois = await prisma.subscription.findFirstOrThrow({ where: { organizationId } });
    expect(depois.status).toBe(SubscriptionStatus.ACTIVE);

    const fatura = await prisma.invoice.findUniqueOrThrow({ where: { id: segunda.id } });
    expect(fatura.status).toBe(InvoiceStatus.PAID);

    const verificacao = await ledger.verify(organizationId);
    expect(verificacao.balanced).toBe(true);
  });

  it('o dinheiro entra mesmo quando a assinatura já morreu, e ninguém fica sem saber', async () => {
    const { organizationId, subscription, invoice } = await montar();
    const segunda = await esgotarRecuperacao(organizationId, invoice.id);

    await clocks.runFor(organizationId, () =>
      subscriptions.cancel({ organizationId, subscriptionId: subscription.id, immediate: true }),
    );

    const tentativa = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: segunda.id },
      orderBy: { attempt: 'desc' },
    });

    await prisma.payment.update({
      where: { id: tentativa.id },
      data: { status: PaymentStatus.PENDING },
    });

    const resultado = await entregarDesfecho(tentativa.idempotencyKey, 'fake_ch_tarde_demais');

    // O dinheiro nunca se perde: a cobrança é registrada e a fatura fica paga.
    const pagamento = await prisma.payment.findUniqueOrThrow({ where: { id: tentativa.id } });
    expect(pagamento.status).toBe(PaymentStatus.SUCCEEDED);

    const fatura = await prisma.invoice.findUniqueOrThrow({ where: { id: segunda.id } });
    expect(fatura.status).toBe(InvoiceStatus.PAID);

    // E a assinatura encerrada continua encerrada. Ressuscitar quebraria a
    // garantia de que estado final é final, e o cliente já foi avisado de que
    // acabou.
    const depois = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(depois.status).toBe(SubscriptionStatus.CANCELED);

    // O que não pode acontecer é isso passar em silêncio: é dinheiro recebido
    // por serviço que não vai ser prestado.
    expect(resultado.status).toBe('aceito');

    const verificacao = await ledger.verify(organizationId);
    expect(verificacao.balanced).toBe(true);
  });
});
