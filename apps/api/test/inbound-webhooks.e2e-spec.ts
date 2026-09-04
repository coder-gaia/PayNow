import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import {
  BillingInterval,
  InboundEventStatus,
  InvoiceStatus,
  PaymentStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { Money } from '@paynow/money';
import request from 'supertest';

import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../src/modules/billing/application/payments.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { FakeGateway } from '../src/modules/platform/payments/fake-gateway';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { InboundWebhooksService } from '../src/modules/webhooks/application/inbound-webhooks.service';
import { signWebhook, SIGNATURE_HEADER } from '../src/modules/webhooks/domain/signature';
import { createTestApp, httpServer } from './support/app';

/**
 * Webhooks de entrada.
 *
 * O caso que dá razão a este módulo inteiro é o primeiro teste daqui: a
 * cobrança cujo desfecho ninguém sabe. O provedor não respondeu, o dinheiro
 * pode ter saído, e sem webhook de entrada a única saída seria alguém abrir o
 * painel do provedor e conciliar à mão. O log de `registrarIndefinido` diz
 * isso com essas palavras.
 *
 * Os outros testes são sobre não confiar em quem bate na porta: a assinatura é
 * conferida antes de qualquer coisa, e a reentrega não pode aplicar o mesmo
 * desfecho duas vezes.
 */
describe('Webhooks de entrada (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let payments: PaymentsService;
  let inbound: InboundWebhooksService;
  let ledger: LedgerService;
  let gateway: FakeGateway;
  let clocks: OrganizationClockService;
  let prisma: PrismaService;

  /** O mesmo padrão do serviço: sem variável definida, este é o segredo. */
  const SEGREDO = process.env['INBOUND_WEBHOOK_SECRET'] ?? 'whsec_fake_provider_desenvolvimento';

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    payments = app.get(PaymentsService);
    inbound = app.get(InboundWebhooksService);
    ledger = app.get(LedgerService);
    gateway = app.get(FakeGateway);
    clocks = app.get(OrganizationClockService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gateway.reset();
  });

  /** Uma organização com fatura aberta e cartão vinculado. */
  const montar = async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Entrada de Teste', slug: `in-${randomUUID().slice(0, 8)}` },
    });

    await clocks.freeze(organization.id, new Date('2026-08-01T12:00:00.000Z'));

    const customer = await catalog.createCustomer(organization.id, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Mercearia de Teste',
    });

    await catalog.attachPaymentMethod(organization.id, customer.id, {
      token: `pm_${randomUUID()}`,
      brand: 'visa',
      last4: '4242',
    });

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

    return { organizationId: organization.id, subscription, invoice };
  };

  /**
   * Uma cobrança que ficou sem desfecho.
   *
   * O gateway não responde, a tentativa fica `PENDING`, e é exatamente esse o
   * estado que o webhook de entrada existe para resolver.
   */
  const cobrancaSemDesfecho = async () => {
    const { organizationId, subscription, invoice } = await montar();

    gateway.setScenario({ kind: 'timeout' });

    const resultado = await clocks.runFor(organizationId, () =>
      payments.chargeInvoice(organizationId, invoice.id),
    );

    expect(resultado.status).toBe(PaymentStatus.PENDING);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });

    return { organizationId, subscription, invoice, payment };
  };

  /** Monta o corpo e a assinatura como o provedor faria. */
  const evento = (
    type: string,
    data: Record<string, unknown>,
    options: { id?: string; secret?: string; assinadoEm?: Date } = {},
  ) => {
    const corpo = { id: options.id ?? `evt_${randomUUID()}`, type, data };

    const assinado = signWebhook(
      corpo,
      options.secret ?? SEGREDO,
      options.assinadoEm ?? new Date(),
    );

    return { ...assinado, eventId: corpo.id };
  };

  const enviar = (assinado: { header: string; body: string }) =>
    request(httpServer(app))
      .post('/v1/inbound-webhooks/fake')
      .set(SIGNATURE_HEADER, assinado.header)
      .set('content-type', 'application/json')
      .send(assinado.body);

  it('resolve a cobrança que tinha ficado sem desfecho', async () => {
    const { organizationId, subscription, invoice, payment } = await cobrancaSemDesfecho();

    const assinado = evento('charge.succeeded', {
      idempotencyKey: payment.idempotencyKey,
      reference: 'fake_ch_confirmada_depois',
    });

    const resposta = await enviar(assinado).expect(200);
    expect(resposta.body.received).toBe(true);
    expect(resposta.body.duplicate).toBe(false);

    // A cobrança que estava em aberto virou paga, sem ninguém conciliar à mão.
    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.status).toBe(PaymentStatus.SUCCEEDED);
    expect(depois.gatewayRef).toBe('fake_ch_confirmada_depois');

    const fatura = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(fatura.status).toBe(InvoiceStatus.PAID);
    expect(fatura.paidAt).not.toBeNull();

    // E a assinatura, que nasce INCOMPLETE, foi ativada pelo dinheiro que
    // entrou. É o mesmo caminho da cobrança síncrona: o webhook não é um
    // atalho que pula o razão nem a máquina de estados.
    const assinatura = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(assinatura.status).toBe(SubscriptionStatus.ACTIVE);

    const verificacao = await ledger.verify(organizationId);
    expect(verificacao.balanced).toBe(true);
    expect(verificacao.violations).toEqual([]);
  });

  it('o lançamento cai no instante congelado da organização, e não na hora real', async () => {
    const { organizationId, payment } = await cobrancaSemDesfecho();

    await enviar(
      evento('charge.succeeded', {
        idempotencyKey: payment.idempotencyKey,
        reference: 'fake_ch_no_tempo_certo',
      }),
    ).expect(200);

    // A requisição do provedor chega pelo relógio de parede, sem contexto de
    // organização nenhum. Se o desfecho fosse aplicado com a hora real, uma
    // organização com o tempo congelado teria lançamentos fora da linha do
    // tempo que ela própria dita.
    const lancamento = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    expect(lancamento.occurredAt.toISOString()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('a reentrega do mesmo evento não cobra de novo', async () => {
    const { payment } = await cobrancaSemDesfecho();

    const assinado = evento('charge.succeeded', {
      idempotencyKey: payment.idempotencyKey,
      reference: 'fake_ch_uma_vez_so',
    });

    const primeira = await enviar(assinado).expect(200);
    expect(primeira.body.duplicate).toBe(false);

    // Mesmo corpo, mesma assinatura: é o provedor insistindo porque não viu a
    // nossa resposta. O índice único recusa antes de qualquer efeito.
    const segunda = await enviar(assinado).expect(200);
    expect(segunda.body.duplicate).toBe(true);

    const recibos = await prisma.inboundWebhookEvent.count({
      where: { externalId: assinado.eventId },
    });
    expect(recibos).toBe(1);

    // Uma só tentativa, e o razão continua fechando: o efeito não aconteceu
    // duas vezes.
    const tentativas = await prisma.payment.count({ where: { invoiceId: payment.invoiceId } });
    expect(tentativas).toBe(1);
  });

  /**
   * A segunda linha de defesa, sozinha.
   *
   * O índice único cobre a mesma entrega repetida. Ele não cobre dois eventos
   * **distintos** falando da mesma cobrança, que é o que acontece quando o
   * provedor reemite um evento com id novo. Quem barra esse caso é a checagem
   * de estado no lado que aplica.
   */
  it('dois eventos diferentes sobre a mesma cobrança aplicam o desfecho uma vez só', async () => {
    const { payment } = await cobrancaSemDesfecho();

    await enviar(
      evento('charge.succeeded', {
        idempotencyKey: payment.idempotencyKey,
        reference: 'fake_ch_primeiro',
      }),
    ).expect(200);

    const segundo = evento('charge.succeeded', {
      idempotencyKey: payment.idempotencyKey,
      reference: 'fake_ch_segundo',
    });

    const resposta = await enviar(segundo).expect(200);

    // Passou pela deduplicação, porque o id é outro, e foi barrado pelo estado.
    expect(resposta.body.duplicate).toBe(false);
    expect(resposta.body.note).toMatch(/já estava/);

    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.gatewayRef).toBe('fake_ch_primeiro');

    const recibo = await prisma.inboundWebhookEvent.findFirstOrThrow({
      where: { externalId: segundo.eventId },
    });
    expect(recibo.status).toBe(InboundEventStatus.IGNORED);
  });

  it('a recusa contada depois agenda a próxima tentativa', async () => {
    const { invoice, payment } = await cobrancaSemDesfecho();

    await enviar(
      evento('charge.failed', {
        idempotencyKey: payment.idempotencyKey,
        code: 'insufficient_funds',
        message: 'Sem saldo.',
        retriable: true,
      }),
    ).expect(200);

    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.status).toBe(PaymentStatus.FAILED);
    expect(depois.failureCode).toBe('insufficient_funds');

    // A fatura volta para a fila de recuperação, com a mesma disciplina da
    // recusa síncrona.
    const fatura = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(fatura.status).not.toBe(InvoiceStatus.PAID);
    expect(fatura.nextAttemptAt).not.toBeNull();
  });

  it('recusa uma assinatura feita com outro segredo', async () => {
    const { payment } = await cobrancaSemDesfecho();

    const assinado = evento(
      'charge.succeeded',
      { idempotencyKey: payment.idempotencyKey, reference: 'fake_ch_forjada' },
      { secret: 'whsec_nao_e_o_nosso' },
    );

    await enviar(assinado).expect(401);

    // Nada foi gravado: um corpo que não prova sua origem não vira recibo.
    const recibos = await prisma.inboundWebhookEvent.count({
      where: { externalId: assinado.eventId },
    });
    expect(recibos).toBe(0);

    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.status).toBe(PaymentStatus.PENDING);
  });

  it('recusa uma entrega legítima capturada e reenviada depois da janela', async () => {
    const { payment } = await cobrancaSemDesfecho();

    const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000);

    const assinado = evento(
      'charge.succeeded',
      { idempotencyKey: payment.idempotencyKey, reference: 'fake_ch_velha' },
      { assinadoEm: dezMinutosAtras },
    );

    // A assinatura é válida: foi o nosso provedor que a fez. O que a recusa é
    // a idade, e sem isso uma entrega capturada valeria para sempre.
    await enviar(assinado).expect(401);

    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.status).toBe(PaymentStatus.PENDING);
  });

  it('um evento sobre cobrança que não existe aqui é aceito e não vira erro', async () => {
    const assinado = evento('charge.succeeded', {
      idempotencyKey: `charge:${randomUUID()}:1`,
      reference: 'fake_ch_de_outro_ambiente',
    });

    // Pode ser o ambiente de teste de alguém apontado para cá. Registrar e
    // seguir é a resposta certa: recusar faria o provedor insistir para sempre
    // contra um evento que nunca vai fazer sentido para nós.
    const resposta = await enviar(assinado).expect(200);
    expect(resposta.body.note).toMatch(/Nenhuma cobrança/);

    const recibo = await prisma.inboundWebhookEvent.findFirstOrThrow({
      where: { externalId: assinado.eventId },
    });
    expect(recibo.status).toBe(InboundEventStatus.IGNORED);
  });

  it('um tipo que não tratamos é guardado e ignorado', async () => {
    const assinado = evento('dispute.opened', { idempotencyKey: 'charge:qualquer:1' });

    await enviar(assinado).expect(200);

    const recibo = await prisma.inboundWebhookEvent.findFirstOrThrow({
      where: { externalId: assinado.eventId },
    });

    // Guardado, e não descartado: quando disputa virar recurso, o histórico do
    // que já chegou está aqui.
    expect(recibo.status).toBe(InboundEventStatus.IGNORED);
    expect(recibo.note).toMatch(/dispute.opened/);
  });

  it('um evento sem id é recusado, porque sem id não há deduplicação', async () => {
    const corpo = { type: 'charge.succeeded', data: { idempotencyKey: 'charge:x:1' } };
    const assinado = signWebhook(corpo, SEGREDO, new Date());

    await enviar(assinado).expect(401);
  });

  /**
   * O recibo sobrevive ao processo morrer entre gravar e aplicar.
   *
   * É o buraco que o índice único sozinho não cobre, e o motivo de a checagem
   * de estado existir do outro lado. Aqui o estado interrompido é forjado à
   * mão, porque matar o processo no meio de um teste não é reproduzível.
   */
  it('um recibo que ficou por aplicar é retomado, e uma vez só', async () => {
    const { payment } = await cobrancaSemDesfecho();

    const externalId = `evt_${randomUUID()}`;
    const corpo = JSON.stringify({
      id: externalId,
      type: 'charge.succeeded',
      data: { idempotencyKey: payment.idempotencyKey, reference: 'fake_ch_retomada' },
    });

    await prisma.inboundWebhookEvent.create({
      data: {
        provider: 'fake',
        externalId,
        eventType: 'charge.succeeded',
        body: corpo,
        status: InboundEventStatus.RECEIVED,
      },
    });

    await inbound.reprocessPending();

    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.status).toBe(PaymentStatus.SUCCEEDED);
    expect(depois.gatewayRef).toBe('fake_ch_retomada');

    const recibo = await prisma.inboundWebhookEvent.findFirstOrThrow({ where: { externalId } });
    expect(recibo.status).toBe(InboundEventStatus.PROCESSED);

    // Rodar de novo não aplica de novo. E para que a prova seja da checagem de
    // estado, e não do filtro da consulta, o recibo volta a RECEIVED: assim o
    // reprocessamento **encontra** o evento e ainda assim não aplica.
    await prisma.inboundWebhookEvent.update({
      where: { id: recibo.id },
      data: { status: InboundEventStatus.RECEIVED, processedAt: null },
    });

    await inbound.reprocessPending();

    const denovo = await prisma.inboundWebhookEvent.findFirstOrThrow({ where: { externalId } });
    expect(denovo.status).toBe(InboundEventStatus.IGNORED);
    expect(denovo.note).toMatch(/já estava/);

    const tentativas = await prisma.payment.count({ where: { invoiceId: payment.invoiceId } });
    expect(tentativas).toBe(1);
  });

  /**
   * Um recibo problemático não sequestra a varredura.
   *
   * `aplicar` relança de propósito, para o provedor reentregar quando é ele que
   * está esperando resposta. Na retomada não há provedor esperando, e deixar o
   * erro subir faria um recibo estragado impedir todos os seguintes de serem
   * retomados: exatamente o efeito que a retomada existe para evitar.
   */
  it('um recibo estragado não impede a retomada dos outros', async () => {
    const { payment } = await cobrancaSemDesfecho();

    const estragado = `evt_${randomUUID()}`;
    const bom = `evt_${randomUUID()}`;

    await prisma.inboundWebhookEvent.createMany({
      data: [
        {
          provider: 'fake',
          externalId: estragado,
          eventType: 'charge.succeeded',
          body: 'isto nao e json',
          status: InboundEventStatus.RECEIVED,
          // Mais antigo, para ser o primeiro da varredura: se ele derrubasse a
          // rodada, o de baixo nunca seria alcançado.
          receivedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
        {
          provider: 'fake',
          externalId: bom,
          eventType: 'charge.succeeded',
          body: JSON.stringify({
            id: bom,
            type: 'charge.succeeded',
            data: { idempotencyKey: payment.idempotencyKey, reference: 'fake_ch_depois_do_ruim' },
          }),
          status: InboundEventStatus.RECEIVED,
          receivedAt: new Date('2020-01-02T00:00:00.000Z'),
        },
      ],
    });

    const relatorio = await inbound.reprocessPending();
    expect(relatorio.falhos).toBeGreaterThanOrEqual(1);

    const depois = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(depois.status).toBe(PaymentStatus.SUCCEEDED);
    expect(depois.gatewayRef).toBe('fake_ch_depois_do_ruim');

    // E o estragado sai do caminho, em vez de ser varrido de novo a cada
    // minuto para sempre.
    const recusado = await prisma.inboundWebhookEvent.findFirstOrThrow({
      where: { externalId: estragado },
    });
    expect(recusado.status).toBe(InboundEventStatus.FAILED);
  });
});
