import { Inject, Injectable } from '@nestjs/common';
import { Money } from '@paynow/money';

import {
  EVENT,
  type EventType,
  type InvoiceIssuedPayload,
  type PaymentFailedPayload,
  type PaymentSucceededPayload,
} from '../../platform/events/domain-event';
import type { OutboxConsumer, OutboxMessage } from '../../platform/events/outbox';
import { MAILER, type Mailer } from '../../platform/mail/mailer';
import { PrismaService } from '../../platform/prisma/prisma.service';

/**
 * Avisos por email para o cliente que paga.
 *
 * Este é o consumidor que justifica o outbox existir. Enviar email é o exemplo
 * exato do problema que a ADR-0006 resolve: não pode acontecer se a transação
 * for desfeita, porque seria avisar sobre uma cobrança que não houve; não pode
 * segurar a transação, porque um servidor de email lento viraria banco
 * indisponível; e não pode se perder se o processo morrer depois do commit,
 * porque a cobrança aconteceu e o cliente precisa saber.
 *
 * Também é o consumidor que mostra por que a entrega é "pelo menos uma vez" e
 * não "exatamente uma vez": receber dois recibos do mesmo pagamento é
 * incômodo, e não receber nenhum é um cliente ligando para o suporte.
 */
@Injectable()
export class ReceiptMailer implements OutboxConsumer {
  readonly name = 'recibo-por-email';

  readonly handles: readonly EventType[] = [
    EVENT.INVOICE_ISSUED,
    EVENT.PAYMENT_SUCCEEDED,
    EVENT.PAYMENT_FAILED,
  ];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async deliver(message: OutboxMessage): Promise<void> {
    const email = await this.enderecoDoCliente(message);

    if (email === null) {
      // Cliente removido entre o fato e a entrega. Não é falha de entrega: não
      // há para quem entregar, e insistir só encheria a fila de erro que
      // ninguém pode consertar.
      return;
    }

    const conteudo = this.compor(message);

    if (conteudo === null) {
      return;
    }

    await this.mailer.send({ to: email, ...conteudo });
  }

  private compor(message: OutboxMessage): { subject: string; body: string } | null {
    switch (message.eventType) {
      case EVENT.INVOICE_ISSUED: {
        const payload = message.payload as InvoiceIssuedPayload;
        const valor = dinheiro(payload.amount.amountMinor, payload.amount.currency);

        return {
          subject: `Fatura ${payload.invoiceNumber} no valor de ${valor}`,
          body:
            `Sua fatura ${payload.invoiceNumber} foi emitida no valor de ${valor}.\n\n` +
            `${payload.description}\n\n` +
            `Vencimento: ${data(payload.dueAt)}.`,
        };
      }

      case EVENT.PAYMENT_SUCCEEDED: {
        const payload = message.payload as PaymentSucceededPayload;
        const valor = dinheiro(payload.amount.amountMinor, payload.amount.currency);

        return {
          subject: `Pagamento confirmado: fatura ${payload.invoiceNumber}`,
          body:
            `Recebemos o pagamento de ${valor} referente à fatura ` +
            `${payload.invoiceNumber}.\n\n` +
            `Identificador da cobrança: ${payload.gatewayRef}.\n\n` +
            'Obrigado.',
        };
      }

      case EVENT.PAYMENT_FAILED: {
        const payload = message.payload as PaymentFailedPayload;
        const valor = dinheiro(payload.amount.amountMinor, payload.amount.currency);

        // Recusa definitiva e recusa temporária pedem mensagens diferentes.
        // Dizer "vamos tentar de novo" para quem teve o cartão cancelado é
        // fazer a pessoa esperar por algo que não vai acontecer.
        return {
          subject: `Não conseguimos cobrar a fatura ${payload.invoiceNumber}`,
          body:
            `A cobrança de ${valor} referente à fatura ${payload.invoiceNumber} ` +
            'não foi autorizada.\n\n' +
            (payload.retriable
              ? 'Vamos tentar de novo automaticamente. Se preferir, atualize o meio de pagamento.'
              : 'Não vamos tentar de novo com este meio de pagamento. Cadastre outro para ' +
                'manter a assinatura.'),
        };
      }

      default:
        return null;
    }
  }

  /**
   * Para quem enviar.
   *
   * O endereço é lido agora, e não no momento do fato. Isso é o contrário da
   * decisão sobre nomes na descrição do lançamento, e de propósito: o
   * lançamento precisa dizer o que era verdade quando aconteceu, e o email
   * precisa chegar a quem é o cliente hoje. Documento histórico e endereço de
   * entrega são coisas diferentes.
   */
  private async enderecoDoCliente(message: OutboxMessage): Promise<string | null> {
    const payload = message.payload as { customerId?: string };

    if (typeof payload.customerId !== 'string') {
      return null;
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: payload.customerId, organizationId: message.organizationId },
      select: { email: true },
    });

    return customer?.email ?? null;
  }
}

const dinheiro = (amountMinor: string, currency: string): string =>
  `${Money.fromMinor(BigInt(amountMinor), currency).toDecimalString().replace('.', ',')} ${currency}`;

const data = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(
    new Date(iso),
  );
