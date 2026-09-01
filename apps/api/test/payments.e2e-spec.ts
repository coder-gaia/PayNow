import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../src/modules/billing/application/payments.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { ClockScopeStorage } from '../src/modules/platform/clock/clock-scope';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { FakeGateway } from '../src/modules/platform/payments/fake-gateway';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp } from './support/app';

/**
 * Pagamentos contra o banco de verdade.
 *
 * O que estes testes verificam não é o caminho feliz, que é o pedaço fácil. É
 * o que acontece quando o provedor recusa, quando ele não responde, e quando a
 * mesma cobrança é tentada duas vezes. São esses três casos que separam um
 * sistema de cobrança de um formulário que chama uma API.
 *
 * O gateway falso implementa idempotência de verdade, e não simulada: repetir
 * a mesma chave devolve o mesmo resultado, como o Stripe faz. Sem isso, o
 * teste de cobrança em dobro passaria por acidente e não provaria nada.
 */
describe('Pagamentos (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let payments: PaymentsService;
  let ledger: LedgerService;
  let gateway: FakeGateway;
  let clocks: OrganizationClockService;
  let scopes: ClockScopeStorage;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    payments = app.get(PaymentsService);
    ledger = app.get(LedgerService);
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

  /** Uma organização com assinatura ativa, fatura aberta e cartão vinculado. */
  const montar = async (options: { comCartao?: boolean } = {}) => {
    const organization = await prisma.organization.create({
      data: { name: 'Pagamentos de Teste', slug: `pag-${randomUUID().slice(0, 8)}` },
    });

    await clocks.freeze(organization.id, new Date('2026-03-01T12:00:00.000Z'));

    const customer = await catalog.createCustomer(organization.id, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Padaria de Teste',
    });

    if (options.comCartao !== false) {
      await catalog.attachPaymentMethod(organization.id, customer.id, {
        token: `pm_${randomUUID()}`,
        brand: 'visa',
        last4: '4242',
      });
    }

    const product = await catalog.createProduct(organization.id, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

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

    return { organizationId: organization.id, customer, subscription, invoice };
  };

  const comRelogio = <T>(organizationId: string, fn: () => Promise<T>): Promise<T> =>
    clocks.runFor(organizationId, fn);

  const recarregarFatura = (id: string) =>
    prisma.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });

  describe('cobrança bem sucedida', () => {
    it('quita a fatura, ativa a assinatura e reconhece o dinheiro no razão', async () => {
      const { organizationId, invoice, subscription } = await montar();

      const resultado = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(resultado.status).toBe(PaymentStatus.SUCCEEDED);
      expect(resultado.invoiceStatus).toBe(InvoiceStatus.PAID);

      const depois = await recarregarFatura(invoice.id);
      expect(depois.paidAt).not.toBeNull();
      expect(depois.payments).toHaveLength(1);
      expect(depois.payments[0]?.gatewayRef).toMatch(/^fake_ch_/);

      // A assinatura nasce INCOMPLETE e o pagamento é o que a torna ativa.
      // Dar acesso antes do dinheiro entrar é dar acesso a quem talvez nunca
      // pague, e é por isso que a ativação mora aqui.
      const assinatura = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });
      expect(assinatura.status).toBe(SubscriptionStatus.ACTIVE);

      // Quatro linhas: o dinheiro entrou no gateway, a dívida foi quitada, e a
      // taxa de 3% saiu da receita do merchant para a plataforma.
      const entries = await ledger.entries(organizationId);
      const pagamento = entries.find((entry) => entry.eventType === 'payment.succeeded');

      expect(pagamento?.lines).toHaveLength(4);
      expect(pagamento?.total.toDecimalString()).toBe('103.00');

      const balances = await ledger.balances(organizationId);
      const taxa = balances.find((conta) => conta.code === 'platform:fee');
      const receita = balances.find((conta) => conta.code === 'merchant:revenue');
      const receber = balances.find((conta) => conta.code === 'customer:receivable');

      expect(taxa?.balance.toDecimalString()).toBe('-3.00');
      expect(receita?.balance.toDecimalString()).toBe('-97.00');
      expect(receber?.balance.toDecimalString()).toBe('0.00');
    });

    it('cobrar de novo uma fatura paga é repetição, e não erro', async () => {
      const { organizationId, invoice } = await montar();

      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));
      const segunda = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(segunda.invoiceStatus).toBe(InvoiceStatus.PAID);

      // O ponto: nenhuma tentativa nova foi aberta e nenhum lançamento novo
      // entrou. Uma repetição de rede não pode virar cobrança em dobro.
      const depois = await recarregarFatura(invoice.id);
      expect(depois.payments).toHaveLength(1);

      const entries = await ledger.entries(organizationId);
      expect(entries.filter((entry) => entry.eventType === 'payment.succeeded')).toHaveLength(1);
    });

    it('recusa cobrar sem meio de pagamento cadastrado', async () => {
      const { organizationId, invoice } = await montar({ comCartao: false });

      await expect(
        comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id)),
      ).rejects.toThrow(/meio de pagamento/);
    });
  });

  describe('recusa', () => {
    it('não move o razão, porque nada mudou de mão', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'decline' });

      const resultado = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(resultado.status).toBe(PaymentStatus.FAILED);
      expect(resultado.failureCode).toBe('card_declined');

      // A fatura continua aberta e o cliente continua devendo exatamente o
      // que devia. Lançar a recusa criaria movimento contábil para um não
      // evento, e o balancete passaria a contar tentativas em vez de dinheiro.
      const depois = await recarregarFatura(invoice.id);
      expect(depois.status).toBe(InvoiceStatus.OPEN);

      const entries = await ledger.entries(organizationId);
      expect(entries.filter((entry) => entry.eventType === 'payment.failed')).toHaveLength(0);
      expect(entries).toHaveLength(1);

      const balances = await ledger.balances(organizationId);
      expect(
        balances.find((conta) => conta.code === 'customer:receivable')?.balance.toDecimalString(),
      ).toBe('100.00');
    });

    it('leva a assinatura para PAST_DUE sem cortar o acesso', async () => {
      const { organizationId, invoice, subscription } = await montar();

      // Primeiro pagamento confirma, para a assinatura sair de INCOMPLETE.
      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));

      // Agora a fatura do ciclo seguinte falha.
      const segunda = await prisma.invoice.create({
        data: {
          organizationId,
          customerId: invoice.customerId,
          subscriptionId: subscription.id,
          number: 999,
          status: InvoiceStatus.OPEN,
          amountMinor: 10_000n,
          currency: 'BRL',
          periodStart: new Date('2026-04-01T12:00:00.000Z'),
          periodEnd: new Date('2026-05-01T12:00:00.000Z'),
          dueAt: new Date('2026-04-04T12:00:00.000Z'),
        },
      });

      gateway.setScenario({ kind: 'decline' });
      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, segunda.id));

      const assinatura = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });

      expect(assinatura.status).toBe(SubscriptionStatus.PAST_DUE);
    });

    it('agenda a próxima tentativa com intervalo crescente', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'decline' });

      const primeira = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      // Uma hora depois da primeira recusa: a causa mais provável nesse ponto
      // é saldo momentâneo.
      expect(primeira.nextAttemptAt?.toISOString()).toBe('2026-03-01T13:00:00.000Z');

      const segunda = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      // Vinte e quatro horas depois da segunda: a essa altura já não é saldo,
      // é o cliente não ter reparado.
      expect(segunda.attempt).toBe(2);
      expect(segunda.nextAttemptAt?.toISOString()).toBe('2026-03-02T12:00:00.000Z');
    });

    it('recusa definitiva não volta para a fila e torna a fatura incobrável', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'decline', code: 'card_canceled', retriable: false });

      const resultado = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(resultado.nextAttemptAt).toBeUndefined();

      // Insistir em um cartão cancelado queima a relação com o cliente e ainda
      // conta como tentativa fracassada para o adquirente, que se paga.
      const depois = await recarregarFatura(invoice.id);
      expect(depois.status).toBe(InvoiceStatus.UNCOLLECTIBLE);
      expect(depois.nextAttemptAt).toBeNull();
    });
  });

  describe('recuperação', () => {
    it('duas recusas e um acerto quitam a fatura na terceira tentativa', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'failThenSucceed', failures: 2 });

      const primeira = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );
      const segunda = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );
      const terceira = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(primeira.status).toBe(PaymentStatus.FAILED);
      expect(segunda.status).toBe(PaymentStatus.FAILED);
      expect(terceira.status).toBe(PaymentStatus.SUCCEEDED);

      // As três tentativas ficam registradas. O histórico é o que responde
      // "por que este cliente foi cortado", e sobrescrever a tentativa
      // anterior apagaria justamente a resposta.
      const depois = await recarregarFatura(invoice.id);
      expect(depois.status).toBe(InvoiceStatus.PAID);
      expect(depois.payments).toHaveLength(3);
      expect(depois.payments.map((p) => p.status)).toEqual([
        PaymentStatus.FAILED,
        PaymentStatus.FAILED,
        PaymentStatus.SUCCEEDED,
      ]);

      // E um único lançamento de pagamento, o da tentativa que deu certo.
      const entries = await ledger.entries(organizationId);
      expect(entries.filter((entry) => entry.eventType === 'payment.succeeded')).toHaveLength(1);
    });

    it('a assinatura volta de PAST_DUE para ACTIVE quando a cobrança passa', async () => {
      const { organizationId, invoice, subscription } = await montar();

      // Precisa ter estado em dia antes: PAST_DUE significa "caiu", e uma
      // assinatura que nunca pagou não caiu de lugar nenhum.
      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));

      const segunda = await prisma.invoice.create({
        data: {
          organizationId,
          customerId: invoice.customerId,
          subscriptionId: subscription.id,
          number: 998,
          status: InvoiceStatus.OPEN,
          amountMinor: 10_000n,
          currency: 'BRL',
          periodStart: new Date('2026-04-01T12:00:00.000Z'),
          periodEnd: new Date('2026-05-01T12:00:00.000Z'),
          dueAt: new Date('2026-04-04T12:00:00.000Z'),
        },
      });

      gateway.setScenario({ kind: 'failThenSucceed', failures: 1 });

      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, segunda.id));

      let assinatura = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });
      expect(assinatura.status).toBe(SubscriptionStatus.PAST_DUE);

      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, segunda.id));

      assinatura = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });

      // Voltar de PAST_DUE para ACTIVE é tão importante quanto cair nele. Um
      // desenho que só previsse a queda deixaria receita na mesa.
      expect(assinatura.status).toBe(SubscriptionStatus.ACTIVE);
    });

    /**
     * A primeira cobrança recusada não é atraso.
     *
     * A máquina de estados recusou esta transição quando o serviço tentou
     * fazê-la, e estava certa: PAST_DUE quer dizer "já esteve em dia e caiu".
     * Quem nunca pagou continua INCOMPLETE, e quem a encerra é o ciclo de
     * cobrança quando o período vencer.
     */
    it('recusa na primeira cobrança deixa a assinatura INCOMPLETE', async () => {
      const { organizationId, invoice, subscription } = await montar();
      gateway.setScenario({ kind: 'decline' });

      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));

      const assinatura = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });

      expect(assinatura.status).toBe(SubscriptionStatus.INCOMPLETE);
    });
  });

  /**
   * O caso que separa um sistema de cobrança de um brinquedo.
   *
   * O provedor recebeu, talvez cobrou, e não respondeu. Quem trata isso como
   * falha cobra duas vezes; quem trata como sucesso libera acesso sem
   * dinheiro. A única resposta honesta é registrar que não se sabe.
   */
  describe('provedor sem resposta', () => {
    it('deixa a tentativa PENDING e não lança nada no razão', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'timeout' });

      const resultado = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(resultado.status).toBe(PaymentStatus.PENDING);

      const depois = await recarregarFatura(invoice.id);
      expect(depois.status).toBe(InvoiceStatus.OPEN);
      expect(depois.payments[0]?.status).toBe(PaymentStatus.PENDING);
      expect(depois.nextAttemptAt).not.toBeNull();

      // Nem lançamento de pagamento, nem de recusa. Não sabemos o que houve, e
      // inventar um dos dois seria pior do que admitir a ignorância.
      const entries = await ledger.entries(organizationId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.eventType).toBe('invoice.issued');
    });

    it('a tentativa seguinte usa chave nova e pode dar certo', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'timeout' });

      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));

      gateway.setScenario({ kind: 'succeed' });
      const segunda = await comRelogio(organizationId, () =>
        payments.chargeInvoice(organizationId, invoice.id),
      );

      expect(segunda.status).toBe(PaymentStatus.SUCCEEDED);

      const depois = await recarregarFatura(invoice.id);
      expect(depois.status).toBe(InvoiceStatus.PAID);
      // A tentativa sem desfecho continua registrada, como PENDING. Ela é a
      // evidência de que houve uma chamada cujo resultado se desconhece, e
      // apagá-la esconderia um possível pagamento em duplicidade no provedor.
      expect(depois.payments.map((p) => p.status)).toEqual([
        PaymentStatus.PENDING,
        PaymentStatus.SUCCEEDED,
      ]);
    });
  });

  describe('integridade', () => {
    it('o razão fecha em zero depois de sucesso, recusa e recuperação', async () => {
      const { organizationId, invoice } = await montar();
      gateway.setScenario({ kind: 'failThenSucceed', failures: 2 });

      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));
      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));
      await comRelogio(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));

      const report = await ledger.verify(organizationId);
      expect(report.violations).toEqual([]);
      expect(report.balanced).toBe(true);
    });
  });

  /** O escopo de tempo, para o teste agir como o interceptor age. */
  afterAll(() => {
    scopes.current();
  });
});
