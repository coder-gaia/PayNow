import { BillingInterval } from '@prisma/client';
import { Money } from '@paynow/money';
import fc from 'fast-check';

import { nextPeriodEnd, prorate } from './proration';

const brl = (decimal: string): Money => Money.fromDecimal(decimal, 'BRL');

/** Ciclo de 30 dias começando em 1 de junho, para casar com a tabela do plano. */
const INICIO = new Date('2026-06-01T00:00:00Z');
const FIM = new Date('2026-07-01T00:00:00Z');

/**
 * Instante depois de N dias decorridos do ciclo.
 *
 * A contagem é em dias decorridos, e não em "dia N do ciclo", porque a segunda
 * forma admite duas leituras: para uns o dia 1 é o primeiro dia, com nada
 * consumido, para outros é depois de um dia passar. A primeira versão desta
 * tabela usava a forma ambígua e errou por um dia.
 */
const decorridos = (dias: number): Date => new Date(INICIO.getTime() + dias * 86_400_000);

describe('prorate', () => {
  const pro = brl('100.00');
  const enterprise = brl('300.00');

  /**
   * Tabela de referência do plano do projeto, com os valores conferidos à mão
   * antes de existir código. Ciclo de 30 dias, Pro R$ 100,00, Enterprise
   * R$ 300,00.
   */
  describe('casos de referência do upgrade Pro para Enterprise', () => {
    it.each([
      [0, 30, '100.00', '300.00', '200.00'],
      [1, 29, '96.67', '290.00', '193.33'],
      [15, 15, '50.00', '150.00', '100.00'],
      [29, 1, '3.33', '10.00', '6.67'],
      [30, 0, '0.00', '0.00', '0.00'],
    ])(
      'com %s dia(s) decorridos restam %s: credita %s, cobra %s, líquido %s',
      (diasDecorridos, diasRestantes, credito, cobranca, liquido) => {
        const resultado = prorate({
          currentAmount: pro,
          nextAmount: enterprise,
          periodStart: INICIO,
          periodEnd: FIM,
          changedAt: decorridos(Number(diasDecorridos)),
        });

        expect(resultado.cycleDays).toBe(30);
        expect(resultado.remainingDays).toBe(Number(diasRestantes));
        expect(resultado.credit.toDecimalString()).toBe(credito);
        expect(resultado.charge.toDecimalString()).toBe(cobranca);
        expect(resultado.net.toDecimalString()).toBe(liquido);
      },
    );
  });

  it('no primeiro instante do ciclo credita e cobra o valor cheio', () => {
    const resultado = prorate({
      currentAmount: pro,
      nextAmount: enterprise,
      periodStart: INICIO,
      periodEnd: FIM,
      changedAt: INICIO,
    });

    expect(resultado.remainingDays).toBe(30);
    expect(resultado.credit.toDecimalString()).toBe('100.00');
    expect(resultado.charge.toDecimalString()).toBe('300.00');
    expect(resultado.net.toDecimalString()).toBe('200.00');
  });

  it('no último instante do ciclo não credita nem cobra nada', () => {
    const resultado = prorate({
      currentAmount: pro,
      nextAmount: enterprise,
      periodStart: INICIO,
      periodEnd: FIM,
      changedAt: FIM,
    });

    expect(resultado.remainingDays).toBe(0);
    expect(resultado.credit.isZero()).toBe(true);
    expect(resultado.charge.isZero()).toBe(true);
    expect(resultado.net.isZero()).toBe(true);
  });

  it('downgrade no meio do ciclo produz líquido negativo, que vira crédito', () => {
    const resultado = prorate({
      currentAmount: enterprise,
      nextAmount: pro,
      periodStart: INICIO,
      periodEnd: FIM,
      changedAt: decorridos(15),
    });

    expect(resultado.credit.toDecimalString()).toBe('150.00');
    expect(resultado.charge.toDecimalString()).toBe('50.00');
    expect(resultado.net.toDecimalString()).toBe('-100.00');
    expect(resultado.net.isNegative()).toBe(true);
  });

  it('troca para o mesmo preço não movimenta nada', () => {
    const resultado = prorate({
      currentAmount: pro,
      nextAmount: pro,
      periodStart: INICIO,
      periodEnd: FIM,
      changedAt: decorridos(10),
    });

    expect(resultado.net.isZero()).toBe(true);
  });

  it('troca antes do início do ciclo é tratada como início', () => {
    const resultado = prorate({
      currentAmount: pro,
      nextAmount: enterprise,
      periodStart: INICIO,
      periodEnd: FIM,
      changedAt: new Date('2026-05-20T00:00:00Z'),
    });

    expect(resultado.remainingDays).toBe(30);
  });

  it('troca depois do fim do ciclo é tratada como fim', () => {
    const resultado = prorate({
      currentAmount: pro,
      nextAmount: enterprise,
      periodStart: INICIO,
      periodEnd: FIM,
      changedAt: new Date('2026-08-20T00:00:00Z'),
    });

    expect(resultado.remainingDays).toBe(0);
  });

  describe('propriedades', () => {
    const valor = fc.integer({ min: 1, max: 10_000_000 });
    const diaDoCiclo = fc.integer({ min: 0, max: 30 });

    it('o líquido é sempre a cobrança menos o crédito', () => {
      fc.assert(
        fc.property(valor, valor, diaDoCiclo, (atual, proximo, offset) => {
          const resultado = prorate({
            currentAmount: Money.fromMinor(atual, 'BRL'),
            nextAmount: Money.fromMinor(proximo, 'BRL'),
            periodStart: INICIO,
            periodEnd: FIM,
            changedAt: new Date(INICIO.getTime() + offset * 86_400_000),
          });

          expect(resultado.net.equals(resultado.charge.minus(resultado.credit))).toBe(true);
        }),
      );
    });

    it('subir de plano nunca gera crédito, e descer nunca gera cobrança líquida', () => {
      fc.assert(
        fc.property(valor, valor, diaDoCiclo, (a, b, offset) => {
          const menor = Math.min(a, b);
          const maior = Math.max(a, b);
          const changedAt = new Date(INICIO.getTime() + offset * 86_400_000);

          const upgrade = prorate({
            currentAmount: Money.fromMinor(menor, 'BRL'),
            nextAmount: Money.fromMinor(maior, 'BRL'),
            periodStart: INICIO,
            periodEnd: FIM,
            changedAt,
          });
          const downgrade = prorate({
            currentAmount: Money.fromMinor(maior, 'BRL'),
            nextAmount: Money.fromMinor(menor, 'BRL'),
            periodStart: INICIO,
            periodEnd: FIM,
            changedAt,
          });

          expect(upgrade.net.isNegative()).toBe(false);
          expect(downgrade.net.isPositive()).toBe(false);
        }),
      );
    });

    it('quanto mais tarde a troca, menor o valor rateado', () => {
      fc.assert(
        fc.property(valor, fc.integer({ min: 0, max: 29 }), (montante, offset) => {
          const comum = {
            currentAmount: Money.fromMinor(montante, 'BRL'),
            nextAmount: Money.fromMinor(montante, 'BRL'),
            periodStart: INICIO,
            periodEnd: FIM,
          };

          const cedo = prorate({
            ...comum,
            changedAt: new Date(INICIO.getTime() + offset * 86_400_000),
          });
          const tarde = prorate({
            ...comum,
            changedAt: new Date(INICIO.getTime() + (offset + 1) * 86_400_000),
          });

          expect(tarde.charge.lessThanOrEqual(cedo.charge)).toBe(true);
        }),
      );
    });
  });
});

