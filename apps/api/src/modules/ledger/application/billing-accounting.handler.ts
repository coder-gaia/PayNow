import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '@paynow/money';

import {
  type DomainEvent,
  type DomainEventHandler,
  EVENT,
  type EventType,
  type InvoiceIssuedPayload,
  type MoneyPayload,
  type PaymentSucceededPayload,
  type RefundIssuedPayload,
  type SubscriptionPlanChangedPayload,
} from '../../platform/events/domain-event';
import { ACCOUNT } from '../domain/chart-of-accounts';
import { LedgerService } from './ledger.service';

const toMoney = (payload: MoneyPayload): Money =>
  Money.fromMinor(BigInt(payload.amountMinor), payload.currency);

/**
 * Política contábil da cobrança.
 *
 * Aqui mora o conhecimento de como um fato de negócio vira lançamento. O
 * módulo de cobrança não sabe que existem contas, e o razão não sabe o que é
 * um ciclo: o evento é o contrato entre os dois, e a ADR-0001 é o motivo.
 *
 * A separação também é a certa por outro motivo, independente da regra de
 * fronteira. Política contábil muda por decisão de negócio, e não por mudança
 * de produto: se um dia a receita passar a ser reconhecida ao longo do ciclo
 * em vez de na emissão, o que muda é este arquivo, e nada em cobrança.
 *
 * Repare no que **não** está aqui. Recusa de cobrança não vira lançamento,
 * porque nada mudou de mão: o cliente continua devendo exatamente o que devia.
 * Lançar a recusa criaria movimento contábil para um não evento, e o balancete
 * passaria a contar tentativas em vez de dinheiro.
 */
@Injectable()
export class BillingAccountingHandler implements DomainEventHandler {
  readonly handles: readonly EventType[] = [
    EVENT.INVOICE_ISSUED,
    EVENT.SUBSCRIPTION_PLAN_CHANGED,
    EVENT.PAYMENT_SUCCEEDED,
    EVENT.REFUND_ISSUED,
  ];

  constructor(private readonly ledger: LedgerService) {}

  async handle(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    switch (event.type) {
      case EVENT.INVOICE_ISSUED:
        await this.emitirFatura(event, tx);
        return;

      case EVENT.SUBSCRIPTION_PLAN_CHANGED:
        await this.registrarRateio(event, tx);
        return;

      case EVENT.PAYMENT_SUCCEEDED:
        await this.registrarPagamento(event, tx);
        return;

      case EVENT.REFUND_ISSUED:
        await this.registrarEstorno(event, tx);
        return;

      default:
        return;
    }
  }

  /**
   * Emissão de fatura.
   *
   * O cliente passa a dever e a receita é reconhecida. Nada de dinheiro entrou
   * ainda: a entrada é registrada quando o pagamento confirmar.
   */
  private async emitirFatura(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    const payload = event.payload as InvoiceIssuedPayload;
    const amount = toMoney(payload.amount);

    await this.ledger.post(
      {
        organizationId: event.organizationId,
        event: { type: event.type, id: event.id },
        description: payload.description,
        occurredAt: event.occurredAt,
        lines: [
          { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: amount.negated() },
        ],
      },
      tx,
    );
  }

