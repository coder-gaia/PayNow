import type { EventType } from './domain-event';

/**
 * Uma mensagem esperando para sair da transação.
 *
 * O payload chega como JSON e não como o tipo do evento, porque ele passou pelo
 * banco. Quem consome faz a conversão, e é responsabilidade de quem consome
 * tolerar um payload gravado por uma versão anterior do código: a mensagem pode
 * ter ficado pendente enquanto o processo era atualizado.
 */
export interface OutboxMessage {
  readonly id: string;
  readonly organizationId: string;
  readonly eventType: EventType;
  readonly eventId: string;
  readonly payload: unknown;
  readonly occurredAt: Date;
  readonly attempts: number;
}

/**
 * Quem recebe eventos depois do commit.
 *
 * A diferença entre isto e o `DomainEventHandler` é a garantia, e ela é o
 * ponto inteiro da ADR-0006:
 *
 * - Um `DomainEventHandler` roda **dentro** da transação de quem publicou. Se
 *   ele falha, a transação inteira volta atrás. É o que o razão usa, e é a
 *   garantia mais forte: o lançamento contábil e a mudança que o originou
 *   vivem ou morrem juntos.
 *
 * - Um `OutboxConsumer` roda **depois** do commit, e pode ser tentado várias
 *   vezes. É o que serve para efeito que sai do processo: email, webhook,
 *   notificação. Nenhum deles pode segurar uma transação de banco, e nenhum
 *   deles pode desfazer uma cobrança que já aconteceu por ter falhado.
 *
 * A entrega é **pelo menos uma vez**. Quem consome precisa aguentar receber a
 * mesma mensagem duas vezes, e a chave do evento está ali para isso.
 */
export interface OutboxConsumer {
  readonly name: string;
  readonly handles: readonly EventType[];
  deliver(message: OutboxMessage): Promise<void>;
}
