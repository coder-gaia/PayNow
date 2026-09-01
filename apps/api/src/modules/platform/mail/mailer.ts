/**
 * Porta de envio de email.
 *
 * Mesma ideia da porta de gateway: o sistema não conhece um provedor, conhece
 * um contrato. Em desenvolvimento, quem a satisfaz é o Mailpit, que aceita tudo
 * e não entrega nada a ninguém de verdade, o que é exatamente o que se quer de
 * um ambiente onde os endereços são inventados.
 */
export interface Email {
  readonly to: string;
  readonly subject: string;
  /**
   * Corpo em texto puro.
   *
   * Só texto, e de propósito. Recibo de cobrança é informação, não peça
   * gráfica, e HTML em email é uma superfície de compatibilidade que não se
   * paga aqui. Quando houver marca a defender, a decisão se reabre.
   */
  readonly body: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export const MAILER = Symbol('Mailer');