  /**
   * Pagamento confirmado.
   *
   * Quatro linhas, dois fatos. O dinheiro entrou no gateway e a dívida do
   * cliente foi quitada; e a plataforma reteve a sua parte, que sai da receita
   * do merchant. Somar a taxa antes de lançar perderia justamente a informação
   * que o merchant quer: quanto vai sobrar para ele.
   *
   * O que entra em `gateway:clearing` é o valor cheio, e não o líquido. O
   * dinheiro está todo lá até a liquidação; a taxa é uma obrigação entre as
   * partes, não uma quantia que deixou de existir.
   */
  private async registrarPagamento(
    event: DomainEvent,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const payload = event.payload as PaymentSucceededPayload;
    const amount = toMoney(payload.amount);
    const fee = toMoney(payload.platformFee);

    await this.ledger.post(
      {
        organizationId: event.organizationId,
        event: { type: event.type, id: event.id },
        description:
          `Pagamento da fatura ${payload.invoiceNumber} de ${payload.customerName}` +
          (payload.attempt > 1 ? `, na ${payload.attempt}ª tentativa` : ''),
        occurredAt: event.occurredAt,
        lines: [
          { account: ACCOUNT.GATEWAY_CLEARING, amount },
          { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: amount.negated() },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: fee },
          { account: ACCOUNT.PLATFORM_FEE, amount: fee.negated() },
        ].filter((line) => !line.amount.isZero()),
      },
      tx,
    );
  }

  /**
   * Estorno concedido.
   *
   * Duas linhas: o dinheiro sai da conta de liquidação, e a devolução entra em
   * uma conta redutora de receita em vez de subtrair da receita direta. A
   * diferença importa na hora de responder quanto o merchant faturou no mês:
   * receita bruta e devoluções são números distintos, e quem só guarda o
   * líquido perde os dois.
   *
   * A taxa da plataforma não volta, e é decisão de negócio: a plataforma
   * prestou o serviço de processar aquela cobrança. Quando isso mudar, o que
   * muda é este método.
   */
  private async registrarEstorno(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    const payload = event.payload as RefundIssuedPayload;
    const amount = toMoney(payload.amount);

    await this.ledger.post(
      {
        organizationId: event.organizationId,
        event: { type: event.type, id: event.id },
        description:
          `Estorno de ${amount.toDecimalString()} na fatura ${payload.invoiceNumber} ` +
          `de ${payload.customerName}: ${payload.reason}`,
        occurredAt: event.occurredAt,
        lines: [
          { account: ACCOUNT.MERCHANT_REFUNDS, amount },
          { account: ACCOUNT.GATEWAY_CLEARING, amount: amount.negated() },
        ],
      },
      tx,
    );
  }

  /**
   * Rateio da troca de plano.
   *
   * As duas pernas entram no mesmo lançamento porque são o mesmo fato: o
   * cliente deixou de usar um plano e passou a usar outro no mesmo instante.
   * Separá-las em dois lançamentos deixaria o razão momentaneamente
   * desbalanceado entre eles, o que a constraint diferida recusaria de todo
   * jeito.
   *
   * O crédito devolve receita e cria saldo a favor do cliente. A cobrança
   * reconhece a receita nova e aumenta o que ele deve.
   */
  private async registrarRateio(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    const payload = event.payload as SubscriptionPlanChangedPayload;
    const credit = toMoney(payload.credit);
    const charge = toMoney(payload.charge);

    // Troca no último dia do ciclo não credita nem cobra nada. Um lançamento
    // com todas as linhas zeradas seria recusado pelo banco, e com razão: não
    // houve fato contábil.
    if (credit.isZero() && charge.isZero()) {
      return;
    }

    await this.ledger.post(
      {
        organizationId: event.organizationId,
        event: { type: event.type, id: event.id },
        description:
          `${payload.customerName} trocou de ${payload.fromPlanName} ` +
          `para ${payload.toPlanName}, ${payload.remainingDays} de ` +
          `${payload.cycleDays} dias restantes do ciclo`,
        occurredAt: event.occurredAt,
        // Linha de valor zero é recusada pelo banco, e com razão: não movimenta
        // nada. Ela aparece quando um dos lados do rateio arredonda para zero,
        // o que acontece com preço muito baixo perto do fim do ciclo. Descartar
        // as duas pernas zeradas mantém o lançamento balanceado.
        lines: [
          { account: ACCOUNT.MERCHANT_REVENUE, amount: credit },
          { account: ACCOUNT.CUSTOMER_CREDIT, amount: credit.negated() },
          { account: ACCOUNT.CUSTOMER_RECEIVABLE, amount: charge },
          { account: ACCOUNT.MERCHANT_REVENUE, amount: charge.negated() },
        ].filter((line) => !line.amount.isZero()),
      },
      tx,
    );
  }
}
