import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BillingInterval, OrganizationRole } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Money } from '@paynow/money';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { RequireRole } from '../../platform/http/auth-context';
import { MetricsService } from '../application/metrics.service';
import { CatalogService } from '../application/catalog.service';
import { SubscriptionsService } from '../application/subscriptions.service';
import { allowedTransitions, isActive } from '../domain/subscription-state';

const uuid = () => new ParseUUIDPipe({ version: '7' });

class CreateCustomerDto {
  @IsEmail() email!: string;
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @Length(1, 120) externalId?: string;
}

class CreateProductDto {
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @Length(1, 500) description?: string;
}

class CreatePriceDto {
  /** Em unidade mínima, como string: JSON não tem inteiro de 64 bits. */
  @IsString() amountMinor!: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsEnum(BillingInterval) interval!: BillingInterval;
  @IsOptional() @IsInt() @Min(1) intervalCount?: number;
  @IsOptional() @IsInt() @Min(0) trialDays?: number;
}

class StartSubscriptionDto {
  @IsString() customerId!: string;
  @IsString() priceId!: string;
  @IsOptional() skipTrial?: boolean;
}

class ChangePlanDto {
  @IsString() priceId!: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

class CancelDto {
  @IsOptional() immediate?: boolean;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

/**
 * Catálogo e assinaturas.
 *
 * Toda rota é escopada por organização e passa pelo guard de papel. Escrita
 * exige ADMIN: criar preço e trocar plano movimentam dinheiro, e não são
 * operação de rotina.
 */
@ApiTags('cobrança')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId')
@UseGuards(OrganizationRoleGuard)
export class BillingController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly subscriptions: SubscriptionsService,
    private readonly overview: MetricsService,
  ) {}

  // ------------------------------------------------------------------
  // Visão geral
  // ------------------------------------------------------------------

  @Get('metrics')
  @ApiOperation({
    summary: 'Os números da visão geral',
    description:
      'Receita recorrente, o que já entrou, o que falta receber e quantas assinaturas estão em ' +
      'recuperação. Todo valor é derivado das linhas: nenhum total é armazenado.',
  })
  async metrics(@Param('organizationId', uuid()) organizationId: string) {
    return this.overview.overview(organizationId);
  }

  @Get('customers')
  @ApiOperation({
    summary: 'Clientes do merchant',
    description: 'Não confundir com as pessoas que operam o painel: estas pagam a assinatura.',
  })
  listCustomers(@Param('organizationId', uuid()) organizationId: string) {
    return this.catalog.listCustomers(organizationId);
  }

  @Post('customers')
  @RequireRole(OrganizationRole.MEMBER)
  @ApiOperation({ summary: 'Cadastra um cliente' })
  createCustomer(
    @Param('organizationId', uuid()) organizationId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.catalog.createCustomer(organizationId, dto);
  }

  // ------------------------------------------------------------------
  // Catálogo
  // ------------------------------------------------------------------

