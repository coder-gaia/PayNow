import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, RefundStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { DomainEventPublisher } from '../../platform/events/domain-event-publisher';
import { EVENT } from '../../platform/events/domain-event';
import {
  GatewayUnavailableError,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../../platform/payments/payment-gateway';
import { PrismaService } from '../../platform/prisma/prisma.service';

/** Chave de advisory lock por pagamento, para serializar estornos. */
const REFUND_LOCK_NAMESPACE = 0x72656675; // "refu"

export interface RefundInput {
  readonly organizationId: string;
  readonly paymentId: string;
  /** Sem valor, estorna o que ainda resta do pagamento. */
  readonly amount?: Money;
  readonly reason: string;
}

/**
 * Devolução de dinheiro já recebido.
 *
 * O estorno **não apaga** o pagamento. Ele é um fato novo, com data própria,
 * que aponta para o pagamento que está desfazendo. Anular o lançamento original
 * destruiria a resposta para "quanto entrou em março", que continua sendo o
 * valor cheio mesmo depois de devolvido em abril.
 *
 * A taxa da plataforma não volta. É decisão de negócio e não descuido: a
 * plataforma prestou o serviço de processar aquela cobrança, e é o que quase
 * todo adquirente faz. Quando isso mudar, o que muda é a política contábil em
 * `billing-accounting.handler.ts`, e nada aqui.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventPublisher,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Estorna, total ou parcialmente.
   *
   * Mesmo desenho de três tempos da cobrança, e pelo mesmo motivo: a chamada
   * ao provedor não pode acontecer com uma transação aberta.
   */
  async refund(input: RefundInput) {
    const reserva = await this.reservar(input);

    try {
      const outcome = await this.gateway.refund({
        idempotencyKey: reserva.idempotencyKey,
        chargeReference: reserva.chargeReference,
        amountMinor: reserva.amount.minor,
        currency: reserva.amount.currencyCode,
        reason: input.reason,
      });

      return outcome.status === 'succeeded'
        ? this.confirmar(reserva.refundId, outcome.reference)
        : this.recusar(reserva.refundId, outcome.message);
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        // Mesmo raciocínio da cobrança: não se sabe se o dinheiro voltou.
        // Nada é lançado, e a linha fica PENDING como registro de que houve
        // uma chamada de desfecho desconhecido.
        return this.pendente(reserva.refundId, error.message);
      }

      throw error;
    }
  }

  async list(organizationId: string) {
    return this.prisma.refund.findMany({
      where: { organizationId },
      include: { invoice: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Confere o que ainda pode ser devolvido e reserva a linha.
   *
   * O teto é o valor pago menos o que já está comprometido. Duas defesas
   * agem aqui, e as duas são necessárias: o advisory lock serializa dois
   * estornos do mesmo pagamento, e contar o que está PENDING impede que o
   * segundo passe achando que o primeiro não saiu.
   */
  private async reservar(input: RefundInput) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REFUND_LOCK_NAMESPACE}::int, hashtext(${input.paymentId})::int)`;

      const payment = await tx.payment.findFirst({
        where: { id: input.paymentId, organizationId: input.organizationId },
        include: { refunds: true, invoice: true },
      });

      if (payment === null) {
        throw new NotFoundException('Pagamento não encontrado.');
      }

      if (payment.status !== PaymentStatus.SUCCEEDED || payment.gatewayRef === null) {
        throw new BadRequestException(
          'Só é possível estornar uma cobrança confirmada. Uma tentativa recusada não tirou ' +
            'dinheiro de ninguém.',
        );
      }

      const pago = Money.fromMinor(payment.amountMinor, payment.currency);

      // Comprometido, e não apenas devolvido.
      //
      // Um estorno PENDING é dinheiro que pode já ter saído: a chamada ao
      // provedor acontece fora da transação, e enquanto ela não responde não
      // dá para afirmar que o dinheiro continua aqui. Contar só os SUCCEEDED
      // deixava dois estornos parciais simultâneos passarem os dois, porque o
      // primeiro ainda não tinha confirmado quando o segundo verificou. O
      // resultado era devolver mais do que entrou, e o erro só apareceria na
      // conciliação, com a conta de liquidação negativa.
      //
      // FAILED fica de fora: aí se sabe que o dinheiro não saiu, e o valor
      // volta a ficar disponível.
      const comprometido = payment.refunds
        .filter((refund) => refund.status !== RefundStatus.FAILED)
        .reduce(
          (soma, refund) => soma.plus(Money.fromMinor(refund.amountMinor, refund.currency)),
          Money.zero(payment.currency),
        );

      const disponivel = pago.minus(comprometido);

      if (!disponivel.isPositive()) {
        throw new BadRequestException('Este pagamento já foi estornado por inteiro.');
      }

      const amount = input.amount ?? disponivel;

      if (!amount.isPositive()) {
        throw new BadRequestException('O valor do estorno precisa ser positivo.');
      }

      if (amount.greaterThan(disponivel)) {
        throw new BadRequestException(
          `O máximo que ainda pode ser estornado deste pagamento é ${disponivel.toDecimalString()}.`,
        );
      }

      const sequencia = payment.refunds.length + 1;

      const refund = await tx.refund.create({
        data: {
          organizationId: input.organizationId,
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          amountMinor: amount.minor,
          currency: amount.currencyCode,
          reason: input.reason,
          status: RefundStatus.PENDING,
          // Deriva do pagamento e da ordem do estorno: dois estornos parciais
          // do mesmo pagamento são cobranças distintas para o provedor, e
          // repetir um deles não devolve o dinheiro duas vezes.
          idempotencyKey: `refund:${payment.id}:${sequencia}`,
        },
      });

      return {
        refundId: refund.id,
        idempotencyKey: refund.idempotencyKey,
        chargeReference: payment.gatewayRef,
        amount,
      };
    });
  }

  private async confirmar(refundId: string, reference: string) {
    const agora = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.update({
        where: { id: refundId },
        data: { status: RefundStatus.SUCCEEDED, gatewayRef: reference },
        include: { invoice: { include: { customer: true } } },
      });

      const amount = Money.fromMinor(refund.amountMinor, refund.currency);

      await this.events.publish(
        {
          type: EVENT.REFUND_ISSUED,
          id: `refund-issued:${refund.id}`,
          organizationId: refund.organizationId,
          occurredAt: agora,
          payload: {
            refundId: refund.id,
            paymentId: refund.paymentId,
            invoiceId: refund.invoiceId,
            invoiceNumber: refund.invoice.number,
            customerId: refund.invoice.customerId,
            customerName: refund.invoice.customer.name,
            amount: { amountMinor: amount.minor.toString(), currency: amount.currencyCode },
            reason: refund.reason,
            gatewayRef: reference,
          },
        },
        tx,
      );

      return refund;
    });
  }

  private async recusar(refundId: string, motivo: string) {
    return this.prisma.refund.update({
      where: { id: refundId },
      data: { status: RefundStatus.FAILED, failureMessage: motivo },
    });
  }

  private async pendente(refundId: string, motivo: string) {
    return this.prisma.refund.update({
      where: { id: refundId },
      data: { failureMessage: motivo },
    });
  }
}
