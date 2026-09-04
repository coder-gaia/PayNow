import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, WebhookDeliveryStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CatalogService } from '../src/modules/billing/application/catalog.service';
import { SubscriptionsService } from '../src/modules/billing/application/subscriptions.service';
import { OrganizationClockService } from '../src/modules/platform/clock/organization-clock.service';
import { OutboxService } from '../src/modules/platform/events/outbox.service';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { WebhookDispatcher } from '../src/modules/webhooks/application/webhook-dispatcher';
import { WebhookEndpointsService } from '../src/modules/webhooks/application/webhook-endpoints.service';
import { verifyWebhook } from '../src/modules/webhooks/domain/signature';
import { createTestApp } from './support/app';

/**
 * Webhooks de saída.
 *
 * Os testes falam com um servidor HTTP de verdade, subido aqui, e não com um
 * dublê de `fetch`. A diferença importa: o que está sendo verificado é a
 * entrega, e um dublê de `fetch` verificaria que a função foi chamada, que é
 * outra coisa. Com servidor de verdade dá para conferir o cabeçalho que chegou,
 * o corpo exato, e o que acontece quando ele responde 500 ou não responde.
 */
describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let catalog: CatalogService;
  let subscriptions: SubscriptionsService;
  let endpoints: WebhookEndpointsService;
  let dispatcher: WebhookDispatcher;
  let outbox: OutboxService;
  let clocks: OrganizationClockService;
  let prisma: PrismaService;

  /** O servidor que finge ser o merchant. */
  let servidor: Server;
  let baseUrl: string;

  interface Recebido {
    readonly body: string;
    readonly signature: string | undefined;
  }

  const recebidos: Recebido[] = [];

  /**
   * Como o servidor responde a cada organização. Fora do mapa, responde 200.
   *
   * Por organização e não global porque as entregas pendentes de um teste
   * sobrevivem a ele: a varredura seguinte pega o que ficou para trás. Um
   * `responderCom` global faria o 410 de um teste cair na entrega atrasada de
   * outro.
   */
  const respostas = new Map<string, { status?: number; falharPrimeiras?: number }>();

  beforeAll(async () => {
    app = await createTestApp();
    catalog = app.get(CatalogService);
    subscriptions = app.get(SubscriptionsService);
    endpoints = app.get(WebhookEndpointsService);
    dispatcher = app.get(WebhookDispatcher);
    outbox = app.get(OutboxService);
    clocks = app.get(OrganizationClockService);
    prisma = app.get(PrismaService);

    servidor = createServer((req, res) => {
      let body = '';
      req.on('data', (pedaco) => {
        body += pedaco;
      });

      req.on('end', () => {
        recebidos.push({
          body,
          signature: req.headers['paynow-signature'] as string | undefined,
        });

        const envelope = JSON.parse(body) as { organizationId: string };
        const regra = respostas.get(envelope.organizationId);

        if (regra?.falharPrimeiras) {
          regra.falharPrimeiras -= 1;
          res.writeHead(500).end('nao hoje');
          return;
        }

        res.writeHead(regra?.status ?? 200).end('ok');
      });
    });

    await new Promise<void>((resolve) => {
      servidor.listen(0, '127.0.0.1', resolve);
    });

    const { port } = servidor.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      servidor.close(() => {
        resolve();
      });
    });
    await app.close();
  });

  beforeEach(() => {
    recebidos.length = 0;
    respostas.clear();
  });

  /**
   * Uma organização com um endereço cadastrado e um evento já publicado.
   *
   * O evento sai de uma assinatura de verdade, e não de um `publish` forjado:
   * o que interessa verificar é que um fato de negócio chega ao merchant.
   *
   * Por padrão o endereço assina só `invoice.issued`. Iniciar uma assinatura
   * publica dois fatos, e a maior parte destes testes fala sobre o caminho de
   * **uma** entrega. Quem quiser os dois passa `eventTypes: []`.
   */
  const montar = async (options: { caminho?: string; eventTypes?: string[] } = {}) => {
    const organization = await prisma.organization.create({
      data: { name: 'Webhooks de Teste', slug: `wh-${randomUUID().slice(0, 8)}` },
    });

    await clocks.freeze(organization.id, new Date('2026-07-01T12:00:00.000Z'));

    const { endpoint, secret } = await endpoints.create(organization.id, {
      url: `${baseUrl}${options.caminho ?? '/hook'}`,
      eventTypes: options.eventTypes ?? ['invoice.issued'],
    });

    const customer = await catalog.createCustomer(organization.id, {
      email: `cliente-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Assinante do Webhook',
    });

    const product = await catalog.createProduct(organization.id, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organization.id, product.id, {
      amount: Money.fromDecimal('75.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    await clocks.runFor(organization.id, () =>
      subscriptions.start({
        organizationId: organization.id,
        customerId: customer.id,
        priceId: price.id,
      }),
    );

    return { organizationId: organization.id, endpoint, secret };
  };

  /**
   * As entregas de uma organização, opcionalmente de um tipo só.
   *
   * Sempre escopado. `relay` e `dispatch` são globais por natureza: uma
   * varredura entrega o que estiver pendente, inclusive de organizações
   * criadas por outros testes deste mesmo arquivo. Asserção global aqui seria
   * frágil por construção.
   */
  const entregas = (organizationId: string, eventType?: string) =>
    prisma.webhookDelivery.findMany({
      where: { organizationId, ...(eventType === undefined ? {} : { eventType }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  /** O que este servidor recebeu de uma organização específica. */
  const recebidosDe = (organizationId: string, eventType?: string) =>
    recebidos.filter((recebido) => {
      const envelope = JSON.parse(recebido.body) as { organizationId: string; type: string };
      return (
        envelope.organizationId === organizationId &&
        (eventType === undefined || envelope.type === eventType)
      );
    });

  it('o evento vira entrega enfileirada, sem chamada de rede nenhuma', async () => {
    const { organizationId, endpoint } = await montar({ eventTypes: [] });

    await outbox.relay();

    // Iniciar uma assinatura publica dois fatos: a assinatura começou e a
    // fatura foi emitida. Os dois viram entrega para este endereço.
    const fila = await entregas(organizationId);
    expect(fila.map((entrega) => entrega.eventType).sort()).toEqual([
      'invoice.issued',
      'subscription.started',
    ]);

    // A linha existe antes de qualquer HTTP acontecer. É isso que torna a
    // entrega retentável sem duplicar para os outros endereços.
    expect(fila.every((entrega) => entrega.endpointId === endpoint.id)).toBe(true);
    expect(fila.every((entrega) => entrega.status === WebhookDeliveryStatus.PENDING)).toBe(true);
    expect(recebidosDe(organizationId)).toHaveLength(0);
  });

  it('entrega assinada, e a assinatura confere com o segredo do endereço', async () => {
    const { organizationId, secret } = await montar();

    await outbox.relay();
    await dispatcher.dispatch();

    const daFatura = recebidosDe(organizationId, 'invoice.issued');
    expect(daFatura).toHaveLength(1);

    const recebido = daFatura[0];
    expect(recebido).toBeDefined();

    // O verificador é o mesmo que a documentação manda o integrador usar.
    const verificacao = verifyWebhook(
      recebido!.body,
      recebido!.signature,
      secret,
      new Date(),
    );
    expect(verificacao.valid).toBe(true);

    // O envelope carrega o tipo na raiz, para o merchant rotear sem inspecionar
    // o conteúdo.
    const envelope = JSON.parse(recebido!.body);
    expect(envelope.type).toBe('invoice.issued');
    expect(envelope.organizationId).toBe(organizationId);
    expect(envelope.data.amount.amountMinor).toBe('7500');

    const fila = await entregas(organizationId, 'invoice.issued');
    expect(fila[0]?.status).toBe(WebhookDeliveryStatus.SUCCEEDED);
    expect(fila[0]?.lastStatusCode).toBe(200);
    expect(fila[0]?.deliveredAt).not.toBeNull();
  });

  it('a assinatura não confere com outro segredo', async () => {
    const { organizationId } = await montar();

    await outbox.relay();
    await dispatcher.dispatch();

    const recebido = recebidosDe(organizationId)[0];
    const verificacao = verifyWebhook(
      recebido!.body,
      recebido!.signature,
      'whsec_outro_segredo_qualquer',
      new Date(),
    );

    expect(verificacao.valid).toBe(false);
    expect(verificacao.reason).toMatch(/não confere/);
  });

  /**
   * O instante entra na assinatura, e não ao lado dela.
   *
   * Se ficasse de fora, qualquer um poderia capturar uma entrega válida e
   * reenviá-la para sempre. Assinando junto, uma entrega velha é recusada.
   */
  it('recusa uma entrega capturada e reenviada depois da janela', async () => {
    const { organizationId, secret } = await montar();

    await outbox.relay();
    await dispatcher.dispatch();

    const recebido = recebidosDe(organizationId)[0];

    const dezMinutosDepois = new Date(Date.now() + 10 * 60 * 1000);
    const verificacao = verifyWebhook(
      recebido!.body,
      recebido!.signature,
      secret,
      dezMinutosDepois,
    );

    expect(verificacao.valid).toBe(false);
    expect(verificacao.reason).toMatch(/janela/);
  });

  it('resposta 500 reagenda com o calendário, e a entrega seguinte passa', async () => {
    const { organizationId } = await montar();
    respostas.set(organizationId, { falharPrimeiras: 1 });

    await outbox.relay();
    await dispatcher.dispatch();

    const depoisDaFalha = await entregas(organizationId);
    expect(depoisDaFalha[0]?.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(depoisDaFalha[0]?.attempts).toBe(1);
    expect(depoisDaFalha[0]?.lastStatusCode).toBe(500);
    expect(depoisDaFalha[0]?.nextAttemptAt).not.toBeNull();

    // A varredura seguinte só pega o que já venceu, então a entrega ainda não
    // sai: dez segundos de espera é o primeiro passo do calendário. A prova é
    // que a contagem de tentativas não andou.
    await dispatcher.dispatch();
    const cedo = await entregas(organizationId);
    expect(cedo[0]?.attempts).toBe(1);
    expect(cedo[0]?.status).toBe(WebhookDeliveryStatus.PENDING);

    // Forçando o vencimento, ela sai.
    await prisma.webhookDelivery.updateMany({
      where: { organizationId },
      data: { nextAttemptAt: new Date('2020-01-01T00:00:00.000Z') },
    });

    await dispatcher.dispatch();

    const final = await entregas(organizationId);
    expect(final[0]?.status).toBe(WebhookDeliveryStatus.SUCCEEDED);
    expect(final[0]?.attempts).toBe(2);
  });

  it('410 Gone desiste na hora, sem gastar o calendário', async () => {
    const { organizationId } = await montar();
    respostas.set(organizationId, { status: 410 });

    await outbox.relay();
    await dispatcher.dispatch();

    // Insistir contra um endereço que disse não existir mais é desperdício dos
    // dois lados, e é a única resposta de erro que não merece retentativa.
    const fila = await entregas(organizationId);
    expect(fila[0]?.status).toBe(WebhookDeliveryStatus.FAILED);
    expect(fila[0]?.attempts).toBe(1);
    expect(fila[0]?.nextAttemptAt).toBeNull();
  });

  it('reenvio manual devolve a entrega à fila com o calendário inteiro', async () => {
    const { organizationId } = await montar();
    respostas.set(organizationId, { status: 410 });

    await outbox.relay();
    await dispatcher.dispatch();

    const desistida = (await entregas(organizationId))[0];
    expect(desistida?.status).toBe(WebhookDeliveryStatus.FAILED);

    respostas.delete(organizationId);
    await dispatcher.replay(organizationId, desistida!.id);

    const depoisDoReplay = (await entregas(organizationId))[0];
    expect(depoisDoReplay?.status).toBe(WebhookDeliveryStatus.PENDING);
    expect(depoisDoReplay?.attempts).toBe(0);

    await dispatcher.dispatch();

    const final = (await entregas(organizationId))[0];
    expect(final?.status).toBe(WebhookDeliveryStatus.SUCCEEDED);
    expect(final?.attempts).toBe(1);
  });

  /**
   * O motivo de o consumidor do outbox não chamar rede.
   *
   * Dois endereços assinando o mesmo evento, um fora do ar. Se a entrega
   * acontecesse dentro do consumidor, a falha de um faria o outbox reentregar
   * a mensagem inteira, e o endereço que já tinha recebido receberia de novo.
   */
  it('um endereço fora do ar não faz o outro receber duas vezes', async () => {
    const { organizationId } = await montar();

    // A entrega do primeiro evento sai e termina, para o que vem depois ficar
    // isolado dela.
    await outbox.relay();
    await dispatcher.dispatch();

    // Um segundo endereço, apontando para uma porta onde não há ninguém.
    await endpoints.create(organizationId, {
      url: 'http://127.0.0.1:9/silencio',
      eventTypes: ['invoice.issued'],
    });

    // O evento já foi publicado antes do segundo endereço existir, então é
    // preciso um fato novo para os dois receberem.
    const customer = await catalog.createCustomer(organizationId, {
      email: `outro-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Outro Assinante',
    });

    const product = await catalog.createProduct(organizationId, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organizationId, product.id, {
      amount: Money.fromDecimal('20.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    await clocks.runFor(organizationId, () =>
      subscriptions.start({ organizationId, customerId: customer.id, priceId: price.id }),
    );

    await outbox.relay();
    recebidos.length = 0;

    await dispatcher.dispatch();
    await dispatcher.dispatch();

    // O endereço que responde recebeu uma vez, apesar de o outro ter falhado
    // nas duas rodadas.
    expect(recebidosDe(organizationId)).toHaveLength(1);

    const fila = await entregas(organizationId);
    const doSilencio = fila.filter((entrega) => entrega.lastError !== null);
    expect(doSilencio.length).toBeGreaterThanOrEqual(1);
  });

  it('o endereço só recebe os tipos que assinou', async () => {
    const { organizationId } = await montar({ eventTypes: ['payment.succeeded'] });

    await outbox.relay();

    // O evento publicado foi `invoice.issued`, que este endereço não assinou.
    expect(await entregas(organizationId)).toHaveLength(0);
  });

  it('endereço desligado para de receber', async () => {
    const { organizationId, endpoint } = await montar();

    await endpoints.setEnabled(organizationId, endpoint.id, false, new Date());

    const customer = await catalog.createCustomer(organizationId, {
      email: `depois-${randomUUID().slice(0, 8)}@exemplo.test`,
      name: 'Assinante Depois',
    });

    const product = await catalog.createProduct(organizationId, {
      name: `Plano ${randomUUID().slice(0, 6)}`,
    });

    const price = await catalog.createPrice(organizationId, product.id, {
      amount: Money.fromDecimal('10.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    await clocks.runFor(organizationId, () =>
      subscriptions.start({ organizationId, customerId: customer.id, priceId: price.id }),
    );

    const antes = (await entregas(organizationId)).length;
    await outbox.relay();

    expect((await entregas(organizationId)).length).toBe(antes);
  });

  it('o segredo novo invalida o anterior', async () => {
    const { organizationId, endpoint, secret } = await montar();

    const { secret: novo } = await endpoints.rotateSecret(organizationId, endpoint.id);

    expect(novo).not.toBe(secret);

    await outbox.relay();
    await dispatcher.dispatch();

    const recebido = recebidosDe(organizationId)[0];

    expect(verifyWebhook(recebido!.body, recebido!.signature, novo, new Date()).valid).toBe(true);
    expect(verifyWebhook(recebido!.body, recebido!.signature, secret, new Date()).valid).toBe(
      false,
    );
  });
});
