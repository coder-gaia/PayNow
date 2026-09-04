import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { BillingInterval, InvoiceStatus, PaymentStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { BillingCycleService } from '../../src/modules/billing/application/billing-cycle.service';
import { CatalogService } from '../../src/modules/billing/application/catalog.service';
import { PaymentsService } from '../../src/modules/billing/application/payments.service';
import { RefundsService } from '../../src/modules/billing/application/refunds.service';
import { SubscriptionsService } from '../../src/modules/billing/application/subscriptions.service';
import { LedgerService } from '../../src/modules/ledger/application/ledger.service';
import { ClockScopeStorage } from '../../src/modules/platform/clock/clock-scope';
import { OrganizationClockService } from '../../src/modules/platform/clock/organization-clock.service';
import {
  FakeGateway,
  type FakeNotification,
} from '../../src/modules/platform/payments/fake-gateway';
import { PrismaService } from '../../src/modules/platform/prisma/prisma.service';
import { InboundWebhooksService } from '../../src/modules/webhooks/application/inbound-webhooks.service';
import { signWebhook } from '../../src/modules/webhooks/domain/signature';
import type { Rng } from './rng';

const SEGREDO = process.env['INBOUND_WEBHOOK_SECRET'] ?? 'whsec_fake_provider_desenvolvimento';

/** O instante em que todo cenário começa. Fixo, para o tempo ser só o que o roteiro diz. */
const INICIO = new Date('2027-01-01T12:00:00.000Z');

/**
 * Um passo do roteiro.
 *
 * Cada um é uma coisa que um merchant de verdade faz, ou que o tempo faz por
 * ele. A adversidade não está em inventar operação impossível: está na ordem, na
 * repetição, e no provedor contando o desfecho tarde.
 */
export type Passo =
  /**
   * Tenta cobrar a fatura em aberto de uma das assinaturas.
   *
   * `alvo` é o índice da **assinatura**, e não a posição numa lista de faturas
   * em aberto. A distinção custou uma tarde: mirar por posição faz o alvo
   * depender de quantas faturas já foram pagas, que é justamente o que a ordem
   * de entrega muda. As duas execuções passavam a cobrar clientes diferentes, e
   * a divergência no fim era consequência disso, e não da ordem das
   * notificações, que é a única variável que a suíte quer isolar.
   *
   * Uma assinatura é a mesma nas duas execuções, sempre. O alvo tem de ser
   * identidade, e não posição.
   */
  | {
      readonly kind: 'cobrar';
      readonly gateway: CenarioDoGateway;
      readonly alvo: number;
    }
  /** Adianta o relógio e roda o ciclo, como o worker faria. */
  | { readonly kind: 'avancar'; readonly horas: number }
  /** O provedor conta parte do que sabe: fora de ordem, repetido, e segurando um pouco. */
  | { readonly kind: 'contarDesfechos' }
  /** O provedor termina de contar tudo. Fecha o cenário. */
  | { readonly kind: 'contarTudo' }
  /** Estorna parte do que já foi pago por uma das assinaturas. */
  | { readonly kind: 'estornar'; readonly alvo: number; readonly fracao: number }
  | { readonly kind: 'trocarPlano'; readonly alvo: number }
  | { readonly kind: 'cancelar'; readonly alvo: number; readonly imediato: boolean };

type CenarioDoGateway =
  | { readonly kind: 'succeed' }
  | { readonly kind: 'decline' }
  /** O caso difícil: não responde, mas do lado de lá aconteceu alguma coisa. */
  | { readonly kind: 'timeout'; readonly desfechoReal: 'succeeded' | 'failed' }
  /** Não responde e nada aconteceu. Não há desfecho para contar depois. */
  | { readonly kind: 'timeoutSemEfeito' };

/**
 * O estado final que interessa comparar.
 *
 * O que está aqui é o que o merchant e o cliente enxergam, e é sobre isto que a
 * convergência é afirmada.
 *
 * O que **não** está aqui é tão deliberado quanto o que está. Contagem de
 * tentativas, número de linhas de pagamento e horários ficam de fora porque são
 * função de quando o provedor resolveu falar, e não dos fatos. Uma notificação
 * que chega antes da retentativa evita a retentativa; a mesma notificação
 * chegando depois encontra a cobrança já resolvida. Nos dois casos a fatura
 * termina paga pelo mesmo valor, que é a afirmação que vale a pena defender.
 * Incluir a contagem faria a suíte falhar por comportamento correto, e um teste
 * que acusa o correto é pior do que nenhum teste.
 */
export interface Projecao {
  readonly assinatura: string;
  readonly faturasPorStatus: Record<string, number>;
  readonly totalPagoMinor: string;
  readonly totalEstornadoMinor: string;
  readonly saldos: Record<string, string>;
  readonly razaoFecha: boolean;
}

export interface ResultadoDoCenario {
  readonly organizationId: string;
  readonly projecao: Projecao;
  /** Quantas vezes o razão foi verificado no meio do caminho. */
  readonly verificacoesIntermediarias: number;
}

/**
 * Constrói um roteiro a partir de uma semente.
 *
 * O roteiro é dado, e não descoberto durante a execução: os dois lados da
 * comparação de convergência precisam correr exatamente as mesmas operações de
 * negócio, e só divergir na ordem de entrega das notificações.
 */
export function sortearRoteiro(rng: Rng, passos: number): Passo[] {
  const roteiro: Passo[] = [];

  // Fase adversarial: cobrar, deixar o tempo passar, e o provedor contando o
  // que quer, quando quer, repetido e fora de ordem.
  for (let i = 0; i < passos; i += 1) {
    roteiro.push(sortearPassoAdversarial(rng));
  }

  // A convergência só é afirmável depois que o provedor contou **tudo**. Uma
  // execução que segurou um desfecho para sempre termina legitimamente em outro
  // lugar, porque lhe falta informação, e não porque o sistema divergiu. A
  // primeira versão desta suíte terminava com uma entrega parcial e acusava
  // exatamente isso, que é acusar o correto.
  roteiro.push({ kind: 'contarTudo' });

  // Fase de negócio, depois do ponto de sincronia. Estorno, troca de plano e
  // cancelamento entram aqui e não antes, e o motivo é honestidade sobre o que
  // a suíte consegue afirmar: um estorno decidido no meio da adversidade age
  // sobre o que se sabe **naquele instante**, e o que se sabe naquele instante
  // depende legitimamente de quando o provedor falou. Duas execuções que
  // estornam pagamentos diferentes divergem por terem feito coisas diferentes,
  // e acusar isso seria acusar o correto.
  //
  // Depois do ponto de sincronia as duas execuções conhecem os mesmos fatos, e
  // então uma divergência volta a ser defeito.
  for (let i = 0; i < 2; i += 1) {
    roteiro.push(sortearPassoDeNegocio(rng));
  }

  roteiro.push({ kind: 'contarTudo' });

  return roteiro;
}

function sortearPassoAdversarial(rng: Rng): Passo {
  const dado = rng.inteiro(100);

  if (dado < 42) {
    return { kind: 'cobrar', gateway: sortearGateway(rng), alvo: rng.inteiro(1000) };
  }

  if (dado < 70) {
    // Três escalas, e cada uma alcança uma coisa diferente. Horas não vencem
    // nenhum passo do calendário de recuperação. Dias vencem vários. Um mês
    // renova o ciclo e emite fatura nova, que é o que põe mais de uma cobrança
    // em voo ao mesmo tempo: sem isso não existe "fora de ordem", porque só há
    // uma ordem possível.
    return { kind: 'avancar', horas: rng.escolher([1, 2, 6, 25, 73, 169, 745, 750]) };
  }

  return { kind: 'contarDesfechos' };
}

function sortearPassoDeNegocio(rng: Rng): Passo {
  const dado = rng.inteiro(100);
  const alvo = rng.inteiro(1000);

  if (dado < 55) {
    return { kind: 'estornar', alvo, fracao: rng.escolher([0.25, 0.5, 1]) };
  }

  if (dado < 85) {
    return { kind: 'trocarPlano', alvo };
  }

  return { kind: 'cancelar', alvo, imediato: rng.talvez(0.5) };
}

function sortearGateway(rng: Rng): CenarioDoGateway {
  const dado = rng.inteiro(100);

  // Pesado no caso difícil de propósito. Uma distribuição realista, com o
  // caminho feliz dominando, faz a maior parte dos cenários terminar na
  // primeira cobrança e o resto do roteiro rodar em vazio: foi o que a primeira
  // versão desta suíte fez, e ela não pegava nada. Uma suíte adversarial não
  // simula produção, ela procura o que quebra.
  if (dado < 15) {
    return { kind: 'succeed' };
  }

  if (dado < 30) {
    return { kind: 'decline' };
  }

  if (dado < 88) {
    return { kind: 'timeout', desfechoReal: rng.talvez(0.65) ? 'succeeded' : 'failed' };
  }

  return { kind: 'timeoutSemEfeito' };
}

/**
 * O executor.
 *
 * Cada instância trabalha em uma organização própria, criada aqui. É o que
 * permite rodar o mesmo roteiro duas vezes e comparar: as duas execuções não se
 * enxergam.
 */
export class Cenario {
  private readonly catalog: CatalogService;
  private readonly subscriptions: SubscriptionsService;
  private readonly payments: PaymentsService;
  private readonly refunds: RefundsService;
  private readonly cycle: BillingCycleService;
  private readonly ledger: LedgerService;
  private readonly inbound: InboundWebhooksService;
  private readonly gateway: FakeGateway;
  private readonly clocks: OrganizationClockService;
  private readonly scopes: ClockScopeStorage;
  private readonly prisma: PrismaService;

  /** Desfechos que o provedor conhece e ainda não contou. */
  private naoContados: FakeNotification[] = [];

  /** Instrumentação: quantas notificações foram entregues, e quantas eram repetição. */
  entregues = 0;
  repetidas = 0;
  produzidas = 0;

  private organizationId = '';

  /**
   * As assinaturas da organização, em ordem fixa.
   *
   * É a identidade que os passos do roteiro miram. Fixa, criada no mesmo lugar
   * e na mesma ordem nas duas execuções, e por isso comparável.
   */
  private readonly assinaturas: string[] = [];

  private precoAlternativoId = '';
  private verificacoes = 0;

  constructor(app: INestApplication) {
    this.catalog = app.get(CatalogService);
    this.subscriptions = app.get(SubscriptionsService);
    this.payments = app.get(PaymentsService);
    this.refunds = app.get(RefundsService);
    this.cycle = app.get(BillingCycleService);
    this.ledger = app.get(LedgerService);
    this.inbound = app.get(InboundWebhooksService);
    this.gateway = app.get(FakeGateway);
    this.clocks = app.get(OrganizationClockService);
    this.scopes = app.get(ClockScopeStorage);
    this.prisma = app.get(PrismaService);
  }

  /**
   * Roda o roteiro e devolve o estado final.
   *
   * `rngEntrega` controla **só** a ordem e a repetição das notificações. É a
   * separação que dá sentido à comparação: o mesmo roteiro, com entregas
   * diferentes, tem de terminar igual.
   */
  async executar(roteiro: readonly Passo[], rngEntrega: Rng): Promise<ResultadoDoCenario> {
    await this.montar();

    for (const passo of roteiro) {
      await this.aplicar(passo, rngEntrega);

      // A afirmação mais forte da suíte, e a que precisa valer em todo ponto
      // intermediário: um razão que fecha só no fim não é um razão que fecha.
      const verificacao = await this.ledger.verify(this.organizationId);
      this.verificacoes += 1;

      if (!verificacao.balanced) {
        throw new Error(
          `O razão desbalanceou depois de ${descrever(passo)}: ` +
            `${verificacao.violations.join('; ')}`,
        );
      }
    }

    return {
      organizationId: this.organizationId,
      projecao: await this.projetar(),
      verificacoesIntermediarias: this.verificacoes,
    };
  }

  private async montar(): Promise<void> {
    const organization = await this.prisma.organization.create({
      data: { name: 'Adversarial', slug: `adv-${randomUUID().slice(0, 12)}` },
    });

    this.organizationId = organization.id;
    await this.clocks.freeze(organization.id, INICIO);

    const customer = await this.catalog.createCustomer(organization.id, {
      email: `adv-${randomUUID().slice(0, 12)}@exemplo.test`,
      name: 'Cliente Adversarial',
    });

    await this.catalog.attachPaymentMethod(organization.id, customer.id, {
      token: `pm_${randomUUID()}`,
      brand: 'visa',
      last4: '4242',
    });

    const product = await this.catalog.createProduct(organization.id, { name: 'Plano Base' });

    const price = await this.catalog.createPrice(organization.id, product.id, {
      amount: Money.fromDecimal('100.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    const alternativo = await this.catalog.createPrice(organization.id, product.id, {
      amount: Money.fromDecimal('250.00', 'BRL'),
      interval: BillingInterval.MONTH,
    });

    this.precoAlternativoId = alternativo.id;

    const subscription = await this.comRelogio(() =>
      this.subscriptions.start({
        organizationId: organization.id,
        customerId: customer.id,
        priceId: price.id,
      }),
    );

    this.assinaturas.push(subscription.id);

    // Uma segunda assinatura, de outro cliente. Com uma só, existe no máximo
    // uma cobrança em voo por vez, e "fora de ordem" não quer dizer nada quando
    // só há uma ordem possível.
    const segundo = await this.catalog.createCustomer(organization.id, {
      email: `adv2-${randomUUID().slice(0, 12)}@exemplo.test`,
      name: 'Segundo Cliente',
    });

    await this.catalog.attachPaymentMethod(organization.id, segundo.id, {
      token: `pm_${randomUUID()}`,
      brand: 'visa',
      last4: '1881',
    });

    const segunda = await this.comRelogio(() =>
      this.subscriptions.start({
        organizationId: organization.id,
        customerId: segundo.id,
        priceId: alternativo.id,
      }),
    );

    this.assinaturas.push(segunda.id);
  }

  private async aplicar(passo: Passo, rngEntrega: Rng): Promise<void> {
    switch (passo.kind) {
      case 'cobrar':
        return this.cobrar(passo.gateway, passo.alvo);

      case 'avancar':
        return this.avancar(passo.horas);

      case 'contarDesfechos':
        return this.contarDesfechos(rngEntrega);

      case 'contarTudo':
        return this.contarTudo(rngEntrega);

      case 'estornar':
        return this.estornar(passo.alvo, passo.fracao);

      case 'trocarPlano':
        return this.trocarPlano(passo.alvo);

      case 'cancelar':
        return this.cancelar(passo.alvo, passo.imediato);
    }
  }

  private async cobrar(cenario: CenarioDoGateway, alvo: number): Promise<void> {
    const fatura = await this.prisma.invoice.findFirst({
      where: {
        organizationId: this.organizationId,
        subscriptionId: this.assinatura(alvo),
        status: { not: InvoiceStatus.PAID },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    if (fatura === null) {
      return;
    }

    this.gateway.setScenario(
      cenario.kind === 'timeoutSemEfeito'
        ? { kind: 'timeout' }
        : cenario.kind === 'timeout'
          ? { kind: 'timeout', desfechoReal: cenario.desfechoReal }
          : cenario.kind === 'decline'
            ? { kind: 'decline' }
            : { kind: 'succeed' },
    );

    try {
      await this.comRelogio(() => this.payments.chargeInvoice(this.organizationId, fatura.id));
    } catch {
      // Uma fatura sem meio de pagamento, ou já resolvida por uma notificação
      // que chegou antes, recusa a cobrança. Isso não é falha do sistema, é o
      // sistema dizendo não, e o roteiro segue.
    }

    // O gateway é compartilhado pelo processo, então a colheita é imediata: o
    // que ficou pendente ali é desta cobrança.
    const colhidas = this.gateway.drainNotifications();
    this.produzidas += colhidas.length;
    this.naoContados.push(...colhidas);
  }

  private async avancar(horas: number): Promise<void> {
    const estado = await this.clocks.advance(this.organizationId, horas * 60 * 60 * 1000);

    await this.scopes.run(
      { organizationId: this.organizationId, now: estado.now, virtual: true },
      () => this.cycle.runDue(this.organizationId),
    );

    this.naoContados.push(...this.gateway.drainNotifications());
  }

  /**
   * O provedor fala, do jeito mais inconveniente possível.
   *
   * Embaralhado e com repetição. É o comportamento de um provedor real com
   * retentativa, e é o que a deduplicação e a checagem de estado existem para
   * aguentar.
   *
   * O que ele **não** faz é segurar um desfecho para uma rodada futura, e a
   * ausência é a parte mais importante deste arquivo.
   *
   * A primeira versão segurava, e a suíte acusava divergência em cenários
   * corretos. O motivo tem valor próprio: uma execução que fica sem saber que a
   * cobrança deu certo deixa a recuperação seguir o calendário, a assinatura cai
   * para PAST_DUE, depois UNPAID, e o ciclo a encerra. A notificação chegando
   * depois encontra a fatura paga e a assinatura morta, e não há como
   * ressuscitá-la. Ou seja: **ação irreversível tomada na ignorância não
   * converge**, e nenhuma quantidade de idempotência conserta isso.
   *
   * Isso não é defeito do sistema, é consequência de decidir com informação
   * incompleta, que é o que ele tem de fazer. Mas quer dizer que a propriedade
   * afirmável é mais estreita do que "a ordem nunca importa": o que a suíte
   * afirma é que, **entregue o mesmo conjunto de desfechos nos mesmos pontos do
   * roteiro**, a ordem dentro de cada lote e a repetição não mudam nada. As duas
   * execuções sabem as mesmas coisas nos mesmos momentos, e só discordam sobre
   * a sequência. Ver ADR-0017.
   */
  private async contarDesfechos(rng: Rng): Promise<void> {
    if (this.naoContados.length === 0) {
      return;
    }

    const entregar: FakeNotification[] = [];

    for (const notificacao of this.naoContados) {
      entregar.push(notificacao);

      // Reentrega, que é o que um provedor faz quando não vê a nossa resposta.
      if (rng.talvez(0.35)) {
        entregar.push(notificacao);
      }
    }

    this.naoContados = [];

    const vistas = new Set<string>();

    for (const notificacao of rng.embaralhar(entregar)) {
      this.entregues += 1;
      if (vistas.has(notificacao.idempotencyKey)) {
        this.repetidas += 1;
      }
      vistas.add(notificacao.idempotencyKey);
      await this.entregar(notificacao, rng);
    }
  }

  /**
   * O provedor esvazia o que tinha para contar.
   *
   * Continua embaralhando e repetindo, que é a adversidade que interessa. O que
   * não faz mais é segurar: insiste até não sobrar nada. O limite de rodadas
   * existe para o teste falhar com mensagem em vez de travar, caso alguma
   * entrega passe a falhar sempre.
   */
  private async contarTudo(rng: Rng): Promise<void> {
    for (let rodada = 0; rodada < 20 && this.naoContados.length > 0; rodada += 1) {
      const pendentes = this.naoContados;
      this.naoContados = [];

      const entregar: FakeNotification[] = [];

      for (const notificacao of pendentes) {
        entregar.push(notificacao);

        if (rng.talvez(0.35)) {
          entregar.push(notificacao);
        }
      }

      const vistas = new Set<string>();

      for (const notificacao of rng.embaralhar(entregar)) {
        this.entregues += 1;
        if (vistas.has(notificacao.idempotencyKey)) {
          this.repetidas += 1;
        }
        vistas.add(notificacao.idempotencyKey);
        await this.entregar(notificacao, rng, true);
      }
    }

    if (this.naoContados.length > 0) {
      throw new Error(
        `O provedor não conseguiu contar ${this.naoContados.length} desfecho(s) em 20 rodadas.`,
      );
    }
  }

  private async entregar(notificacao: FakeNotification, rng: Rng, insistir = false): Promise<void> {
    const corpo =
      notificacao.outcome === 'succeeded'
        ? {
            // O id do evento é derivado do desfecho, e não sorteado: é o mesmo
            // evento sendo reentregue, e um id novo a cada entrega faria a
            // deduplicação por índice nunca disparar. Seria testar o caminho
            // fácil e chamá-lo de adversarial.
            id: `evt_${notificacao.idempotencyKey}_ok`,
            type: 'charge.succeeded',
            data: {
              idempotencyKey: notificacao.idempotencyKey,
              reference: notificacao.reference,
            },
          }
        : {
            id: `evt_${notificacao.idempotencyKey}_nok`,
            type: 'charge.failed',
            data: {
              idempotencyKey: notificacao.idempotencyKey,
              code: notificacao.code,
              message: notificacao.message,
              retriable: true,
            },
          };

    const assinado = signWebhook(corpo, SEGREDO, new Date());

    try {
      await this.inbound.receive('fake', assinado.body, assinado.header);
    } catch {
      // O provedor recebe erro e reentrega. Guardar de volta é exatamente isso,
      // e é o que impede uma falha transitória de sumir com um desfecho. Na
      // rodada final ele não desiste nunca, porque a convergência é afirmada
      // sobre a história inteira contada.
      if (insistir || rng.talvez(0.8)) {
        this.naoContados.push(notificacao);
      }
    }
  }

  private async estornar(alvo: number, fracao: number): Promise<void> {
    const pagamento = await this.prisma.payment.findFirst({
      where: {
        organizationId: this.organizationId,
        status: PaymentStatus.SUCCEEDED,
        invoice: { subscriptionId: this.assinatura(alvo) },
      },
      // Ordem total e estável. `createdAt` sozinho empata quando duas linhas
      // nascem no mesmo instante congelado, e o desempate viraria arbitrário.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (pagamento === null) {
      return;
    }

    const total = Money.fromMinor(pagamento.amountMinor, pagamento.currency);
    const parte =
      fracao === 1
        ? total
        : Money.fromMinor(
            (total.minor * BigInt(Math.round(fracao * 100))) / 100n,
            pagamento.currency,
          );

    if (parte.minor <= 0n) {
      return;
    }

    try {
      await this.comRelogio(() =>
        this.refunds.refund({
          organizationId: this.organizationId,
          paymentId: pagamento.id,
          amount: parte,
          reason: 'roteiro adversarial',
        }),
      );
    } catch {
      // Estorno acima do que resta é recusado, e recusar é o comportamento
      // correto. O roteiro não sabe quanto já foi estornado antes.
    }
  }

  private async trocarPlano(alvo: number): Promise<void> {
    try {
      await this.comRelogio(() =>
        this.subscriptions.changePlan({
          organizationId: this.organizationId,
          subscriptionId: this.assinatura(alvo),
          priceId: this.precoAlternativoId,
        }),
      );
    } catch {
      // Trocar plano de assinatura cancelada é recusado pela máquina de
      // estados, que é o ponto dela.
    }
  }

  private async cancelar(alvo: number, imediato: boolean): Promise<void> {
    try {
      await this.comRelogio(() =>
        this.subscriptions.cancel({
          organizationId: this.organizationId,
          subscriptionId: this.assinatura(alvo),
          immediate: imediato,
        }),
      );
    } catch {
      // Cancelar o que já está cancelado é recusado, e deve ser.
    }
  }

  private async projetar(): Promise<Projecao> {
    const [assinaturas, faturas, pagamentos, estornos, saldos, verificacao] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { organizationId: this.organizationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        where: { organizationId: this.organizationId },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { organizationId: this.organizationId, status: PaymentStatus.SUCCEEDED },
        _sum: { amountMinor: true },
      }),
      this.prisma.refund.aggregate({
        where: { organizationId: this.organizationId, status: 'SUCCEEDED' },
        _sum: { amountMinor: true },
      }),
      this.ledger.balances(this.organizationId),
      this.ledger.verify(this.organizationId),
    ]);

    const faturasPorStatus: Record<string, number> = {};

    for (const linha of faturas) {
      faturasPorStatus[linha.status] = linha._count._all;
    }

    const contas: Record<string, string> = {};

    for (const saldo of saldos) {
      contas[saldo.code] = saldo.balance.minor.toString();
    }

    return {
      // As duas, na ordem em que foram criadas. Projetar só a primeira
      // esconderia metade do cenário.
      assinatura: assinaturas
        .slice()
        .sort((a, b) => this.assinaturas.indexOf(a.id) - this.assinaturas.indexOf(b.id))
        .map((linha) => linha.status)
        .join(','),
      faturasPorStatus,
      totalPagoMinor: (pagamentos._sum.amountMinor ?? 0n).toString(),
      totalEstornadoMinor: (estornos._sum.amountMinor ?? 0n).toString(),
      saldos: contas,
      razaoFecha: verificacao.balanced,
    };
  }

  /** A assinatura que o passo mira. Identidade, e não posição numa lista viva. */
  private assinatura(alvo: number): string {
    return this.assinaturas[alvo % this.assinaturas.length] as string;
  }

  private comRelogio<T>(fn: () => Promise<T>): Promise<T> {
    return this.clocks.runFor(this.organizationId, fn);
  }
}

export function descrever(passo: Passo): string {
  switch (passo.kind) {
    case 'cobrar':
      return `cobrar(${passo.gateway.kind}, assinatura ${passo.alvo % 2})`;
    case 'avancar':
      return `avancar(${passo.horas}h)`;
    case 'contarDesfechos':
      return 'contarDesfechos';
    case 'contarTudo':
      return 'contarTudo';
    case 'estornar':
      return `estornar(assinatura ${passo.alvo % 2}, ${passo.fracao})`;
    case 'trocarPlano':
      return `trocarPlano(assinatura ${passo.alvo % 2})`;
    case 'cancelar':
      return `cancelar(assinatura ${passo.alvo % 2}, ${passo.imediato ? 'imediato' : 'fim do ciclo'})`;
  }
}

export const descreverRoteiro = (roteiro: readonly Passo[]): string =>
  roteiro.map(descrever).join(' -> ');
