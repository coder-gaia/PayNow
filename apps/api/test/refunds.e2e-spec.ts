import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, RefundStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../src/modules/billing/application/payments.service';
import { RefundsService } from '../src/modules/billing/application/refunds.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp } from './support/app';

/**
 * Estornos.
 *
 * O que estes testes protegem é uma propriedade contábil, e não uma função: o
 * estorno é um lançamento novo, e não um desfazer. Um sistema que anulasse o
 * pagamento original responderia errado a "quanto entrou em março", que
 * continua sendo o valor cheio mesmo depois de devolvido em abril.
 */
describe('Estornos (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let payments: PaymentsService;
  let refunds: RefundsService;
  let ledger: LedgerService;
  let clocks: OrganizationClockService;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    payments = app.get(PaymentsService);
    refunds = app.get(RefundsService);
    ledger = app.get(LedgerService);
    clocks = app.get(OrganizationClockService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const brl = (decimal: string) => Money.fromDecimal(decimal, 'BRL');

  /** Uma organização com uma cobrança de R$ 100,00 já confirmada. */
  const montarComPagamento = async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Estornos de Teste', slug: `est-${randomUUID().slice(0, 8)}` },
    });

    await clocks.freeze(organization.id, new Date('2026-06-01T12:00:00.000Z'));

    const customer = await catalog.createCustomer(organization.id, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Cliente do Estorno',
    });

    await catalog.attachPaymentMethod(organization.id, customer.id, {
      token: `pm_${randomUUID()}`,
    });

    const product = await catalog.createProduct(organization.id, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organization.id, product.id, {
      amount: brl('100.00'),
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

    await clocks.runFor(organization.id, () => payments.chargeInvoice(organization.id, invoice.id));

    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });

    return { organizationId: organization.id, invoice, payment };
  };

  const saldos = async (organizationId: string) => {
    const balances = await ledger.balances(organizationId);
    const buscar = (code: string) =>
      balances.find((conta) => conta.code === code)?.balance.toDecimalString();

    return {
      gateway: buscar('gateway:clearing'),
      estornos: buscar('merchant:refunds'),
      receita: buscar('merchant:revenue'),
      taxa: buscar('platform:fee'),
    };
  };

  it('estorno parcial vira lançamento novo, sem apagar o pagamento', async () => {
    const { organizationId, payment } = await montarComPagamento();

    const antes = await saldos(organizationId);
    expect(antes.gateway).toBe('100.00');

    const refund = await clocks.runFor(organizationId, () =>
      refunds.refund({
        organizationId,
        paymentId: payment.id,
        amount: brl('40.00'),
        reason: 'Cliente cancelou dentro do prazo',
      }),
    );

    expect(refund.status).toBe(RefundStatus.SUCCEEDED);
    expect(refund.gatewayRef).toMatch(/^fake_re_/);

    const depois = await saldos(organizationId);

    // O dinheiro sai da liquidação e a devolução entra na conta redutora de
    // receita. Note que a receita bruta continua 100: quanto o merchant
    // faturou e quanto devolveu são números diferentes, e quem só guarda o
    // líquido perde os dois.
    expect(depois.gateway).toBe('60.00');
    expect(depois.estornos).toBe('40.00');
    expect(depois.receita).toBe('-97.00');

    // A taxa da plataforma não volta: ela prestou o serviço de processar.
    expect(depois.taxa).toBe('-3.00');

    // O pagamento original continua lá, intocado.
    const original = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(original.status).toBe('SUCCEEDED');
    expect(original.amountMinor).toBe(10_000n);

    // E o razão continua fechando.
    const report = await ledger.verify(organizationId);
    expect(report.balanced).toBe(true);
  });

  it('sem valor, estorna o que resta', async () => {
    const { organizationId, payment } = await montarComPagamento();

    await clocks.runFor(organizationId, () =>
      refunds.refund({
        organizationId,
        paymentId: payment.id,
        amount: brl('30.00'),
        reason: 'Primeira devolução',
      }),
    );

    const segundo = await clocks.runFor(organizationId, () =>
      refunds.refund({ organizationId, paymentId: payment.id, reason: 'Devolução do restante' }),
    );

    expect(Money.fromMinor(segundo.amountMinor, segundo.currency).toDecimalString()).toBe('70.00');

    const depois = await saldos(organizationId);
    expect(depois.gateway).toBe('0.00');
    expect(depois.estornos).toBe('100.00');
  });

  it('recusa devolver mais do que entrou', async () => {
    const { organizationId, payment } = await montarComPagamento();

    await expect(
      clocks.runFor(organizationId, () =>
        refunds.refund({
          organizationId,
          paymentId: payment.id,
          amount: brl('150.00'),
          reason: 'Valor maior que o pago',
        }),
      ),
    ).rejects.toThrow(/máximo que ainda pode ser estornado/);
  });

  it('recusa estornar duas vezes o que já voltou por inteiro', async () => {
    const { organizationId, payment } = await montarComPagamento();

    await clocks.runFor(organizationId, () =>
      refunds.refund({ organizationId, paymentId: payment.id, reason: 'Devolução integral' }),
    );

    await expect(
      clocks.runFor(organizationId, () =>
        refunds.refund({ organizationId, paymentId: payment.id, reason: 'De novo' }),
      ),
    ).rejects.toThrow(/já foi estornado por inteiro/);
  });

  it('recusa estornar uma cobrança que não passou', async () => {
    const { organizationId, invoice } = await montarComPagamento();

    // Uma tentativa recusada não tirou dinheiro de ninguém, então não há o que
    // devolver. Aceitar isso criaria dinheiro do nada no razão.
    const recusada = await prisma.payment.create({
      data: {
        organizationId,
        invoiceId: invoice.id,
        attempt: 99,
        status: 'FAILED',
        amountMinor: 10_000n,
        currency: 'BRL',
        gateway: 'fake',
        idempotencyKey: `charge:${invoice.id}:99`,
      },
    });

    await expect(
      clocks.runFor(organizationId, () =>
        refunds.refund({ organizationId, paymentId: recusada.id, reason: 'Não deveria passar' }),
      ),
    ).rejects.toThrow(/cobrança confirmada/);
  });

  /**
   * Dois estornos parciais ao mesmo tempo.
   *
   * Sem o advisory lock, os dois leriam o mesmo total já devolvido e passariam
   * os dois, devolvendo mais do que entrou. O erro só apareceria na
   * conciliação, quando o saldo da conta de liquidação ficasse negativo.
   */
  it('dois estornos simultâneos não devolvem mais do que entrou', async () => {
    const { organizationId, payment } = await montarComPagamento();

    const resultados = await Promise.allSettled([
      clocks.runFor(organizationId, () =>
        refunds.refund({
          organizationId,
          paymentId: payment.id,
          amount: brl('60.00'),
          reason: 'Primeira metade',
        }),
      ),
      clocks.runFor(organizationId, () =>
        refunds.refund({
          organizationId,
          paymentId: payment.id,
          amount: brl('60.00'),
          reason: 'Segunda metade',
        }),
      ),
    ]);

    const aceitos = resultados.filter((resultado) => resultado.status === 'fulfilled');
    expect(aceitos).toHaveLength(1);

    const depois = await saldos(organizationId);
    expect(depois.gateway).toBe('40.00');
    expect(depois.estornos).toBe('60.00');
  });
});
