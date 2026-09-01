import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type BillingInterval, Prisma } from '@prisma/client';
import { Money } from '@paynow/money';

import { PrismaService } from '../../platform/prisma/prisma.service';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Clientes do merchant
  // ------------------------------------------------------------------

  /**
   * Vincula um meio de pagamento ao cliente.
   *
   * O que fica guardado é o token do provedor, e nunca o cartão. Bandeira e
   * últimos quatro dígitos existem só para que a interface possa dizer "Visa
   * final 4242" em vez de mostrar um identificador opaco a quem está
   * conferindo a cobrança. Ver ADR-0014.
   */
  async attachPaymentMethod(
    organizationId: string,
    customerId: string,
    method: { token: string; brand?: string; last4?: string },
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });

    if (customer === null) {
      throw new NotFoundException('Cliente não encontrado nesta organização.');
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        paymentMethodToken: method.token,
        paymentMethodBrand: method.brand ?? null,
        paymentMethodLast4: method.last4 ?? null,
      },
    });
  }

  async createCustomer(
    organizationId: string,
    input: { email: string; name: string; externalId?: string },
  ) {
    try {
      return await this.prisma.customer.create({
        data: {
          organizationId,
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          externalId: input.externalId ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new BadRequestException('Já existe um cliente com este email nesta organização.');
      }
      throw error;
    }
  }

  listCustomers(organizationId: string) {
    return this.prisma.customer.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ------------------------------------------------------------------
  // Produtos e preços
  // ------------------------------------------------------------------

  async createProduct(organizationId: string, input: { name: string; description?: string }) {
    try {
      return await this.prisma.product.create({
        data: {
          organizationId,
          name: input.name.trim(),
          description: input.description?.trim() ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new BadRequestException('Já existe um produto com este nome nesta organização.');
      }
      throw error;
    }
  }

  listProducts(organizationId: string) {
    return this.prisma.product.findMany({
      where: { organizationId },
      include: { prices: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Cria um preço para um produto.
   *
   * Preço é imutável depois de criado, e não existe rota para alterá-lo. Mudar
   * o valor de um preço em uso reescreveria em silêncio o que já foi cobrado
   * de quem assinou antes. Para mudar de valor, cria-se outro preço e migram-se
   * as assinaturas, que é exatamente o que a troca de plano faz.
   */
  async createPrice(
    organizationId: string,
    productId: string,
    input: {
      amount: Money;
      interval: BillingInterval;
      intervalCount?: number;
      trialDays?: number;
    },
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (product === null) {
      throw new NotFoundException('Produto não encontrado nesta organização.');
    }

    if (!input.amount.isPositive()) {
      throw new BadRequestException(
        'Preço precisa ser maior que zero. Plano gratuito se modela com produto sem preço, ' +
          'para que "não cobra" seja explícito.',
      );
    }

    return this.prisma.price.create({
      data: {
        organizationId,
        productId,
        amountMinor: input.amount.minor,
        currency: input.amount.currencyCode,
        interval: input.interval,
        intervalCount: input.intervalCount ?? 1,
        trialDays: input.trialDays ?? 0,
      },
    });
  }

  /** Desativa um preço. As assinaturas que já o usam continuam valendo. */
  async deactivatePrice(organizationId: string, priceId: string) {
    const atualizados = await this.prisma.price.updateMany({
      where: { id: priceId, organizationId, active: true },
      data: { active: false },
    });

    if (atualizados.count === 0) {
      throw new NotFoundException('Preço não encontrado ou já inativo.');
    }
  }
}
