import {
  allowedTransitions,
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isActive,
  isFinal,
  SubscriptionStatus,
} from './subscription-state';

const { INCOMPLETE, TRIALING, ACTIVE, PAST_DUE, CANCELED, UNPAID } = SubscriptionStatus;

describe('máquina de estados da assinatura', () => {
  describe('caminho feliz', () => {
    it('vai de INCOMPLETE a ACTIVE, direto ou pelo trial', () => {
      expect(canTransition(INCOMPLETE, ACTIVE)).toBe(true);
      expect(canTransition(INCOMPLETE, TRIALING)).toBe(true);
      expect(canTransition(TRIALING, ACTIVE)).toBe(true);
    });
  });

  describe('recuperação', () => {
    it('cai em PAST_DUE quando a cobrança falha', () => {
      expect(canTransition(ACTIVE, PAST_DUE)).toBe(true);
      expect(canTransition(TRIALING, PAST_DUE)).toBe(true);
    });

    /** Voltar é tão importante quanto cair: é onde a receita é recuperada. */
    it('volta de PAST_DUE para ACTIVE quando a recuperação funciona', () => {
      expect(canTransition(PAST_DUE, ACTIVE)).toBe(true);
    });

    it('vai para UNPAID quando a recuperação se esgota', () => {
      expect(canTransition(PAST_DUE, UNPAID)).toBe(true);
    });
  });

  describe('transições proibidas', () => {
    it('não ressuscita assinatura cancelada', () => {
      for (const destino of [INCOMPLETE, TRIALING, ACTIVE, PAST_DUE, UNPAID]) {
        expect(canTransition(CANCELED, destino)).toBe(false);
      }
    });

    it('não pula de INCOMPLETE direto para PAST_DUE', () => {
      expect(canTransition(INCOMPLETE, PAST_DUE)).toBe(false);
    });

    it('não volta de ACTIVE para TRIALING', () => {
      expect(canTransition(ACTIVE, TRIALING)).toBe(false);
    });

    it('não volta de UNPAID para ACTIVE sem passar por uma assinatura nova', () => {
      expect(canTransition(UNPAID, ACTIVE)).toBe(false);
      expect(canTransition(UNPAID, CANCELED)).toBe(true);
    });

    it('nenhum estado transita para si mesmo', () => {
      for (const estado of [INCOMPLETE, TRIALING, ACTIVE, PAST_DUE, CANCELED, UNPAID]) {
        expect(canTransition(estado, estado)).toBe(false);
      }
    });
  });

  describe('assertTransition', () => {
    it('deixa passar transição válida', () => {
      expect(() => {
        assertTransition(ACTIVE, PAST_DUE);
      }).not.toThrow();
    });

    it('recusa transição inválida dizendo o que seria possível', () => {
      expect(() => {
        assertTransition(ACTIVE, TRIALING);
      }).toThrow(InvalidTransitionError);
      expect(() => {
        assertTransition(ACTIVE, TRIALING);
      }).toThrow(/PAST_DUE, CANCELED/);
    });

    it('avisa quando o estado de origem é final', () => {
      expect(() => {
        assertTransition(CANCELED, ACTIVE);
      }).toThrow(/estado final/);
    });
  });

  describe('acesso ao produto', () => {
    it('trial, ativa e em atraso dão acesso', () => {
      expect(isActive(TRIALING)).toBe(true);
      expect(isActive(ACTIVE)).toBe(true);
      // Cortar no primeiro dia de atraso transforma falha de cartão em
      // cancelamento, e é justamente o que a recuperação existe para evitar.
      expect(isActive(PAST_DUE)).toBe(true);
    });

    it('incompleta, cancelada e não paga não dão acesso', () => {
      expect(isActive(INCOMPLETE)).toBe(false);
      expect(isActive(CANCELED)).toBe(false);
      expect(isActive(UNPAID)).toBe(false);
    });
  });

  describe('estados finais', () => {
    it('apenas CANCELED é final', () => {
      expect(isFinal(CANCELED)).toBe(true);
      expect(isFinal(UNPAID)).toBe(false);
      expect(isFinal(ACTIVE)).toBe(false);
    });
  });

  it('expõe as transições possíveis para a interface', () => {
    expect(allowedTransitions(ACTIVE)).toEqual([PAST_DUE, CANCELED]);
    expect(allowedTransitions(CANCELED)).toEqual([]);
  });
});
