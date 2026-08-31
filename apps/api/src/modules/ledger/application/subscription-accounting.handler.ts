import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '@paynow/money';

import {
  type DomainEvent,
  type DomainEventHandler,
  EVENT,
  type EventType,
  type MoneyPayload,
  type SubscriptionPlanChangedPayload,
  type SubscriptionStartedPayload,
} from '../../platform/events/domain-event';
import { ACCOUNT } from '../domain/chart-of-accounts';
import { LedgerService } from './ledger.service';

const toMoney = (payload: MoneyPayload): Money =>
  Money.fromMinor(BigInt(payload.amountMinor), payload.currency);

/**
 * Política contábil das assinaturas.
 *
 * Aqui mora o conhecimento de como um fato de assinatura vira lançamento. O
 * módulo de cobrança não sabe que existem contas, e o razão não sabe o que é
 * um ciclo: o evento é o contrato entre os dois, e a ADR-0001 é o motivo.
 *
 * A separação também é a certa por outro motivo, independente da regra de
 * fronteira. Política contábil muda por decisão de negócio, e não por mudança
 * de produto: se um dia a receita passar a ser reconhecida ao longo do ciclo
 * em vez de na emissão, o que muda é este arquivo, e nada em cobrança.
 */
@Injectable()
export class SubscriptionAccountingHandler implements DomainEventHandler {
  readonly handles: readonly EventType[] = [
    EVENT.SUBSCRIPTION_STARTED,
    EVENT.SUBSCRIPTION_RENEWED,
    EVENT.SUBSCRIPTION_PLAN_CHANGED,
  ];

  constructor(private readonly ledger: LedgerService) {}

  async handle(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    switch (event.type) {
      case EVENT.SUBSCRIPTION_STARTED:
      case EVENT.SUBSCRIPTION_RENEWED:
        await this.emitirFatura(event, tx);
        return;

      case EVENT.SUBSCRIPTION_PLAN_CHANGED:
        await this.registrarRateio(event, tx);
        return;

      default:
        return;
    }
  }

  /**
   * Emissão de fatura.
   *
   * O cliente passa a dever e a receita é reconhecida. Nada de dinheiro entrou
   * ainda: a entrada é registrada quando o pagamento confirmar, na fase 05.
   */
  private async emitirFatura(event: DomainEvent, tx: Prisma.TransactionClient): Promise<void> {
    const payload = event.payload as SubscriptionStartedPayload;
    const amount = toMoney(payload.amount);

    await this.ledger.post(
      {
        organizationId: event.organizationId,
        event: { type: event.type, id: event.id },
        description: `Fatura de ${payload.customerName}, plano ${payload.planName}`,
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
