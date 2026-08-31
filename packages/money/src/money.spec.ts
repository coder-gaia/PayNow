import {
  AllocationError,
  CurrencyMismatchError,
  InvalidAmountError,
  UnknownCurrencyError,
} from './errors';
import { Money, type MoneyJSON } from './money';

const brl = (decimal: string): Money => Money.fromDecimal(decimal, 'BRL');

describe('Money', () => {
  describe('construcao', () => {
    it('cria a partir de unidade minima', () => {
      expect(Money.fromMinor(10_000, 'BRL').toDecimalString()).toBe('100.00');
      expect(Money.fromMinor(10_000n, 'BRL').minor).toBe(10_000n);
    });

    it('cria a partir de string decimal sem passar por ponto flutuante', () => {
      expect(brl('100.00').minor).toBe(10_000n);
      expect(brl('100').minor).toBe(10_000n);
      expect(brl('100.5').minor).toBe(10_050n);
      expect(brl('-4.50').minor).toBe(-450n);
      expect(brl('0.01').minor).toBe(1n);
      expect(brl(' 12.34 ').minor).toBe(1234n);
    });

    it('respeita o expoente da moeda', () => {
      expect(Money.fromDecimal('1000', 'JPY').minor).toBe(1000n);
      expect(Money.fromDecimal('1000', 'JPY').toDecimalString()).toBe('1000');
    });

    it('recusa mais casas decimais do que a moeda admite', () => {
      expect(() => brl('1.234')).toThrow(InvalidAmountError);
      expect(() => Money.fromDecimal('1.5', 'JPY')).toThrow(InvalidAmountError);
    });

    it('recusa formato invalido', () => {
      for (const invalid of ['', 'abc', '1,50', '1.2.3', '--1', '1e3', 'R$ 10']) {
        expect(() => brl(invalid)).toThrow(InvalidAmountError);
      }
    });

    it('recusa valor fracionario em unidade minima', () => {
      expect(() => Money.fromMinor(10.5, 'BRL')).toThrow(InvalidAmountError);
    });

    it('recusa moeda desconhecida', () => {
      expect(() => Money.zero('XYZ')).toThrow(UnknownCurrencyError);
    });

    it('normaliza o codigo da moeda', () => {
      expect(Money.zero('brl').currencyCode).toBe('BRL');
    });
  });

  describe('aritmetica', () => {
    it('soma e subtrai', () => {
      expect(brl('10.00').plus(brl('5.50')).toDecimalString()).toBe('15.50');
      expect(brl('10.00').minus(brl('15.50')).toDecimalString()).toBe('-5.50');
    });

    it('nega e tira valor absoluto', () => {
      expect(brl('-7.25').negated().toDecimalString()).toBe('7.25');
      expect(brl('-7.25').abs().toDecimalString()).toBe('7.25');
      expect(brl('7.25').abs().toDecimalString()).toBe('7.25');
    });

    it('multiplica por inteiro de forma exata', () => {
      expect(brl('19.99').times(3).toDecimalString()).toBe('59.97');
      expect(brl('19.99').times(0).isZero()).toBe(true);
    });

    it('recusa fator fracionario', () => {
      expect(() => brl('10.00').times(1.5)).toThrow(InvalidAmountError);
    });

    it('nunca opera entre moedas diferentes', () => {
      const real = brl('10.00');
      const dolar = Money.fromDecimal('10.00', 'USD');

      expect(() => real.plus(dolar)).toThrow(CurrencyMismatchError);
      expect(() => real.minus(dolar)).toThrow(CurrencyMismatchError);
      expect(() => real.compare(dolar)).toThrow(CurrencyMismatchError);
      expect(real.equals(dolar)).toBe(false);
    });

    it('soma listas', () => {
      expect(Money.sum([brl('1.00'), brl('2.00'), brl('3.50')]).toDecimalString()).toBe('6.50');
      expect(Money.sum([], 'BRL').isZero()).toBe(true);
      expect(() => Money.sum([])).toThrow(AllocationError);
    });
  });

  describe('percentual e razao', () => {
    it('aplica pontos base', () => {
      // taxa de plataforma de 3% sobre R$ 100,00, conforme docs/plano-de-contas.md
      expect(brl('100.00').percentage(300).toDecimalString()).toBe('3.00');
      expect(brl('100.00').percentage(25).toDecimalString()).toBe('0.25');
    });

    it('arredonda uma unica vez, no fim', () => {
      // 1/3 de R$ 0,10 arredondado por half-even
      expect(brl('0.10').multiplyRatio(1, 3).minor).toBe(3n);
      expect(brl('0.10').multiplyRatio(2, 3).minor).toBe(7n);
    });

    // Estes sao os casos de referencia de rateio do plano do projeto.
    // Ciclo de 30 dias, Pro R$ 100,00, Enterprise R$ 300,00.
    describe('casos de referencia de rateio proporcional', () => {
      const pro = brl('100.00');
      const enterprise = brl('300.00');

      it.each([
        [1, '96.67', '290.00', '193.33'],
        [15, '50.00', '150.00', '100.00'],
        [30, '0.00', '0.00', '0.00'],
      ])(
        'upgrade no dia %s credita %s, cobra %s e resulta em %s',
        (day, expectedCredit, expectedCharge, expectedNet) => {
          const remainingDays = 30 - Number(day);
          const credit = pro.multiplyRatio(remainingDays, 30);
          const charge = enterprise.multiplyRatio(remainingDays, 30);

          expect(credit.toDecimalString()).toBe(expectedCredit);
          expect(charge.toDecimalString()).toBe(expectedCharge);
          expect(charge.minus(credit).toDecimalString()).toBe(expectedNet);
        },
      );

      it('downgrade no meio do ciclo gera valor liquido negativo', () => {
        const credit = enterprise.multiplyRatio(15, 30);
        const charge = pro.multiplyRatio(15, 30);

        expect(charge.minus(credit).toDecimalString()).toBe('-100.00');
      });
    });
  });

  describe('distribuicao', () => {
    it('divide preservando o total', () => {
      const parts = brl('100.00').split(3);

      expect(parts.map((part) => part.toDecimalString())).toEqual(['33.34', '33.33', '33.33']);
      expect(Money.sum(parts).equals(brl('100.00'))).toBe(true);
    });

    it('distribui por pesos', () => {
      const parts = brl('100.00').allocate([70, 30]);

      expect(parts.map((part) => part.toDecimalString())).toEqual(['70.00', '30.00']);
    });

    it('nunca entrega sobra para peso zero', () => {
      // 11 centavos entre dois pesos positivos: a sobra de 1 vai para o primeiro
      // deles, e as posicoes com peso zero permanecem zeradas.
      const parts = brl('0.11').allocate([1, 0, 1, 0]);

      expect(parts.map((part) => part.toDecimalString())).toEqual(['0.06', '0.00', '0.05', '0.00']);
      expect(Money.sum(parts).toDecimalString()).toBe('0.11');
    });

    // Contraexemplo encontrado por teste de propriedade. A distribuicao por
    // ordem de indice dava [0.03, 0.01, 0, 0]: a primeira parte, cuja fracao
    // exata ja era exatamente 0.02, recebia sobra enquanto outras com fracao
    // pendente ficavam a menos. O metodo do maior resto corrige isso.
    it('nao entrega sobra a uma parte cuja fracao exata ja e inteira', () => {
      const parts = brl('0.04').allocate([3, 1, 1, 1]);

      expect(parts.map((part) => part.toDecimalString())).toEqual(['0.02', '0.01', '0.01', '0.00']);
      expect(Money.sum(parts).toDecimalString()).toBe('0.04');
    });

    it('resolve empate de fracao pelo menor indice, de forma reproduzivel', () => {
      const primeira = brl('1.00').allocate([1, 1, 1]);
      const segunda = brl('1.00').allocate([1, 1, 1]);

      expect(primeira.map((part) => part.minor)).toEqual([34n, 33n, 33n]);
      expect(segunda.map((part) => part.minor)).toEqual(primeira.map((part) => part.minor));
    });

    it('preserva o total tambem com valor negativo', () => {
      const parts = brl('-100.00').split(3);

      expect(parts.map((part) => part.toDecimalString())).toEqual(['-33.34', '-33.33', '-33.33']);
      expect(Money.sum(parts).toDecimalString()).toBe('-100.00');
    });

    it('recusa entradas invalidas', () => {
      expect(() => brl('10.00').allocate([])).toThrow(AllocationError);
      expect(() => brl('10.00').allocate([0, 0])).toThrow(AllocationError);
      expect(() => brl('10.00').allocate([-1, 2])).toThrow(AllocationError);
      expect(() => brl('10.00').split(0)).toThrow(AllocationError);
      expect(() => brl('10.00').split(2.5)).toThrow(AllocationError);
    });
  });

  describe('comparacao', () => {
    it('ordena', () => {
      expect(brl('10.00').greaterThan(brl('9.99'))).toBe(true);
      expect(brl('10.00').lessThan(brl('10.01'))).toBe(true);
      expect(brl('10.00').greaterThanOrEqual(brl('10.00'))).toBe(true);
      expect(brl('10.00').lessThanOrEqual(brl('10.00'))).toBe(true);
      expect(brl('10.00').compare(brl('10.00'))).toBe(0);
    });

    it('classifica o sinal', () => {
      expect(brl('0.00').isZero()).toBe(true);
      expect(brl('0.01').isPositive()).toBe(true);
      expect(brl('-0.01').isNegative()).toBe(true);
    });
  });

  describe('representacao', () => {
    it('formata o decimal', () => {
      expect(brl('0.05').toDecimalString()).toBe('0.05');
      expect(brl('-0.05').toDecimalString()).toBe('-0.05');
      expect(Money.fromMinor(0, 'BRL').toDecimalString()).toBe('0.00');
      expect(brl('1234.50').toString()).toBe('R$ 1234.50');
    });

    it('serializa e desserializa sem perda', () => {
      const original = brl('-1234.56');
      const roundTrip = Money.fromJSON(JSON.parse(JSON.stringify(original)) as MoneyJSON);

      expect(roundTrip.equals(original)).toBe(true);
      expect(original.toJSON()).toEqual({ amount: '-123456', currency: 'BRL' });
    });
  });

  it('e imutavel', () => {
    const original = brl('10.00');
    original.plus(brl('5.00'));

    expect(original.toDecimalString()).toBe('10.00');
    expect(Object.isFrozen(original)).toBe(true);
  });
});
