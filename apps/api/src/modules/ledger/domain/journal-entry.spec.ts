import { Money } from '@paynow/money';

import { ACCOUNT } from './chart-of-accounts';
import { assertBalanced, creditTotals, debitTotals, type EntryLine } from './journal-entry';
import { EmptyEntryError, UnbalancedEntryError } from './ledger.errors';

const brl = (decimal: string): Money => Money.fromDecimal(decimal, 'BRL');
const usd = (decimal: string): Money => Money.fromDecimal(decimal, 'USD');

const line = (account: EntryLine['account'], amount: Money): EntryLine => ({ account, amount });

describe('assertBalanced', () => {
  it('aceita o lançamento de emissão de fatura do plano de contas', () => {
    expect(() =>
      assertBalanced({
        lines: [
          line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('100.00')),
          line(ACCOUNT.MERCHANT_REVENUE, brl('-100.00')),
        ],
      }),
    ).not.toThrow();
  });

  it('aceita o pagamento com taxa, que tem quatro pernas', () => {
    expect(() =>
      assertBalanced({
        lines: [
          line(ACCOUNT.GATEWAY_CLEARING, brl('100.00')),
          line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('-100.00')),
          line(ACCOUNT.MERCHANT_REVENUE, brl('3.00')),
          line(ACCOUNT.PLATFORM_FEE, brl('-3.00')),
        ],
      }),
    ).not.toThrow();
  });

  it('recusa lançamento que não fecha, dizendo quanto sobrou', () => {
    expect(() =>
      assertBalanced({
        lines: [
          line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('100.00')),
          line(ACCOUNT.MERCHANT_REVENUE, brl('-99.90')),
        ],
      }),
    ).toThrow(/Sobrou R\$ 0\.10/);
  });

  it('recusa lançamento com uma perna só', () => {
    expect(() =>
      assertBalanced({ lines: [line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('100.00'))] }),
    ).toThrow(EmptyEntryError);
  });

  it('recusa lançamento vazio', () => {
    expect(() => assertBalanced({ lines: [] })).toThrow(EmptyEntryError);
  });

  it('balanceia por moeda, e não no total', () => {
    // As duas moedas se anulam se somadas ingenuamente como números, mas cada
    // uma sozinha está desbalanceada. Somar tudo junto deixaria isso passar.
    expect(() =>
      assertBalanced({
        lines: [
          line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('100.00')),
          line(ACCOUNT.GATEWAY_CLEARING, usd('-100.00')),
        ],
      }),
    ).toThrow(UnbalancedEntryError);
  });

  it('aceita lançamento que fecha em cada moeda separadamente', () => {
    expect(() =>
      assertBalanced({
        lines: [
          line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('100.00')),
          line(ACCOUNT.MERCHANT_REVENUE, brl('-100.00')),
          line(ACCOUNT.GATEWAY_CLEARING, usd('50.00')),
          line(ACCOUNT.PLATFORM_FEE, usd('-50.00')),
        ],
      }),
    ).not.toThrow();
  });
});

describe('totais do lançamento', () => {
  const pagamento = {
    lines: [
      line(ACCOUNT.GATEWAY_CLEARING, brl('100.00')),
      line(ACCOUNT.CUSTOMER_RECEIVABLE, brl('-100.00')),
      line(ACCOUNT.MERCHANT_REVENUE, brl('3.00')),
      line(ACCOUNT.PLATFORM_FEE, brl('-3.00')),
    ],
  };

  it('soma os débitos', () => {
    expect(debitTotals(pagamento).get('BRL')?.toDecimalString()).toBe('103.00');
  });

  it('soma os créditos em valor absoluto', () => {
    expect(creditTotals(pagamento).get('BRL')?.toDecimalString()).toBe('103.00');
  });

  it('débitos e créditos batem, que é o que significa estar balanceado', () => {
    expect(debitTotals(pagamento).get('BRL')?.equals(creditTotals(pagamento).get('BRL')!)).toBe(
      true,
    );
  });
});
