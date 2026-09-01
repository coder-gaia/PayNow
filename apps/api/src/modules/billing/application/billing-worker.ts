import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { Env } from '../../../config/env';
import { OrganizationClockService } from '../../platform/clock/organization-clock.service';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { BillingCycleService } from './billing-cycle.service';

/** Quantas organizações uma varredura processa. */
const LOTE = 50;

/**
 * O que faz o tempo passar quando ninguém está olhando.
 *
 * Sem isto, a renovação e a recuperação só acontecem quando alguém chama a
 * rota, o que transforma o sistema em algo que só cobra enquanto tem gente
 * acordada. O ciclo em si já existia e já era testado; o que entra aqui é
 * apenas quem o chama.
 *
 * Roda **no mesmo processo da API**, ligado por `WORKER_ENABLED`. Ver ADR-0012:
 * a separação em processo próprio é uma decisão de operação, não de desenho, e
 * o código não muda quando ela for tomada.
 */
@Injectable()
export class BillingWorker {
  private readonly logger = new Logger(BillingWorker.name);
  private readonly enabled: boolean;

  /**
   * Trava de reentrada.
   *
   * Uma varredura que demore mais do que o intervalo do cron encontraria a
   * seguinte já rodando, e as duas disputariam as mesmas faturas. Os advisory
   * locks impediriam a corrupção, mas o trabalho seria feito duas vezes e o
   * log ficaria ilegível. Isto protege só dentro do processo: quando houver
   * mais de uma instância, a trava passa a ser o lock consultivo do Postgres
   * por organização, que já existe.
   */
  private rodando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clocks: OrganizationClockService,
    private readonly cycle: BillingCycleService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('WORKER_ENABLED', { infer: true });

    if (this.enabled) {
      this.logger.log('Ciclo de cobrança automático ligado');
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled || this.rodando) {
      return;
    }

    this.rodando = true;

    try {
      await this.varrer();
    } catch (error) {
      // Uma varredura que falha não pode derrubar o processo: a próxima
      // acontece em um minuto, e o trabalho não perdido continua pendente no
      // banco. O que não pode é falhar em silêncio.
      this.logger.error('Varredura do ciclo de cobrança falhou', error);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Uma passada por todas as organizações com trabalho vencido.
   *
   * Organizações com o relógio congelado ficam de fora de propósito. O tempo
   * delas só anda por comando, e deixar uma varredura de fundo cobrar no meio
   * de uma demonstração destruiria justamente a propriedade que o relógio
   * virtual existe para dar: a mesma sequência de comandos produz a mesma
   * história. Ver ADR-0015.
   */
  private async varrer(): Promise<void> {
    const pendentes = await this.organizacoesComTrabalho();

    if (pendentes.length === 0) {
      return;
    }

    for (const organizationId of pendentes) {
      try {
        const report = await this.clocks.runFor(organizationId, () =>
          this.cycle.runDue(organizationId),
        );

        if (report.effects.length > 0) {
          this.logger.log(
            `Organização ${organizationId}: ${report.effects.length} efeito(s) no ciclo`,
          );
        }
      } catch (error) {
        // O erro de uma organização não pode interromper a varredura das
        // outras. Cada uma é um cliente diferente do sistema.
        this.logger.error(`Ciclo falhou na organização ${organizationId}`, error);
      }
    }
  }

  /**
   * Quem tem ciclo vencido ou cobrança para tentar, pelo relógio de parede.
   *
   * A consulta é uma união em SQL cru porque o Prisma não expressa `DISTINCT`
   * sobre duas origens em uma consulta só, e trazer as duas listas para o Node
   * para unir em memória seria pior: as duas podem ser grandes, e o que
   * interessa é uma lista pequena de identificadores.
   */
  private async organizacoesComTrabalho(): Promise<string[]> {
    const linhas = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT DISTINCT s.organization_id
        FROM subscriptions s
        LEFT JOIN organization_clocks c ON c.organization_id = s.organization_id
       WHERE c.organization_id IS NULL
         AND s.current_period_end <= NOW()
         AND s.status IN ('INCOMPLETE', 'TRIALING', 'ACTIVE')

       UNION

      SELECT DISTINCT i.organization_id
        FROM invoices i
        LEFT JOIN organization_clocks c ON c.organization_id = i.organization_id
       WHERE c.organization_id IS NULL
         AND i.status = 'OPEN'
         AND i.next_attempt_at IS NOT NULL
         AND i.next_attempt_at <= NOW()

       LIMIT ${LOTE}
    `;

    return linhas.map((linha) => linha.organization_id);
  }
}
