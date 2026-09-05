import { Injectable } from '@nestjs/common';
import { BillingInterval, InvoiceStatus, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { Money } from '@paynow/money';

import { PrismaService } from '../../platform/prisma/prisma.service';
import { isActive } from '../domain/subscription-state';

/** Quantos meses cada intervalo representa, para normalizar a receita recorrente. */
const MESES_POR_INTERVALO: Readonly<Record<BillingInterval, number>> = {
  [BillingInterval.DAY]: 1 / 30,
  [BillingInterval.WEEK]: 1 / 4,
  [BillingInterval.MONTH]: 1,
  [BillingInterval.YEAR]: 12,
};

/**
 * Os números que a visão geral do painel mostra.
 *
 * A primeira versão da tela contava assinaturas, membros e chaves de API, e
 * exibia três UUIDs. Nada ali é sobre dinheiro, que é a única coisa que alguém
 * abre um sistema de cobrança para ver.
 *
 * Todo valor aqui é derivado, e nenhum é lido de um campo de total. É a mesma
 * disciplina do razão, e pelo mesmo motivo: um total armazenado é um número que
 * alguém precisa lembrar de atualizar.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(organizationId: string) {
    const [assinaturas, faturas, recebido, estornado] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { organizationId },
        select: {
          status: true,
          price: {
            select: { amountMinor: true, currency: true, interval: true, intervalCount: true },
          },
        },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
      this.prisma.payment.aggregate({
        where: { organizationId, status: PaymentStatus.SUCCEEDED },
        _sum: { amountMinor: true },
      }),
      this.prisma.refund.aggregate({
        where: { organizationId, status: 'SUCCEEDED' },
        _sum: { amountMinor: true },
      }),
    ]);

    const moeda = assinaturas[0]?.price.currency ?? 'BRL';

    /**
     * Receita recorrente mensal.
     *
     * Só entram assinaturas que dão acesso ao produto. Uma assinatura
     * `INCOMPLETE` nunca pagou nada, e contá-la infla o número com dinheiro que
     * talvez nunca entre. Uma `UNPAID` já parou de ser cobrada.
     *
     * Anual dividido por doze, semanal multiplicado por quatro: MRR é uma
     * normalização, e não uma soma de preços. Somar os preços cru faria um plano
     * anual valer doze vezes o que ele vale por mês.
     */
    const mrr = assinaturas
      .filter((assinatura) => isActive(assinatura.status))
      .reduce((total, assinatura) => {
        const porCiclo = Money.fromMinor(assinatura.price.amountMinor, assinatura.price.currency);
        const meses =
          MESES_POR_INTERVALO[assinatura.price.interval] * assinatura.price.intervalCount;

        // Arredonda para o centavo mais próximo, e só no fim de cada assinatura:
        // acumular fração e arredondar no total esconderia a origem da sobra.
        return total.plus(
          Money.fromMinor(BigInt(Math.round(Number(porCiclo.minor) / meses)), moeda),
        );
      }, Money.zero(moeda));

    const porStatus = (status: InvoiceStatus) => faturas.find((linha) => linha.status === status);

    const aberto = faturas
      .filter((linha) => linha.status !== InvoiceStatus.PAID && linha.status !== InvoiceStatus.VOID)
      .reduce((total, linha) => total + (linha._sum.amountMinor ?? 0n), 0n);

    const emRecuperacao = assinaturas.filter(
      (assinatura) =>
        assinatura.status === SubscriptionStatus.PAST_DUE ||
        assinatura.status === SubscriptionStatus.UNPAID,
    ).length;

    const contagem: Record<string, number> = {};
    for (const assinatura of assinaturas) {
      contagem[assinatura.status] = (contagem[assinatura.status] ?? 0) + 1;
    }

    return {
      currency: moeda,
      mrrMinor: mrr.minor.toString(),
      recebidoMinor: (recebido._sum.amountMinor ?? 0n).toString(),
      estornadoMinor: (estornado._sum.amountMinor ?? 0n).toString(),
      // Líquido do que já entrou, que é o número que o merchant leva para casa.
      liquidoMinor: (
        (recebido._sum.amountMinor ?? 0n) - (estornado._sum.amountMinor ?? 0n)
      ).toString(),
      aReceberMinor: aberto.toString(),
      faturasPagas: porStatus(InvoiceStatus.PAID)?._count._all ?? 0,
      faturasAbertas: faturas
        .filter(
          (linha) => linha.status !== InvoiceStatus.PAID && linha.status !== InvoiceStatus.VOID,
        )
        .reduce((total, linha) => total + linha._count._all, 0),
      assinaturasAtivas: assinaturas.filter((assinatura) => isActive(assinatura.status)).length,
      assinaturasTotal: assinaturas.length,
      emRecuperacao,
      porStatus: contagem,
    };
  }
}
