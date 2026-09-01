import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { BillingCycleService } from '../src/modules/billing/application/billing-cycle.service';
import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { ClockScopeStorage } from '../src/modules/platform/clock/clock-scope';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp } from './support/app';

const DIA = 24 * 60 * 60 * 1000;

/**
 * Relógio virtual e ciclo de cobrança.
 *
 * Este arquivo é a prova do segundo pilar. Tudo que ele verifica depende de a
 * passagem do tempo ser controlável: sem isso, confirmar que uma assinatura
 * mensal renova doze vezes em um ano exigiria um ano.
 *
 * Nenhum teste aqui usa dublê de relógio. O tempo é congelado no banco pela
 * mesma rota que o painel usa, e o ciclo lê o instante pelo mesmo `Clock`
 * injetado que a aplicação usa em produção. É por isso que passar aqui
 * significa alguma coisa.
 */
describe('Ciclo de cobrança (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let cycle: BillingCycleService;
  let clocks: OrganizationClockService;
  let scopes: ClockScopeStorage;
  let ledger: LedgerService;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    cycle = app.get(BillingCycleService);
    clocks = app.get(OrganizationClockService);
    scopes = app.get(ClockScopeStorage);
    ledger = app.get(LedgerService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Cada teste monta a própria organização e congela o próprio relógio.
   *
   * Relógio congelado é estado global da organização, então compartilhar uma
   * entre testes faria o avanço de um aparecer no outro. O isolamento aqui não
   * é preciosismo: é o que permite rodar o arquivo inteiro sem ordem definida.
   */
  const montar = async (options: { trialDays?: number; interval?: BillingInterval } = {}) => {
    const organization = await prisma.organization.create({
      data: { name: 'Ciclo de Teste', slug: `ciclo-${randomUUID().slice(0, 8)}` },
    });

    const customer = await catalog.createCustomer(organization.id, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Assinante de Teste',
    });

    const product = await catalog.createProduct(organization.id, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organization.id, product.id, {
      amount: Money.fromDecimal('100.00', 'BRL'),
      interval: options.interval ?? BillingInterval.MONTH,
      trialDays: options.trialDays ?? 0,
    });

    // O relógio é congelado antes de a assinatura existir, para que o início
    // do ciclo também nasça do tempo virtual e o teste não dependa de quando
    // foi executado.
    await clocks.freeze(organization.id, new Date('2026-01-10T12:00:00.000Z'));

    const subscription = await comRelogio(organization.id, () =>
      subscriptions.start({
        organizationId: organization.id,
        customerId: customer.id,
        priceId: price.id,
      }),
    );

    return { organizationId: organization.id, customer, price, subscription };
  };

  /** Roda algo no escopo de tempo da organização, como o interceptor faz. */
  const comRelogio = async <T>(organizationId: string, fn: () => Promise<T>): Promise<T> =>
    clocks.runFor(organizationId, fn);

  /** Avança o relógio e liquida o vencido, como a rota de avanço faz. */
  const avancar = async (organizationId: string, milliseconds: number) => {
    const state = await clocks.advance(organizationId, milliseconds);

    return scopes.run({ organizationId, now: state.now, virtual: true }, () =>
      cycle.runDue(organizationId),
    );
  };

  const recarregar = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } });

  /**
   * Faturas emitidas, contadas pelo razão.
   *
   * O filtro é `invoice.issued` e não `subscription.renewed` porque são fatos
   * de naturezas diferentes: renovar é fato de produto, faturar é fato
   * contábil. Nem toda renovação fatura, e o fim de um período de teste é
   * exatamente a renovação que fatura pela primeira vez.
   */
  const faturas = async (organizationId: string) => {
    const entries = await ledger.entries(organizationId);
    return entries.filter((entry) => entry.eventType === 'invoice.issued');
  };

  describe('congelamento', () => {
    it('congela o tempo e responde o instante parado', async () => {
      const { organizationId } = await montar();
      const state = await clocks.state(organizationId);

      expect(state.virtual).toBe(true);
      expect(state.now.toISOString()).toBe('2026-01-10T12:00:00.000Z');
      expect(state.advancedMs).toBe(0);
    });

    it('a assinatura nasce com as datas do relógio virtual, e não do de parede', async () => {
      const { subscription } = await montar();

      expect(subscription.currentPeriodStart.toISOString()).toBe('2026-01-10T12:00:00.000Z');
      expect(subscription.currentPeriodEnd.toISOString()).toBe('2026-02-10T12:00:00.000Z');
    });

    it('recusa congelar duas vezes, porque perderia o tempo já percorrido', async () => {
      const { organizationId } = await montar();

      await expect(clocks.freeze(organizationId)).rejects.toThrow(/já está congelado/);
    });

    it('recusa avançar um relógio que não está congelado', async () => {
      const organization = await prisma.organization.create({
        data: { name: 'Sem Relógio', slug: `sem-relogio-${randomUUID().slice(0, 8)}` },
      });

      await expect(clocks.advance(organization.id, DIA)).rejects.toThrow(/não está congelado/);
    });

    it('recusa avanço maior que um ano, que quase sempre é erro de unidade', async () => {
      const { organizationId } = await montar();

      await expect(clocks.advance(organizationId, 400 * DIA)).rejects.toThrow(/máximo/);
    });

    it('o relógio de uma organização não afeta a outra', async () => {
      const primeira = await montar();
      const segunda = await montar();

      await avancar(primeira.organizationId, 40 * DIA);

      const outra = await clocks.state(segunda.organizationId);
      expect(outra.now.toISOString()).toBe('2026-01-10T12:00:00.000Z');

      const intacta = await recarregar(segunda.subscription.id);
      expect(intacta.currentPeriodEnd.toISOString()).toBe('2026-02-10T12:00:00.000Z');
    });
  });

  describe('renovação', () => {
    it('não faz nada antes do vencimento', async () => {
      const { organizationId, subscription } = await montar();

      const report = await avancar(organizationId, 20 * DIA);

      expect(report.effects).toEqual([]);
      expect((await recarregar(subscription.id)).currentPeriodEnd.toISOString()).toBe(
        '2026-02-10T12:00:00.000Z',
      );
    });

    it('depois do vencimento abre o ciclo seguinte e emite a fatura', async () => {
      const { organizationId, subscription } = await montar();

      // A assinatura nasce INCOMPLETE, então precisa estar ativa para renovar
      // em vez de expirar. Na fase 05 quem faz isso é a confirmação do
      // pagamento; aqui o teste coloca a assinatura no estado que interessa.
      await ativar(subscription.id);

      const report = await avancar(organizationId, 35 * DIA);

      expect(report.effects).toHaveLength(1);
      expect(report.effects[0]?.action).toBe('renovada');

      const depois = await recarregar(subscription.id);
      expect(depois.status).toBe(SubscriptionStatus.ACTIVE);
      expect(depois.currentPeriodStart.toISOString()).toBe('2026-02-10T12:00:00.000Z');
      expect(depois.currentPeriodEnd.toISOString()).toBe('2026-03-10T12:00:00.000Z');

      // Duas faturas: a do primeiro ciclo, emitida no start, e a da renovação.
      expect(await faturas(organizationId)).toHaveLength(2);
    });

    /**
     * O teste que justifica o laço.
     *
     * Um ciclo que processasse uma vez por chamada deixaria a assinatura com
     * um período inteiro no passado e uma fatura faltando, e ninguém notaria
     * até a conciliação.
     */
    it('avançar três meses produz três renovações, e não uma', async () => {
      const { organizationId, subscription } = await montar();
      await ativar(subscription.id);

      const report = await avancar(organizationId, 95 * DIA);

      expect(report.effects).toHaveLength(3);
      expect(report.effects.every((effect) => effect.action === 'renovada')).toBe(true);

      const depois = await recarregar(subscription.id);
      expect(depois.currentPeriodStart.toISOString()).toBe('2026-04-10T12:00:00.000Z');
      expect(depois.currentPeriodEnd.toISOString()).toBe('2026-05-10T12:00:00.000Z');

      // Três renovações mais a fatura do primeiro ciclo.
      expect(await faturas(organizationId)).toHaveLength(4);
    });

    /**
     * A data de aniversário não escorrega.
     *
     * Ancorar o período novo no fim do anterior, e não no instante em que o
     * ciclo rodou, é o que impede a cobrança de andar um pouco para a frente a
     * cada renovação atrasada. Em um ano de atrasos pequenos, a data já seria
     * outra.
     */
    it('a data de aniversário não anda quando o ciclo roda atrasado', async () => {
      const { organizationId, subscription } = await montar();
      await ativar(subscription.id);

      // Vence dia 10 e o ciclo só roda dia 25.
      await avancar(organizationId, 45 * DIA);

      const depois = await recarregar(subscription.id);
      expect(depois.currentPeriodStart.toISOString()).toBe('2026-02-10T12:00:00.000Z');
      expect(depois.currentPeriodEnd.toISOString()).toBe('2026-03-10T12:00:00.000Z');
    });

    it('rodar o ciclo de novo sobre o mesmo período não duplica a fatura', async () => {
      const { organizationId, subscription } = await montar();
      await ativar(subscription.id);

      await avancar(organizationId, 35 * DIA);
      const depois = await comRelogio(organizationId, () => cycle.runDue(organizationId));

      expect(depois.effects).toEqual([]);
      expect(await faturas(organizationId)).toHaveLength(2);
    });
  });

  describe('fim do período de teste', () => {
    it('vira ACTIVE e só então emite a primeira fatura', async () => {
      const { organizationId, subscription } = await montar({ trialDays: 14 });

      expect(subscription.status).toBe(SubscriptionStatus.TRIALING);
      // Nada foi cobrado ainda: teste não gera receita.
      expect(await faturas(organizationId)).toHaveLength(0);
      expect(await ledger.entries(organizationId)).toHaveLength(0);

      const report = await avancar(organizationId, 15 * DIA);

      expect(report.effects).toHaveLength(1);
      expect(report.effects[0]?.action).toBe('ativada');

      const depois = await recarregar(subscription.id);
      expect(depois.status).toBe(SubscriptionStatus.ACTIVE);
      expect(depois.currentPeriodStart.toISOString()).toBe('2026-01-24T12:00:00.000Z');

      expect(await faturas(organizationId)).toHaveLength(1);
    });
  });

  describe('encerramento', () => {
    it('a assinatura que nunca teve o primeiro pagamento confirmado expira', async () => {
      const { organizationId, subscription } = await montar();

      expect(subscription.status).toBe(SubscriptionStatus.INCOMPLETE);

      const report = await avancar(organizationId, 35 * DIA);

      expect(report.effects[0]?.action).toBe('expirada');
      expect((await recarregar(subscription.id)).status).toBe(SubscriptionStatus.CANCELED);

      // O que já era devido continua no razão: cancelar não perdoa a dívida.
      const entries = await ledger.entries(organizationId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.eventType).toBe('invoice.issued');
    });

    it('o cancelamento agendado se cumpre no fim do ciclo', async () => {
      const { organizationId, subscription } = await montar();
      await ativar(subscription.id);

      await comRelogio(organizationId, () =>
        subscriptions.cancel({ organizationId, subscriptionId: subscription.id }),
      );

      const report = await avancar(organizationId, 35 * DIA);

      expect(report.effects[0]?.action).toBe('encerrada');

      const depois = await recarregar(subscription.id);
      expect(depois.status).toBe(SubscriptionStatus.CANCELED);
      expect(depois.cancelAtPeriodEnd).toBe(false);
      expect(depois.canceledAt).not.toBeNull();

      // Encerrada é final: nenhum ciclo posterior a ressuscita.
      const seguinte = await avancar(organizationId, 60 * DIA);
      expect(seguinte.effects).toEqual([]);
    });
  });

  describe('integridade', () => {
    it('um ano de renovações mantém o razão fechando em zero', async () => {
      const { organizationId, subscription } = await montar();
      await ativar(subscription.id);

      await avancar(organizationId, 365 * DIA);

      const report = await ledger.verify(organizationId);
      expect(report.violations).toEqual([]);
      expect(report.balanced).toBe(true);

      // Doze renovações mais a fatura do primeiro ciclo.
      expect(await faturas(organizationId)).toHaveLength(13);

      const balances = await ledger.balances(organizationId);
      const receber = balances.find((conta) => conta.code === 'customer:receivable');
      expect(receber?.balance.toDecimalString()).toBe('1300.00');
    });
  });

  /**
   * Coloca a assinatura em ACTIVE sem passar pelo pagamento.
   *
   * A confirmação de pagamento chega na fase 05. Até lá, escrever o estado
   * direto é honesto: o que estes testes verificam é o ciclo do tempo, e
   * fingir um pagamento que ainda não existe seria verificar outra coisa.
   */
  const ativar = async (subscriptionId: string): Promise<void> => {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE },
    });
  };
});
