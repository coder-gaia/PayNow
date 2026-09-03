import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, OutboxStatus, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { BillingCycleService } from '../src/modules/billing/application/billing-cycle.service';
import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../src/modules/billing/application/payments.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { ClockScopeStorage } from '../src/modules/platform/clock/clock-scope';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { DomainEventPublisher } from '../src/modules/platform/events/domain-event-publisher';
import { EVENT } from '../src/modules/platform/events/domain-event';
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
  let publisher: DomainEventPublisher;
  let cycle: BillingCycleService;
  let scopes: ClockScopeStorage;
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
    publisher = app.get(DomainEventPublisher);
    cycle = app.get(BillingCycleService);
    scopes = app.get(ClockScopeStorage);
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

  /**
   * A fila da organização, na ordem em que o relay a percorreria.
   *
   * O desempate por `id` não é detalhe de teste: com o relógio congelado, a
   * fatura e o pagamento acontecem no mesmo instante virtual, e ordenar só por
   * `occurredAt` devolve as duas em ordem arbitrária. Foi assim que este teste
   * passou local e falhou no CI.
   */
  const mensagens = (organizationId: string) =>
    prisma.outboxMessage.findMany({
      where: { organizationId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });

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
   *
   * O evento escolhido tem de ser um que o outbox realmente enfileira. A
   * primeira versão deste teste usava `subscription.plan_changed`, que não tem
   * consumidor registrado: `enqueue` desiste na primeira linha e nenhuma
   * mensagem seria escrita nem no caminho feliz. O teste passava afirmando
   * nada, que é pior do que não existir. Aqui a chave ocupada é a da fatura de
   * renovação, que tem consumidor, e por isso a asserção tem o que verificar.
   */
  it('transação desfeita não deixa mensagem na fila', async () => {
    const { organizationId, subscription } = await montar();

    // Precisa estar ativa para o ciclo renovar em vez de expirar.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: SubscriptionStatus.ACTIVE },
    });

    const antes = await mensagens(organizationId);

    // Ocupa a chave que a fatura da renovação vai usar no razão, o que faz a
    // transação inteira da virada de ciclo falhar no lançamento contábil.
    const inicioDoProximoCiclo = subscription.currentPeriodEnd;

    await prisma.journalEntry.create({
      data: {
        organizationId,
        eventType: 'invoice.issued',
        eventId: `invoice-issued:${subscription.id}:${inicioDoProximoCiclo.toISOString()}`,
        description: 'Lançamento que ocupa a chave do evento',
        occurredAt: inicioDoProximoCiclo,
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

    const state = await clocks.advance(organizationId, 40 * 24 * 60 * 60 * 1000);

    await expect(
      scopes.run({ organizationId, now: state.now, virtual: true }, () =>
        cycle.runDue(organizationId),
      ),
    ).rejects.toThrow(/já foi lançado/);

    const depois = await mensagens(organizationId);

    // Nada de novo na fila. A mensagem viveu e morreu com a transação.
    expect(depois).toHaveLength(antes.length);

    // E o ciclo não avançou: a assinatura continua no período de antes.
    const assinatura = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(assinatura.currentPeriodEnd.toISOString()).toBe(inicioDoProximoCiclo.toISOString());
  });

  /**
   * A costura, exercitada direto.
   *
   * O teste acima prova que um handler que falha derruba a transação inteira,
   * mas não prova que o `enqueue` usa a transação de quem publicou: o handler
   * do razão lança **antes** de o enqueue rodar, então ele nunca é alcançado.
   * E não existe hoje nenhum caminho de domínio que falhe depois de um publish
   * bem sucedido, porque publicar é sempre a última coisa que cada transação
   * faz.
   *
   * Então a garantia é provocada aqui, direto na costura: publica dentro de uma
   * transação e desiste em seguida. Mover o `enqueue` para fora da transação
   * faz este teste falhar, e foi assim que ele foi conferido.
   */
  it('a mensagem morre com a transação que a publicou', async () => {
    const { organizationId, customer } = await montar();
    const antes = await mensagens(organizationId);

    const chave = `invoice-issued:costura:${randomUUID()}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await publisher.publish(
          {
            type: EVENT.INVOICE_ISSUED,
            id: chave,
            organizationId,
            occurredAt: new Date('2026-05-01T12:00:00.000Z'),
            payload: {
              invoiceId: randomUUID(),
              invoiceNumber: 9999,
              customerId: customer.id,
              description: 'Fatura da sonda de costura',
              amount: { amountMinor: '1000', currency: 'BRL' },
              periodStart: '2026-05-01T12:00:00.000Z',
              periodEnd: '2026-06-01T12:00:00.000Z',
              dueAt: '2026-05-04T12:00:00.000Z',
            },
          },
          tx,
        );

        throw new Error('desisti depois de publicar');
      }),
    ).rejects.toThrow(/desisti depois de publicar/);

    // Nem a mensagem, nem o lançamento que o handler escreveu.
    expect(await mensagens(organizationId)).toHaveLength(antes.length);

    const lancamento = await prisma.journalEntry.findFirst({
      where: { organizationId, eventId: chave },
    });
    expect(lancamento).toBeNull();
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
