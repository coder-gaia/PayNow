import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { ACCOUNT } from '../src/modules/ledger/domain/chart-of-accounts';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp } from './support/app';

/**
 * Assinaturas contra o banco de verdade.
 *
 * O que estes testes verificam de fato é a costura entre os módulos: mudar uma
 * assinatura publica um evento, o razão o transforma em lançamento, e as duas
 * coisas acontecem na mesma transação. Verificar isso com dublê não afirmaria
 * nada, porque a atomicidade é do PostgreSQL.
 */
describe('Cobrança (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let ledger: LedgerService;
  let prisma: PrismaService;
  let organizationId: string;

  const brl = (decimal: string): Money => Money.fromDecimal(decimal, 'BRL');

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    ledger = app.get(LedgerService);
    prisma = app.get(PrismaService);

    const organization = await prisma.organization.create({
      data: { name: 'Cobrança de Teste', slug: `cobranca-${randomUUID().slice(0, 8)}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const criarCliente = () =>
    catalog.createCustomer(organizationId, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Cliente de Teste',
    });

  // Devolve o preço com o nome do produto junto: o nome entra na descrição do
  // lançamento, e o sufixo aleatório impede colisão entre execuções.
  const criarPlano = async (nome: string, valor: string, trialDays = 0) => {
    const product = await catalog.createProduct(organizationId, {
      name: `${nome} ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organizationId, product.id, {
      amount: brl(valor),
      interval: BillingInterval.MONTH,
      trialDays,
    });

    return { ...price, productName: product.name };
  };

  describe('catálogo', () => {
    it('recusa preço zero, porque plano gratuito se modela sem preço', async () => {
      const product = await catalog.createProduct(organizationId, {
        name: `Gratuito ${randomUUID().slice(0, 6)}`,
      });

      await expect(
        catalog.createPrice(organizationId, product.id, {
          amount: brl('0.00'),
          interval: BillingInterval.MONTH,
        }),
      ).rejects.toThrow(/maior que zero/);
    });

    it('recusa dois produtos com o mesmo nome na organização', async () => {
      const nome = `Repetido ${randomUUID().slice(0, 6)}`;
      await catalog.createProduct(organizationId, { name: nome });

      await expect(catalog.createProduct(organizationId, { name: nome })).rejects.toThrow(
        /já existe um produto/i,
      );
    });
  });

  describe('início da assinatura', () => {
    it('sem período de teste nasce INCOMPLETE e já emite a fatura no razão', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      expect(subscription.status).toBe(SubscriptionStatus.INCOMPLETE);

      // O evento virou lançamento na mesma transação, sem ninguém chamar o
      // razão diretamente: quem fez isso foi a política contábil.
      const entries = await ledger.entries(organizationId);
      const fatura = entries.find((entry) => entry.eventId.includes(subscription.id));

      expect(fatura).toBeDefined();
      expect(fatura?.lines).toHaveLength(2);
      expect(fatura?.total.toDecimalString()).toBe('100.00');

      // A descrição diz de quem é a fatura, e não o identificador da
      // assinatura: o razão existe para ser lido por gente.
      expect(fatura?.description).toContain('Cliente de Teste');
      expect(fatura?.description).not.toContain(subscription.id);
    });

    it('com período de teste nasce TRIALING e não lança nada, porque nada foi cobrado', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Com teste', '50.00', 14);

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      expect(subscription.status).toBe(SubscriptionStatus.TRIALING);
      expect(subscription.trialEndsAt).not.toBeNull();

      const entries = await ledger.entries(organizationId);
      expect(entries.some((entry) => entry.eventId.includes(subscription.id))).toBe(false);
    });

    it('permite pular o teste quando o merchant quiser cobrar já', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Teste pulado', '50.00', 14);

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
        skipTrial: true,
      });

      expect(subscription.status).toBe(SubscriptionStatus.INCOMPLETE);
      expect(subscription.trialEndsAt).toBeNull();
    });

    it('recusa preço de outra organização', async () => {
      const outra = await prisma.organization.create({
        data: { name: 'Alheia', slug: `alheia-${randomUUID().slice(0, 8)}` },
      });
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      await expect(
        subscriptions.start({
          organizationId: outra.id,
          customerId: customer.id,
          priceId: price.id,
        }),
      ).rejects.toThrow(/não encontrado/i);
    });
  });

  describe('troca de plano', () => {
    it('registra o rateio no razão, com crédito e cobrança separados', async () => {
      const customer = await criarCliente();
      const pro = await criarPlano('Pro', '100.00');
      const enterprise = await criarPlano('Enterprise', '300.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: pro.id,
      });

      const { proration } = await subscriptions.changePlan({
        organizationId,
        subscriptionId: subscription.id,
        priceId: enterprise.id,
      });

      // A troca acontece no instante da criação, então o ciclo inteiro está
      // pela frente: credita e cobra o valor cheio.
      expect(proration.credit.toDecimalString()).toBe('100.00');
      expect(proration.charge.toDecimalString()).toBe('300.00');
      expect(proration.net.toDecimalString()).toBe('200.00');

      const entries = await ledger.entries(organizationId);
      const troca = entries.find((entry) => entry.eventType === 'subscription.plan_changed');

      expect(troca).toBeDefined();
      expect(troca?.lines).toHaveLength(4);

      // O evento carrega os nomes, então a descrição fica legível e imutável:
      // renomear o produto depois não reescreve o que já foi lançado.
      expect(troca?.description).toContain('Cliente de Teste');
      expect(troca?.description).toContain(pro.productName);
      expect(troca?.description).toContain(enterprise.productName);
      expect(troca?.description).not.toContain(subscription.id);
    });

    it('o razão continua íntegro depois da troca', async () => {
      const report = await ledger.verify(organizationId);

      expect(report.violations).toEqual([]);
      expect(report.balanced).toBe(true);
    });

    it('recusa trocar para o plano em que já está', async () => {
      const customer = await criarCliente();
      const pro = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: pro.id,
      });

      await expect(
        subscriptions.changePlan({
          organizationId,
          subscriptionId: subscription.id,
          priceId: pro.id,
        }),
      ).rejects.toThrow(/já está neste plano/);
    });

    /** Concorrência vira erro visível em vez de sobrescrita silenciosa. */
    it('recusa a troca quando a versão esperada não bate', async () => {
      const customer = await criarCliente();
      const pro = await criarPlano('Pro', '100.00');
      const enterprise = await criarPlano('Enterprise', '300.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: pro.id,
      });

      await expect(
        subscriptions.changePlan({
          organizationId,
          subscriptionId: subscription.id,
          priceId: enterprise.id,
          expectedVersion: 99,
        }),
      ).rejects.toThrow(/alterada por outra operação/);
    });

    /**
     * O advisory lock serializa a leitura, o cálculo e a escrita. Sem ele, as
     * duas trocas leriam o mesmo estado e a segunda calcularia o rateio sobre
     * o plano antigo.
     */
    it('duas trocas simultâneas são serializadas e ambas ficam consistentes', async () => {
      const customer = await criarCliente();
      const pro = await criarPlano('Pro', '100.00');
      const enterprise = await criarPlano('Enterprise', '300.00');
      const basico = await criarPlano('Básico', '20.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: pro.id,
      });

      const resultados = await Promise.allSettled([
        subscriptions.changePlan({
          organizationId,
          subscriptionId: subscription.id,
          priceId: enterprise.id,
        }),
        subscriptions.changePlan({
          organizationId,
          subscriptionId: subscription.id,
          priceId: basico.id,
        }),
      ]);

      // As duas podem passar, porque nenhuma declarou a versão que esperava.
      // O que não pode acontecer é o razão desbalancear ou a versão pular.
      expect(resultados.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0);

      const final = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });
      const trocasAceitas = resultados.filter((r) => r.status === 'fulfilled').length;

      expect(final.version).toBe(trocasAceitas);
      expect((await ledger.verify(organizationId)).balanced).toBe(true);
    });
  });

  describe('cancelamento', () => {
    it('por padrão agenda para o fim do ciclo, sem mudar o estado', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      const cancelada = await subscriptions.cancel({
        organizationId,
        subscriptionId: subscription.id,
      });

      expect(cancelada.cancelAtPeriodEnd).toBe(true);
      expect(cancelada.status).toBe(SubscriptionStatus.INCOMPLETE);
      expect(cancelada.canceledAt).toBeNull();
    });

    it('imediato encerra na hora', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      const cancelada = await subscriptions.cancel({
        organizationId,
        subscriptionId: subscription.id,
        immediate: true,
      });

      expect(cancelada.status).toBe(SubscriptionStatus.CANCELED);
      expect(cancelada.canceledAt).not.toBeNull();
    });

    it('não cancela duas vezes: CANCELED é estado final', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      await subscriptions.cancel({
        organizationId,
        subscriptionId: subscription.id,
        immediate: true,
      });

      await expect(
        subscriptions.cancel({
          organizationId,
          subscriptionId: subscription.id,
          immediate: true,
        }),
      ).rejects.toThrow(/estado final/);
    });

    it('desfaz um cancelamento agendado', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      await subscriptions.cancel({ organizationId, subscriptionId: subscription.id });
      const retomada = await subscriptions.resume(organizationId, subscription.id);

      expect(retomada.cancelAtPeriodEnd).toBe(false);
    });
  });

  describe('histórico', () => {
    it('registra cada mudança com o motivo', async () => {
      const customer = await criarCliente();
      const pro = await criarPlano('Pro', '100.00');
      const enterprise = await criarPlano('Enterprise', '300.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: pro.id,
      });

      await subscriptions.changePlan({
        organizationId,
        subscriptionId: subscription.id,
        priceId: enterprise.id,
      });
      await subscriptions.cancel({ organizationId, subscriptionId: subscription.id });

      const completa = await subscriptions.findById(organizationId, subscription.id);

      expect(completa.events).toHaveLength(3);
      expect(completa.events.map((event) => event.reason)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Assinatura criada'),
          expect.stringContaining('Plano trocado'),
          expect.stringContaining('Cancelamento agendado'),
        ]),
      );
    });

    it('o histórico é append-only', async () => {
      const customer = await criarCliente();
      const price = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: price.id,
      });

      await expect(
        prisma.$executeRaw`DELETE FROM subscription_events WHERE subscription_id = ${subscription.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('atomicidade entre módulos', () => {
    /**
     * Este é o teste que justifica o barramento de eventos existir.
     *
     * O lançamento contábil e a mudança da assinatura vivem na mesma
     * transação. Se o razão recusar, a assinatura não muda. Aqui a recusa é
     * forçada duplicando o identificador do evento, que o índice único do
     * razão barra.
     */
    it('falha no razão desfaz a mudança na assinatura', async () => {
      const customer = await criarCliente();
      const pro = await criarPlano('Pro', '100.00');

      const subscription = await subscriptions.start({
        organizationId,
        customerId: customer.id,
        priceId: pro.id,
      });

      const antes = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });

      // Ocupa a chave de evento que a próxima troca vai tentar usar.
      await ledger.post({
        organizationId,
        event: { type: 'subscription.plan_changed', id: `plan-changed:${subscription.id}:1` },
        description: 'Lançamento que ocupa a chave do evento',
        lines: [
          { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('1.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-1.00') },
        ],
      });

      const enterprise = await criarPlano('Enterprise', '300.00');

      await expect(
        subscriptions.changePlan({
          organizationId,
          subscriptionId: subscription.id,
          priceId: enterprise.id,
        }),
      ).rejects.toThrow(/já foi lançado/);

      const depois = await prisma.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      });

      // A assinatura não mudou de plano nem de versão.
      expect(depois.priceId).toBe(antes.priceId);
      expect(depois.version).toBe(antes.version);
    });
  });
});
