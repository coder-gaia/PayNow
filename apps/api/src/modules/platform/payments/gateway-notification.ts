/**
 * O provedor contando, depois, o que aconteceu com uma cobrança.
 *
 * Esta porta existe por causa de um caso específico e incômodo: a chamada de
 * cobrança que morre sem resposta. O dinheiro pode ter saído, pode não ter, e
 * o sistema não tem como saber. A tentativa fica `PENDING`, e sem esta porta a
 * única saída seria alguém abrir o painel do provedor e conciliar à mão. Está
 * escrito assim, em tantas palavras, no log de `registrarIndefinido`.
 *
 * O webhook de entrada é o que fecha esse buraco. O provedor nos procura para
 * contar o desfecho, e o desfecho é aplicado sem ninguém precisar acordar.
 *
 * A porta vive em `platform` porque as fronteiras de módulo proíbem um domínio
 * importar outro, e isso aqui é acerto e não acidente: o módulo de webhooks
 * não deve saber o que é uma fatura, e o módulo de cobrança não deve saber o
 * que é uma requisição HTTP assinada. O que os dois compartilham é este
 * contrato, e só ele.
 */

/**
 * A cobrança é identificada pela chave de idempotência, e não por um id nosso.
 *
 * É a única coisa que o provedor sabe sobre nós: foi o que mandamos para ele.
 * Um id interno exigiria que ele o tivesse guardado, o que nem todo provedor
 * faz, e criaria dependência do nosso formato de identificador.
 */
export type GatewayNotification =
  | {
      readonly kind: 'charge.succeeded';
      readonly idempotencyKey: string;
      readonly reference: string;
    }
  | {
      readonly kind: 'charge.failed';
      readonly idempotencyKey: string;
      readonly code: string;
      readonly message: string;
      readonly retriable: boolean;
    };

/**
 * O que aconteceu ao aplicar.
 *
 * Os três casos são distintos de propósito, porque quem recebe o webhook
 * responde de forma diferente a cada um, e tratá-los como um só transformaria
 * "não conheço esta cobrança" em "deu tudo certo".
 *
 * - `aplicada`: mudou o estado do sistema.
 * - `ignorada`: entendida e sem efeito, porque a cobrança já tinha desfecho. É
 *   o caso comum de reentrega, e é sucesso.
 * - `desconhecida`: a cobrança não existe aqui. Pode ser evento de outro
 *   ambiente apontado para o endereço errado, e não deve virar erro barulhento.
 */
export type GatewayNotificationResult = 'aplicada' | 'ignorada' | 'desconhecida';

export interface GatewayNotificationHandler {
  readonly name: string;
  applyGatewayNotification(
    notification: GatewayNotification,
  ): Promise<{ result: GatewayNotificationResult; organizationId?: string; note: string }>;
}
