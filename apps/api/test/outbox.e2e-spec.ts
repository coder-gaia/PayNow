import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, OutboxStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../src/modules/billing/application/payments.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { OutboxService } from '../src/modules/platform/events/outbox.service';
import { MAILER, type Mailer } from '../src/modules/platform/mail/mailer';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp } from './support/app';

/**
 * Outbox transacional.
 *
 * O que está sendo verificado é uma garantia, e não uma função: a mensagem
 * existe se e somente se o fato aconteceu. Isso só dá para verificar
 * provocando o caso em que os dois discordariam, que é uma transação que falha
 * depois de publicar.
 *
 * O envio de email é substituído por um espião, porque o que interessa aqui é a
 * mecânica de entrega. O Mailpit continua sendo o destino em desenvolvimento, e
 * quem quiser ver os emails de verdade abre http://localhost:8025.
 */
describe('Outbox (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let payments: PaymentsService;
  let outbox: OutboxService;
  let clocks: OrganizationClockService;
  let prisma: PrismaService;

  /**
   * O espião no lugar do SMTP.
   *
   * A falha é dirigida a um destinatário específico, e não à próxima chamada
   * qualquer. O relay é global por natureza: uma varredura entrega o que
   * estiver pendente, inclusive mensagens de organizações criadas por outros
   * testes do mesmo arquivo. Falhar "na próxima" acertaria a mensagem errada.
   */
  const enviados: { to: string; subject: string }[] = [];
  let falharPara: string | null = null;

  const mailerEspiao: Mailer = {
    send: (email) => {
      if (email.to === falharPara) {
        return Promise.reject(new Error('Servidor de email fora do ar'));
      }

      enviados.push({ to: email.to, subject: email.subject });
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createTestApp({ overrides: [{ token: MAILER, value: mailerEspiao }] });
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    payments = app.get(PaymentsService);
    outbox = app.get(OutboxService);
    clocks = app.get(OrganizationClockService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    enviados.length = 0;
    falharPara = null;
  });

  const montar = async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Outbox de Teste', slug: `outbox-${randomUUID().slice(0, 8)}` },
    });

    await clocks.freeze(organization.id, new Date('2026-05-01T12:00:00.000Z'));

    const customer = await catalog.createCustomer(organization.id, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Assinante do Outbox',
    });

    await catalog.attachPaymentMethod(organization.id, customer.id, {
      token: `pm_${randomUUID()}`,
    });

    const product = await catalog.createProduct(organization.id, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organization.id, product.id, {
      amount: Money.fromDecimal('80.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    const subscription = await clocks.runFor(organization.id, () =>
      subscriptions.start({
        organizationId: organization.id,
        customerId: customer.id,
        priceId: price.id,
      }),
    );

    return { organizationId: organization.id, customer, subscription };
  };

  const mensagens = (organizationId: string) =>
    prisma.outboxMessage.findMany({ where: { organizationId }, orderBy: { occurredAt: 'asc' } });

  it('a mensagem nasce na mesma transação do fato', async () => {
    const { organizationId } = await montar();

    const fila = await mensagens(organizationId);

    // A fatura emitida no início da assinatura já está na fila, e ainda não
    // saiu: gravar a intenção de contar e contar são momentos diferentes.
    expect(fila).toHaveLength(1);
    expect(fila[0]?.eventType).toBe('invoice.issued');
    expect(fila[0]?.status).toBe(OutboxStatus.PENDING);
    expect(enviados).toHaveLength(0);
  });

  /**
   * A garantia, provocada.
   *
   * Uma transação que falha depois de publicar não pode deixar mensagem para
   * trás. Se deixasse, alguém lá fora saberia de um fato que o banco desfez, e
   * não haveria como retirar o aviso.
   */
  it('transação desfeita não deixa mensagem na fila', async () => {
    const { organizationId, subscription } = await montar();
    const antes = await mensagens(organizationId);

    const outroProduto = await catalog.createProduct(organizationId, { name: 'Outro Plano' });
    const outroPreco = await catalog.createPrice(organizationId, outroProduto.id, {
      amount: Money.fromDecimal('300.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    // Ocupa a chave que a troca de plano vai usar no razão, o que faz a
    // transação inteira falhar no lançamento contábil.
    const [assinaturaAtual] = await prisma.$queryRaw<{ version: number }[]>`
      SELECT version FROM subscriptions WHERE id = ${subscription.id}::uuid
    `;

    await prisma.journalEntry.create({
      data: {
        organizationId,
        eventType: 'subscription.plan_changed',
        eventId: `plan-changed:${subscription.id}:${(assinaturaAtual?.version ?? 0) + 1}`,
        description: 'Lançamento que ocupa a chave do evento',
        occurredAt: new Date('2026-05-01T12:00:00.000Z'),
        lines: {
          create: [
            {
              accountId: await contaId(organizationId, 'customer:receivable'),
              amountMinor: 1n,
              currency: 'BRL',
            },
            {
              accountId: await contaId(organizationId, 'merchant:revenue'),
              amountMinor: -1n,
              currency: 'BRL',
            },
          ],
        },
      },
    });

    await expect(
      clocks.runFor(organizationId, () =>
        subscriptions.changePlan({
          organizationId,
          subscriptionId: subscription.id,
          priceId: outroPreco.id,
        }),
      ),
    ).rejects.toThrow(/já foi lançado/);

    const depois = await mensagens(organizationId);

    // Nada de novo na fila. A mensagem viveu e morreu com a transação.
    expect(depois).toHaveLength(antes.length);
  });

  it('o relay entrega e marca, e uma segunda passada não reenvia', async () => {
    const { organizationId, customer } = await montar();

    const primeira = await outbox.relay();
    expect(primeira.delivered).toBeGreaterThanOrEqual(1);

    expect(enviados.some((email) => email.to === customer.email)).toBe(true);
    expect(enviados.some((email) => email.subject.includes('Fatura'))).toBe(true);

    const fila = await mensagens(organizationId);
    expect(fila[0]?.status).toBe(OutboxStatus.DELIVERED);
    expect(fila[0]?.deliveredAt).not.toBeNull();

    // Entregue é entregue. Uma varredura nova não pode reenviar o que já saiu.
    enviados.length = 0;
    await outbox.relay();
    expect(enviados.filter((email) => email.to === customer.email)).toHaveLength(0);
  });

  /**
   * Falha de entrega não perde a mensagem.
   *
   * É o motivo de o outbox existir. Um email que não sai porque o servidor
   * caiu não pode desaparecer: a cobrança aconteceu e o cliente precisa saber.
   */
  it('entrega que falha volta para a fila e é reagendada', async () => {
    const { organizationId, customer } = await montar();
    falharPara = customer.email;

    const relatorio = await outbox.relay();

    expect(relatorio.retrying).toBeGreaterThanOrEqual(1);

    const fila = await mensagens(organizationId);
    expect(fila[0]?.status).toBe(OutboxStatus.PENDING);
    expect(fila[0]?.attempts).toBe(1);
    expect(fila[0]?.lastError).toMatch(/fora do ar/);
    expect(fila[0]?.nextAttemptAt).not.toBeNull();
  });

  it('o pagamento confirmado também vira aviso', async () => {
    const { organizationId, customer } = await montar();

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { organizationId } });
    await clocks.runFor(organizationId, () => payments.chargeInvoice(organizationId, invoice.id));

    await outbox.relay();

    // A busca é pelo destinatário, e não pelo assunto. O relay é global: uma
    // varredura entrega tudo que estiver pendente, inclusive recibos de
    // organizações criadas por outras suítes rodando em paralelo.
    const recibo = enviados.find(
      (email) => email.to === customer.email && email.subject.includes('Pagamento confirmado'),
    );
    expect(recibo).toBeDefined();

    const fila = await mensagens(organizationId);
    expect(fila.map((mensagem) => mensagem.eventType)).toEqual([
      'invoice.issued',
      'payment.succeeded',
    ]);
  });

  it('publicar o mesmo fato duas vezes não cria duas mensagens', async () => {
    const { organizationId, subscription } = await montar();

    // O ciclo idempotente republicaria a mesma fatura do mesmo período. O
    // índice único sobre (organização, tipo, evento) recusa a duplicata pelo
    // mesmo desenho que o razão usa.
    await expect(
      prisma.outboxMessage.create({
        data: {
          organizationId,
          eventType: 'invoice.issued',
          eventId: `invoice-issued:${subscription.id}:2026-05-01T12:00:00.000Z`,
          payload: {},
          occurredAt: new Date('2026-05-01T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow();
  });

  const contaId = async (organizationId: string, code: string): Promise<string> => {
    const conta = await prisma.account.findFirstOrThrow({
      where: { organizationId, code },
      select: { id: true },
    });

    return conta.id;
  };
});