describe('nextPeriodEnd', () => {
  it('soma dias e semanas como duração corrida', () => {
    expect(nextPeriodEnd(INICIO, BillingInterval.DAY, 7).toISOString()).toBe(
      '2026-06-08T00:00:00.000Z',
    );
    expect(nextPeriodEnd(INICIO, BillingInterval.WEEK, 2).toISOString()).toBe(
      '2026-06-15T00:00:00.000Z',
    );
  });

  it('soma meses e anos pelo calendário', () => {
    expect(nextPeriodEnd(INICIO, BillingInterval.MONTH, 1).toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    expect(nextPeriodEnd(INICIO, BillingInterval.YEAR, 1).toISOString()).toBe(
      '2027-06-01T00:00:00.000Z',
    );
  });

  /**
   * Quem assina dia 31 espera ser cobrado no último dia do mês seguinte. A
   * aritmética ingênua de datas produziria 3 de março, que ninguém aceita.
   */
  it('gruda no último dia quando o mês de destino é mais curto', () => {
    const trintaEUm = new Date('2026-01-31T00:00:00Z');

    expect(nextPeriodEnd(trintaEUm, BillingInterval.MONTH, 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('respeita ano bissexto', () => {
    const trintaEUm = new Date('2028-01-31T00:00:00Z');

    expect(nextPeriodEnd(trintaEUm, BillingInterval.MONTH, 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('não perde o dia original ao atravessar um mês curto', () => {
    // Janeiro para março direto continua sendo dia 31, e não 28.
    const trintaEUm = new Date('2026-01-31T00:00:00Z');

    expect(nextPeriodEnd(trintaEUm, BillingInterval.MONTH, 2).toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
  });
});
