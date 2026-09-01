import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, type Prisma } from '@prisma/client';
import { Money } from '@paynow/money';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { addDays } from '../../platform/clock/duration';
import { DomainEventPublisher } from '../../platform/events/domain-event-publisher';
import { EVENT } from '../../platform/events/domain-event';
import { PrismaService } from '../../platform/prisma/prisma.service';

/**
 * Namespace de advisory lock para a numeração de faturas.
 *
 * Diferente do namespace das assinaturas de propósito: este lock é por
 * organização, e o outro é por assinatura. Compartilhar o namespace faria
 * duas coisas sem relação disputarem a mesma chave.
 */
const NUMBERING_LOCK_NAMESPACE = 0x696e766e; // "invn"

/** Prazo padrão para pagar. Vencida, a fatura entra na recuperação. */
const DEFAULT_DUE_DAYS = 3;

export interface IssueInvoiceInput {
  readonly organizationId: string;
  readonly customerId: string;
  readonly subscriptionId?: string;
  readonly amount: Money;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly description: string;
  /**
   * Chave do evento que originou a fatura.
   *
   * Derivada do fato de domínio, nunca aleatória. É ela que impede o ciclo de
   * cobrança, rodado duas vezes sobre o mesmo período, de emitir duas faturas.
   */
  readonly eventKey: string;
}

/**
 * Emissão e leitura de faturas.
 *
 * A fatura é o que dá objeto ao pagamento. Antes dela, o razão registrava um
 * valor a receber que não pertencia a nada: dava para ver que o cliente devia,
 * mas não o que ele devia nem desde quando, e a recuperação não teria onde
 * contar tentativas.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Emite uma fatura e publica o fato.
   *
   * Recebe a transação de quem chamou, e não abre a sua. Quem emite fatura está
   * sempre no meio de outra coisa, normalmente o ciclo de cobrança, e a fatura
   * tem de viver ou morrer junto com essa outra coisa.
   */
  async issue(tx: Prisma.TransactionClient, input: IssueInvoiceInput) {
    const agora = this.clock.now();
    const number = await this.nextNumber(tx, input.organizationId);

    const invoice = await tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        customerId: input.customerId,
        ...(input.subscriptionId === undefined ? {} : { subscriptionId: input.subscriptionId }),
        number,
        status: InvoiceStatus.OPEN,
        amountMinor: input.amount.minor,
        currency: input.amount.currencyCode,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        dueAt: addDays(agora, DEFAULT_DUE_DAYS),
      },
    });

    await this.events.publish(
      {
        type: EVENT.INVOICE_ISSUED,
        id: input.eventKey,
        organizationId: input.organizationId,
        occurredAt: agora,
        payload: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          customerId: input.customerId,
          ...(input.subscriptionId === undefined ? {} : { subscriptionId: input.subscriptionId }),
          description: input.description,
          amount: {
            amountMinor: input.amount.minor.toString(),
            currency: input.amount.currencyCode,
          },
          periodStart: input.periodStart.toISOString(),
          periodEnd: input.periodEnd.toISOString(),
          dueAt: invoice.dueAt.toISOString(),
        },
      },
      tx,
    );

    return invoice;
  }

  async list(organizationId: string, status?: InvoiceStatus) {
    return this.prisma.invoice.findMany({
      where: { organizationId, ...(status === undefined ? {} : { status }) },
      include: {
        customer: true,
        payments: { orderBy: { attempt: 'asc' } },
      },
      orderBy: { number: 'desc' },
      take: 100,
    });
  }

  async findById(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: true,
        payments: { orderBy: { attempt: 'asc' } },
        subscription: { include: { price: { include: { product: true } } } },
      },
    });

    if (invoice === null) {
      throw new NotFoundException('Fatura não encontrada.');
    }

    return invoice;
  }

  /**
   * Próximo número da organização.
   *
   * Fatura precisa de um número curto que uma pessoa consiga citar por
   * telefone, e um UUID não serve para isso. O número é sequencial por
   * organização, o que exige serializar a atribuição: duas faturas emitidas ao
   * mesmo tempo leriam o mesmo máximo e tentariam gravar o mesmo número.
   *
   * O advisory lock resolve dentro da transação, e o índice único em
   * (organização, número) é a rede embaixo: se algum caminho futuro esquecer o
   * lock, o banco recusa em vez de duplicar em silêncio.
   */
  private async nextNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NUMBERING_LOCK_NAMESPACE}::int, hashtext(${organizationId})::int)`;

    const [row] = await tx.$queryRaw<{ proximo: number }[]>`
      SELECT COALESCE(MAX(number), 0) + 1 AS proximo
        FROM invoices
       WHERE organization_id = ${organizationId}::uuid
    `;

    return row?.proximo ?? 1;
  }
}
