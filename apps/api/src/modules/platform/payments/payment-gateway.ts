/**
 * Porta de gateway de pagamento.
 *
 * O sistema não conhece nenhum provedor. Ele conhece esta interface, e a
 * escolha de quem a implementa é da raiz de composição. Ver ADR-0011.
 *
 * A porta vive em `platform` porque o contrato pertence aos dois lados: o
 * módulo de pagamentos a consome, e a implementação de infraestrutura a
 * satisfaz. Colocá-la dentro de pagamentos faria a implementação do Stripe
 * depender de um módulo de domínio para existir.
 *
 * O contrato é deliberadamente pequeno. Um gateway de verdade tem dezenas de
 * capacidades, e importar todas para dentro do domínio significaria que trocar
 * de provedor exigiria reescrever a porta. O que está aqui é o que o Paynow
 * precisa de fato: cobrar, estornar e reconhecer a própria cobrança de volta.
 */

/** Nunca guardamos dado de cartão. Ver ADR-0014: o escopo PCI é SAQ-A. */
export interface PaymentMethodRef {
  /** Identificador opaco emitido pelo provedor. Não é número de cartão. */
  readonly token: string;
  /** Bandeira e últimos quatro dígitos, só para exibição. */
  readonly brand?: string;
  readonly last4?: string;
}

export interface ChargeRequest {
  /**
   * Chave de idempotência da cobrança.
   *
   * Derivada da fatura e da tentativa, e não de um aleatório: se o request
   * morrer sem resposta e for repetido, o provedor precisa reconhecer que é a
   * mesma cobrança. Sem isso, timeout vira cobrança em dobro.
   */
  readonly idempotencyKey: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly method: PaymentMethodRef;
  readonly description: string;
}

export type ChargeOutcome =
  | { readonly status: 'succeeded'; readonly reference: string }
  /**
   * Recusa definitiva ou temporária.
   *
   * `retriable` é a informação que separa "o cartão não tem saldo hoje" de
   * "este cartão foi cancelado". Insistir no segundo caso queima a relação com
   * o cliente e ainda conta como tentativa fracassada para o adquirente.
   */
  | {
      readonly status: 'failed';
      readonly code: string;
      readonly message: string;
      readonly retriable: boolean;
    };

export interface RefundRequest {
  readonly idempotencyKey: string;
  readonly chargeReference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly reason: string;
}

export type RefundOutcome =
  | { readonly status: 'succeeded'; readonly reference: string }
  | { readonly status: 'failed'; readonly code: string; readonly message: string };

export interface PaymentGateway {
  readonly name: string;

  /**
   * Cobra o método de pagamento.
   *
   * Lançar significa "não sei o que aconteceu": rede caiu, tempo esgotou, o
   * provedor devolveu algo incompreensível. É diferente de devolver `failed`,
   * que significa "sei o que aconteceu e foi recusa". Quem chama trata os dois
   * de formas opostas: recusa é decisão do emissor, incerteza exige consultar
   * o provedor antes de tentar de novo.
   */
  charge(request: ChargeRequest): Promise<ChargeOutcome>;

  refund(request: RefundRequest): Promise<RefundOutcome>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

/**
 * A incerteza tem tipo próprio.
 *
 * Um erro genérico obrigaria quem chama a inspecionar mensagem para decidir o
 * que fazer, e mensagem de biblioteca muda sem aviso.
 */
export class GatewayUnavailableError extends Error {
  constructor(
    readonly gateway: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayUnavailableError';
  }
}
