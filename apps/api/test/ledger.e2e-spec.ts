import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Money } from '@paynow/money';
import fc from 'fast-check';

import { ACCOUNT } from '../src/modules/ledger/domain/chart-of-accounts';
import { LedgerService } from '../src/modules/ledger/application/ledger.service';
import { PrismaService } from '../src/modules/platform/prisma/prisma.service';
import { createTestApp } from './support/app';

/**
 * O ledger contra o banco de verdade.
 *
 * Verificar partidas dobradas com um dublê de banco nao afirmaria nada: o que
 * garante os invariantes e a constraint diferida, o trigger de append-only e o
 * indice unico sobre o evento de origem, e nenhum deles existe fora do
 * PostgreSQL. Estes testes exercitam exatamente essas garantias.
 */
describe('Ledger (e2e)', () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let prisma: PrismaService;
  let organizationId: string;

  const brl = (decimal: string): Money => Money.fromDecimal(decimal, 'BRL');

  /** Evento unico por chamada, para que cada lancamento seja de fato novo. */
  const event = (type = 'teste') => ({ type, id: randomUUID() });

  beforeAll(async () => {
    app = await createTestApp();
    ledger = app.get(LedgerService);
    prisma = app.get(PrismaService);

    const organization = await prisma.organization.create({
      data: { name: 'Razao de Teste', slug: `razao-${randomUUID().slice(0, 8)}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('post', () => {
    it('registra um lancamento balanceado e devolve as linhas', async () => {
      const entry = await ledger.post({
        organizationId,
        event: event('invoice.issued'),
        description: 'Fatura de R$ 100,00',
        lines: [
          { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: brl('100.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-100.00') },
        ],
      });

      expect(entry.id).toEqual(expect.any(String));
      expect(entry.lines).toHaveLength(2);
    });

    it('cria as contas sob demanda, sem provisionamento previo', async () => {
      const isolada = await prisma.organization.create({
        data: { name: 'Sem contas', slug: `sem-contas-${randomUUID().slice(0, 8)}` },
      });

      const antes = await prisma.account.count({ where: { organizationId: isolada.id } });
      expect(antes).toBe(0);

      await ledger.post({
        organizationId: isolada.id,
        event: event(),
        description: 'Primeiro lancamento',
        lines: [
          { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('10.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-10.00') },
        ],
      });

      expect(await prisma.account.count({ where: { organizationId: isolada.id } })).toBe(2);
    });

    it('recusa lancamento desbalanceado antes de tocar no banco', async () => {
      await expect(
        ledger.post({
          organizationId,
          event: event(),
          description: 'Desbalanceado',
          lines: [
            { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: brl('100.00') },
            { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-99.00') },
          ],
        }),
      ).rejects.toThrow(/Sobrou/);
    });

    it('recusa linha com valor zero', async () => {
      await expect(
        ledger.post({
          organizationId,
          event: event(),
          description: 'Linha vazia',
          lines: [
            { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: brl('0.00') },
            { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('0.00') },
          ],
        }),
      ).rejects.toThrow(/valor zero/);
    });

    /** Idempotencia contabil: o mesmo evento nao vira dois lancamentos. */
    it('recusa o mesmo evento de dominio duas vezes', async () => {
      const mesmo = event('payment.succeeded');
      const lines = [
        { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('50.00') },
        { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: brl('-50.00') },
      ];

      await ledger.post({ organizationId, event: mesmo, description: 'Primeira', lines });

      await expect(
        ledger.post({ organizationId, event: mesmo, description: 'Repetida', lines }),
      ).rejects.toThrow(/ja foi lancado/);
    });

    it('o mesmo evento em organizacoes diferentes e permitido', async () => {
      const outra = await prisma.organization.create({
        data: { name: 'Outra', slug: `outra-${randomUUID().slice(0, 8)}` },
      });
      const mesmo = event('webhook.received');
      const lines = [
        { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('7.00') },
        { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-7.00') },
      ];

      await ledger.post({ organizationId, event: mesmo, description: 'Aqui', lines });

      await expect(
        ledger.post({ organizationId: outra.id, event: mesmo, description: 'La', lines }),
      ).resolves.toBeDefined();
    });
  });

  describe('garantias do banco', () => {
    /**
     * A validacao da aplicacao pode ser contornada. A do banco nao: estes dois
     * testes escrevem SQL cru para provar que o invariante vale mesmo quando
     * alguem escreve por fora do servico.
     */
    it('a constraint diferida recusa lancamento desbalanceado escrito em SQL cru', async () => {
      const account = await prisma.account.findFirstOrThrow({
        where: { organizationId, code: ACCOUNT.CUSTOMER_RECEIVABLE },
      });
      const outra = await prisma.account.findFirstOrThrow({
        where: { organizationId, code: ACCOUNT.MERCHANT_REVENUE },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          const entry = await tx.journalEntry.create({
            data: {
              organizationId,
              eventType: 'sql-cru',
              eventId: randomUUID(),
              description: 'Escrito por fora do servico',
              occurredAt: new Date(),
            },
          });

          await tx.journalLine.createMany({
            data: [
              { entryId: entry.id, accountId: account.id, amountMinor: 100n, currency: 'BRL' },
              { entryId: entry.id, accountId: outra.id, amountMinor: -90n, currency: 'BRL' },
            ],
          });
        }),
      ).rejects.toThrow(/nao soma zero/);
    });

    it('o trigger recusa UPDATE em linha do razao', async () => {
      const entry = await ledger.post({
        organizationId,
        event: event(),
        description: 'Para tentar alterar',
        lines: [
          { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('5.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-5.00') },
        ],
      });

      await expect(
        prisma.$executeRaw`UPDATE journal_lines SET amount_minor = 1 WHERE entry_id = ${entry.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('o trigger recusa DELETE de lancamento', async () => {
      const entry = await ledger.post({
        organizationId,
        event: event(),
        description: 'Para tentar apagar',
        lines: [
          { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('5.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-5.00') },
        ],
      });

      await expect(
        prisma.$executeRaw`DELETE FROM journal_entries WHERE id = ${entry.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('saldos', () => {
    it('devolve o plano de contas inteiro, com as contas zeradas', async () => {
      const nova = await prisma.organization.create({
        data: { name: 'Zerada', slug: `zerada-${randomUUID().slice(0, 8)}` },
      });

      const balances = await ledger.balances(nova.id);

      expect(balances).toHaveLength(6);
      expect(balances.every((account) => account.balance.isZero())).toBe(true);
    });

    it('deriva o saldo das linhas', async () => {
      const isolada = await prisma.organization.create({
        data: { name: 'Saldos', slug: `saldos-${randomUUID().slice(0, 8)}` },
      });

      await ledger.post({
        organizationId: isolada.id,
        event: event('invoice.issued'),
        description: 'Fatura',
        lines: [
          { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: brl('100.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('-100.00') },
        ],
      });

      await ledger.post({
        organizationId: isolada.id,
        event: event('payment.succeeded'),
        description: 'Pagamento com taxa de 3%',
        lines: [
          { account: ACCOUNT.GATEWAY_CLEARING, amount: brl('100.00') },
          { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: brl('-100.00') },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: brl('3.00') },
          { account: ACCOUNT.PLATFORM_FEE, amount: brl('-3.00') },
        ],
      });

      const porCodigo = new Map(
        (await ledger.balances(isolada.id)).map((account) => [account.code, account]),
      );

      expect(porCodigo.get(ACCOUNT.CUSTOMER_RECEIVABLE)?.balance.toDecimalString()).toBe('0.00');
      expect(porCodigo.get(ACCOUNT.GATEWAY_CLEARING)?.balance.toDecimalString()).toBe('100.00');
      expect(porCodigo.get(ACCOUNT.MERCHANT_REVENUE)?.balance.toDecimalString()).toBe('-97.00');
      expect(porCodigo.get(ACCOUNT.PLATFORM_FEE)?.balance.toDecimalString()).toBe('-3.00');
    });
  });

  describe('verificacao', () => {
    it('afirma que o razao esta integro', async () => {
      const report = await ledger.verify(organizationId);

      expect(report.balanced).toBe(true);
      expect(report.violations).toHaveLength(0);
      expect(report.entryCount).toBeGreaterThan(0);
    });

    /**
     * Property test contra o banco real.
     *
     * Gera sequencias aleatorias de lancamentos balanceados e afirma, depois de
     * cada sequencia, que o razao continua integro e que a soma global e zero.
     * O numero de execucoes e modesto de proposito: cada uma abre transacoes de
     * verdade, e a suite precisa caber no tempo de um pull request. A fase 07
     * roda esta mesma ideia em escala, no harness adversarial.
     */
    it('permanece integro sob sequencias aleatorias de lancamentos', async () => {
      const isolada = await prisma.organization.create({
        data: { name: 'Propriedade', slug: `prop-${randomUUID().slice(0, 8)}` },
      });

      const contas = [
        ACCOUNT.CUSTOMER_RECEIVABLE,
        ACCOUNT.GATEWAY_CLEARING,
        ACCOUNT.MERCHANT_REVENUE,
        ACCOUNT.PLATFORM_FEE,
        ACCOUNT.CUSTOMER_CREDIT,
        ACCOUNT.MERCHANT_REFUNDS,
      ] as const;

      const movimento = fc.record({
        origem: fc.integer({ min: 0, max: contas.length - 1 }),
        destino: fc.integer({ min: 0, max: contas.length - 1 }),
        centavos: fc.integer({ min: 1, max: 5_000_000 }),
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(movimento, { minLength: 1, maxLength: 6 }),
          async (movimentos) => {
            for (const { origem, destino, centavos } of movimentos) {
              if (origem === destino) {
                continue;
              }

              const valor = Money.fromMinor(centavos, 'BRL');

              await ledger.post({
                organizationId: isolada.id,
                event: event('propriedade'),
                description: `Movimento de ${valor.toString()}`,
                lines: [
                  { account: contas[origem]!, amount: valor },
                  { account: contas[destino]!, amount: valor.negated() },
                ],
              });
            }

            const report = await ledger.verify(isolada.id);
            expect(report.violations).toEqual([]);
            expect(report.balanced).toBe(true);
          },
        ),
        { numRuns: 12 },
      );

      // E o saldo derivado tambem tem de somar zero no fim de tudo.
      const balances = await ledger.balances(isolada.id);
      const total = balances.reduce((soma, conta) => soma.plus(conta.balance), Money.zero('BRL'));

      expect(total.isZero()).toBe(true);
    });
  });
});
