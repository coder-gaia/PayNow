import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InvoiceStatus, OrganizationRole, PaymentStatus } from '@prisma/client';
import { Money } from '@paynow/money';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

import { RequireRole } from '../../platform/http/auth-context';
import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { CatalogService } from '../application/catalog.service';
import { InvoicesService } from '../application/invoices.service';
import { PaymentsService } from '../application/payments.service';
import { RefundsService } from '../application/refunds.service';
import { MAX_ATTEMPTS, RETRY_SCHEDULE_HOURS } from '../domain/dunning';

const uuid = () => new ParseUUIDPipe({ version: '7' });

class RefundDto {
  /**
   * Valor a estornar, em unidade mínima, como string.
   *
   * Ausente estorna o que ainda resta do pagamento. String porque JSON não tem
   * inteiro de 64 bits, pela mesma razão da ADR-0002.
   */
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,17}$/u) amountMinor?: string;

  @IsString() @Length(3, 200) reason!: string;
}

class AttachPaymentMethodDto {
  /**
   * Token opaco do provedor.
   *
   * Nunca número de cartão. A validação recusa qualquer coisa que pareça um,
   * porque a defesa mais barata contra um dado sensível entrar no sistema é
   * ele não conseguir passar pela porta. Ver ADR-0014.
   */
  @IsString()
  @Length(8, 200)
  @Matches(/^(?!\d{12,19}$).*/u, {
    message:
      'Isso parece um número de cartão. Envie o token emitido pelo provedor, nunca o cartão.',
  })
  token!: string;

  @IsOptional() @IsString() @Length(2, 40) brand?: string;
  @IsOptional() @IsString() @Length(4, 4) last4?: string;
}

/**
 * Faturas, cobranças e recuperação.
 *
 * Nenhuma rota aqui recebe dado de cartão. O que entra é um token opaco emitido
 * pelo provedor, que só ele sabe resolver, e é isso que mantém o escopo PCI em
 * SAQ-A: o sistema nunca vê, transmite nem armazena o cartão.
 */