  @Get('products')
  @ApiOperation({ summary: 'Produtos e seus preços' })
  async listProducts(@Param('organizationId', uuid()) organizationId: string) {
    const products = await this.catalog.listProducts(organizationId);

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      active: product.active,
      prices: product.prices.map((price) => ({
        id: price.id,
        amountMinor: price.amountMinor.toString(),
        amount: Money.fromMinor(price.amountMinor, price.currency).toDecimalString(),
        currency: price.currency,
        interval: price.interval,
        intervalCount: price.intervalCount,
        trialDays: price.trialDays,
        active: price.active,
      })),
    }));
  }

  @Post('products')
  @RequireRole(OrganizationRole.ADMIN)
  @ApiOperation({ summary: 'Cria um produto' })
  createProduct(
    @Param('organizationId', uuid()) organizationId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.catalog.createProduct(organizationId, dto);
  }

  @Post('products/:productId/prices')
  @RequireRole(OrganizationRole.ADMIN)
  @ApiOperation({
    summary: 'Cria um preço',
    description:
      'Preço é imutável depois de criado, e por isso não existe rota para alterá-lo. Mudar o ' +
      'valor de um preço em uso reescreveria em silêncio o que já foi cobrado de quem assinou ' +
      'antes. Para mudar de valor, crie outro preço e migre as assinaturas.',
  })
  createPrice(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('productId', uuid()) productId: string,
    @Body() dto: CreatePriceDto,
  ) {
    return this.catalog.createPrice(organizationId, productId, {
      amount: Money.fromMinor(BigInt(dto.amountMinor), dto.currency),
      interval: dto.interval,
      ...(dto.intervalCount === undefined ? {} : { intervalCount: dto.intervalCount }),
      ...(dto.trialDays === undefined ? {} : { trialDays: dto.trialDays }),
    });
  }

  // ------------------------------------------------------------------
  // Assinaturas
  // ------------------------------------------------------------------

  @Get('subscriptions')
  @ApiOperation({ summary: 'Assinaturas da organização' })
  async listSubscriptions(@Param('organizationId', uuid()) organizationId: string) {
    const subscriptions = await this.subscriptions.list(organizationId);

    return subscriptions.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      hasAccess: isActive(subscription.status),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      version: subscription.version,
      customer: {
        id: subscription.customer.id,
        name: subscription.customer.name,
        email: subscription.customer.email,
      },
      plan: {
        priceId: subscription.price.id,
        product: subscription.price.product.name,
        amount: Money.fromMinor(
          subscription.price.amountMinor,
          subscription.price.currency,
        ).toDecimalString(),
        currency: subscription.price.currency,
        interval: subscription.price.interval,
      },
    }));
  }

  @Get('subscriptions/:subscriptionId')
  @ApiOperation({
    summary: 'Uma assinatura, com o histórico completo',
    description:
      'O histórico é append-only e responde "por que esta assinatura está assim". ' +
      'As transições possíveis a partir do estado atual vêm junto.',
  })
  async findSubscription(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('subscriptionId', uuid()) subscriptionId: string,
  ) {
    const subscription = await this.subscriptions.findById(organizationId, subscriptionId);

    return {
      id: subscription.id,
      status: subscription.status,
      hasAccess: isActive(subscription.status),
      allowedTransitions: allowedTransitions(subscription.status),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      canceledAt: subscription.canceledAt,
      version: subscription.version,
      customer: subscription.customer,
      plan: {
        priceId: subscription.price.id,
        product: subscription.price.product.name,
        amount: Money.fromMinor(
          subscription.price.amountMinor,
          subscription.price.currency,
        ).toDecimalString(),
        currency: subscription.price.currency,
        interval: subscription.price.interval,
      },
      history: subscription.events.map((event) => ({
        id: event.id,
        from: event.fromStatus,
        to: event.toStatus,
        reason: event.reason,
        occurredAt: event.occurredAt,
      })),
    };
  }

  @Post('subscriptions')
  @RequireRole(OrganizationRole.MEMBER)
  @ApiOperation({
    summary: 'Inicia uma assinatura',
    description:
      'Com período de teste, nasce em TRIALING. Sem, nasce INCOMPLETE e só vira ACTIVE quando ' +
      'o pagamento confirmar: dar acesso antes de o dinheiro entrar é dar acesso a quem talvez ' +
      'nunca pague.',
  })
  start(
    @Param('organizationId', uuid()) organizationId: string,
    @Body() dto: StartSubscriptionDto,
  ) {
    return this.subscriptions.start({
      organizationId,
      customerId: dto.customerId,
      priceId: dto.priceId,
      ...(dto.skipTrial === undefined ? {} : { skipTrial: dto.skipTrial }),
    });
  }

  @Post('subscriptions/:subscriptionId/change-plan')
  @RequireRole(OrganizationRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Troca o plano com rateio proporcional',
    description:
      'Credita o não usado do plano antigo e cobra o proporcional do novo, em centavos, com um ' +
      'único arredondamento. Envie expectedVersion para detectar alteração concorrente.',
  })
  async changePlan(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('subscriptionId', uuid()) subscriptionId: string,
    @Body() dto: ChangePlanDto,
  ) {
    const { subscription, proration } = await this.subscriptions.changePlan({
      organizationId,
      subscriptionId,
      priceId: dto.priceId,
      ...(dto.expectedVersion === undefined ? {} : { expectedVersion: dto.expectedVersion }),
    });

    return {
      subscription: {
        id: subscription.id,
        priceId: subscription.priceId,
        version: subscription.version,
      },
      proration: {
        credit: proration.credit.toDecimalString(),
        charge: proration.charge.toDecimalString(),
        net: proration.net.toDecimalString(),
        currency: proration.net.currencyCode,
        remainingDays: proration.remainingDays,
        cycleDays: proration.cycleDays,
      },
    };
  }

  @Post('subscriptions/:subscriptionId/cancel')
  @RequireRole(OrganizationRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancela a assinatura',
    description:
      'O padrão é encerrar no fim do ciclo já pago: quem pagou o mês tem direito ao mês. ' +
      'Passe immediate para encerrar na hora.',
  })
  cancel(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('subscriptionId', uuid()) subscriptionId: string,
    @Body() dto: CancelDto,
  ) {
    return this.subscriptions.cancel({
      organizationId,
      subscriptionId,
      ...(dto.immediate === undefined ? {} : { immediate: dto.immediate }),
      ...(dto.expectedVersion === undefined ? {} : { expectedVersion: dto.expectedVersion }),
    });
  }

  @Post('subscriptions/:subscriptionId/resume')
  @RequireRole(OrganizationRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desfaz um cancelamento agendado' })
  resume(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('subscriptionId', uuid()) subscriptionId: string,
  ) {
    return this.subscriptions.resume(organizationId, subscriptionId);
  }
}