@ApiTags('cobrança')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId')
@UseGuards(OrganizationRoleGuard)
export class PaymentsController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly catalog: CatalogService,
  ) {}

  @Post('customers/:customerId/payment-method')
  @RequireRole(OrganizationRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vincula um meio de pagamento ao cliente',
    description:
      'Recebe o token emitido pelo provedor, e nunca o cartão. Bandeira e últimos quatro dígitos ' +
      'são só para exibição.',
  })
  async attachPaymentMethod(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('customerId', uuid()) customerId: string,
    @Body() dto: AttachPaymentMethodDto,
  ) {
    const customer = await this.catalog.attachPaymentMethod(organizationId, customerId, {
      token: dto.token,
      ...(dto.brand === undefined ? {} : { brand: dto.brand }),
      ...(dto.last4 === undefined ? {} : { last4: dto.last4 }),
    });

    return {
      id: customer.id,
      name: customer.name,
      paymentMethod: {
        brand: customer.paymentMethodBrand,
        last4: customer.paymentMethodLast4,
      },
    };
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Faturas da organização' })
  @ApiQuery({ name: 'status', required: false, enum: InvoiceStatus })
  async listInvoices(
    @Param('organizationId', uuid()) organizationId: string,
    @Query('status') status?: InvoiceStatus,
  ) {
    const invoices = await this.invoices.list(
      organizationId,
      status !== undefined && status in InvoiceStatus ? status : undefined,
    );

    return invoices.map((invoice) => apresentar(invoice));
  }

  @Get('invoices/:invoiceId')
  @ApiOperation({
    summary: 'Uma fatura, com todas as tentativas de cobrança',
    description:
      'O histórico de tentativas é o que responde "por que este cliente foi cortado". Nenhuma ' +
      'tentativa é sobrescrita pela seguinte.',
  })
  async findInvoice(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('invoiceId', uuid()) invoiceId: string,
  ) {
    const invoice = await this.invoices.findById(organizationId, invoiceId);

    return {
      ...apresentar(invoice),
      plan: invoice.subscription === null ? null : invoice.subscription.price.product.name,
      // As chaves dos eventos que esta fatura originou.
      //
      // Quem junta fatura e razão é o painel, e não este módulo: as fronteiras
      // proíbem cobrança importar o razão, e a proibição está certa. O que
      // cobrança tem para oferecer são as chaves, que são dela; o razão sabe
      // devolver as linhas de cada uma. Calcular essas chaves no frontend
      // acoplaria a tela ao formato interno delas.
      ledgerEventIds: [
        ...(invoice.subscriptionId === null
          ? []
          : [`invoice-issued:${invoice.subscriptionId}:${invoice.periodStart.toISOString()}`]),
        ...invoice.payments
          .filter((payment) => payment.status === PaymentStatus.SUCCEEDED)
          .map((payment) => `payment-succeeded:${payment.id}`),
      ],
    };
  }

  @Post('invoices/:invoiceId/charge')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tenta cobrar a fatura',
    description:
      'Cobrar uma fatura já quitada não é erro: é repetição, e a resposta é o estado atual. ' +
      'A chamada ao provedor acontece fora de transação, e a chave de idempotência deriva da ' +
      'fatura e da tentativa, então repetir depois de um timeout não cobra duas vezes.',
  })
  async charge(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('invoiceId', uuid()) invoiceId: string,
  ) {
    const result = await this.payments.chargeInvoice(organizationId, invoiceId);

    return {
      paymentId: result.paymentId === '' ? null : result.paymentId,
      status: result.status,
      attempt: result.attempt,
      invoiceStatus: result.invoiceStatus,
      failureCode: result.failureCode ?? null,
      nextAttemptAt: result.nextAttemptAt ?? null,
    };
  }

  @Post('payments/:paymentId/refund')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Estorna uma cobrança confirmada',
    description:
      'Total ou parcial. O estorno não apaga o pagamento: é um lançamento novo, com data ' +
      'própria, e o histórico guarda os dois. A taxa da plataforma não volta.',
  })
  async refund(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('paymentId', uuid()) paymentId: string,
    @Body() dto: RefundDto,
  ) {
    const refund = await this.refunds.refund({
      organizationId,
      paymentId,
      reason: dto.reason,
      ...(dto.amountMinor === undefined
        ? {}
        : { amount: Money.fromMinor(BigInt(dto.amountMinor), 'BRL') }),
    });

    return {
      id: refund.id,
      status: refund.status,
      amount: Money.fromMinor(refund.amountMinor, refund.currency).toDecimalString(),
      currency: refund.currency,
      reason: refund.reason,
      gatewayRef: refund.gatewayRef,
    };
  }

  @Get('refunds')
  @ApiOperation({ summary: 'Estornos concedidos' })
  async listRefunds(@Param('organizationId', uuid()) organizationId: string) {
    const refunds = await this.refunds.list(organizationId);

    return refunds.map((refund) => ({
      id: refund.id,
      status: refund.status,
      amount: Money.fromMinor(refund.amountMinor, refund.currency).toDecimalString(),
      currency: refund.currency,
      reason: refund.reason,
      invoiceNumber: refund.invoice.number,
      customerName: refund.invoice.customer.name,
      createdAt: refund.createdAt,
    }));
  }

  @Get('dunning')
  @ApiOperation({
    summary: 'O calendário de recuperação',
    description:
      'O intervalo cresce porque as causas mudam de natureza: saldo momentâneo nas primeiras ' +
      'horas, desatenção no dia seguinte, decisão depois de três dias.',
  })
  dunning() {
    return {
      maxAttempts: MAX_ATTEMPTS,
      scheduleHours: RETRY_SCHEDULE_HOURS,
    };
  }
}

type InvoiceComTudo = Awaited<ReturnType<InvoicesService['findById']>>;

function apresentar(
  invoice: InvoiceComTudo | Awaited<ReturnType<InvoicesService['list']>>[number],
) {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    amount: Money.fromMinor(invoice.amountMinor, invoice.currency).toDecimalString(),
    currency: invoice.currency,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    attemptCount: invoice.attemptCount,
    nextAttemptAt: invoice.nextAttemptAt,
    customer: {
      id: invoice.customer.id,
      name: invoice.customer.name,
      email: invoice.customer.email,
    },
    payments: invoice.payments.map((payment) => ({
      id: payment.id,
      attempt: payment.attempt,
      status: payment.status,
      gateway: payment.gateway,
      gatewayRef: payment.gatewayRef,
      failureCode: payment.failureCode,
      failureMessage: payment.failureMessage,
      retriable: payment.retriable,
      createdAt: payment.createdAt,
    })),
  };
}
