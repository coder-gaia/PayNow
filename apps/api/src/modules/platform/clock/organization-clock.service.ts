import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { addMilliseconds } from './duration';
import { type ClockScope, ClockScopeStorage } from './clock-scope';

/** Um ano de avanço de uma vez. Além disso é quase certo que foi engano. */
const MAX_ADVANCE_MS = 366 * 24 * 60 * 60 * 1000;

export interface ClockState {
  readonly organizationId: string;
  readonly virtual: boolean;
  readonly now: Date;
  /** Instante em que o congelamento começou. Nulo em relógio de parede. */
  readonly frozenSince: Date | null;
  /** Quanto de tempo virtual já foi percorrido desde o congelamento. */
  readonly advancedMs: number;
}

/**
 * Relógio virtual por organização.
 *
 * Este é o segundo pilar do projeto. Cobrança recorrente é um domínio em que
 * quase todo comportamento interessante acontece na passagem do tempo: a
 * renovação do ciclo, o fim do teste, a primeira falha de pagamento, a
 * recuperação. Sem controle sobre o relógio, verificar qualquer um desses
 * exige esperar de verdade, e o que sobra é teste que finge.
 *
 * O modelo é congelamento explícito, no espírito do test clock do Stripe, e
 * não um deslocamento que continua andando. A diferença importa: com
 * deslocamento, rodar a mesma sequência de comandos duas vezes produz
 * históricos diferentes, porque o tempo real passou entre uma e outra. Com
 * congelamento, o tempo só anda quando alguém manda andar, e a mesma sequência
 * produz sempre a mesma história. É isso que torna a suíte adversarial da
 * fase 07 possível.
 *
 * O congelamento é por organização, o que significa que uma demonstração pode
 * viajar seis meses no futuro sem afetar nenhuma outra.
 */
@Injectable()
export class OrganizationClockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: ClockScopeStorage,
  ) {}

  /**
   * Resolve o instante que vale para uma organização agora.
   *
   * Uma consulta por request. É o preço de o relógio ser por organização, e é
   * barato: chave primária, uma linha, e na maioria esmagadora dos casos a
   * linha nem existe.
   */
  async resolve(organizationId: string): Promise<ClockScope> {
    const clock = await this.prisma.organizationClock.findUnique({
      where: { organizationId },
    });

    return {
      organizationId,
      now: clock === null ? new Date() : clock.frozenAt,
      virtual: clock !== null,
    };
  }

  /** Roda algo em nome de uma organização, com o relógio dela. */
  async runFor<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    const scope = await this.resolve(organizationId);
    return this.scopes.run(scope, fn);
  }

  async state(organizationId: string): Promise<ClockState> {
    const clock = await this.prisma.organizationClock.findUnique({
      where: { organizationId },
    });

    if (clock === null) {
      return {
        organizationId,
        virtual: false,
        now: new Date(),
        frozenSince: null,
        advancedMs: 0,
      };
    }

    return {
      organizationId,
      virtual: true,
      now: clock.frozenAt,
      frozenSince: clock.startedAt,
      advancedMs: clock.frozenAt.getTime() - clock.startedAt.getTime(),
    };
  }

  /**
   * Congela o relógio da organização.
   *
   * Sem instante, congela no agora. Congelar de novo uma organização que já
   * está congelada é recusado: seria uma forma silenciosa de perder o tempo
   * virtual já percorrido, e quem quer isso quer `reset`.
   */
  async freeze(organizationId: string, at?: Date): Promise<ClockState> {
    await this.assertOrganizationExists(organizationId);

    const existing = await this.prisma.organizationClock.findUnique({
      where: { organizationId },
    });

    if (existing !== null) {
      throw new BadRequestException(
        'O relógio desta organização já está congelado. Use reset antes de congelar de novo.',
      );
    }

    const instant = at ?? new Date();

    await this.prisma.organizationClock.create({
      data: { organizationId, frozenAt: instant, startedAt: instant },
    });

    return this.state(organizationId);
  }

  /**
   * Avança o relógio congelado.
   *
   * Só funciona com o relógio já congelado, e isso é deliberado. Avançar um
   * relógio de parede não quer dizer nada: ele voltaria a andar sozinho no
   * instante seguinte, e o avanço viraria uma diferença que ninguém controla.
   */
  async advance(organizationId: string, milliseconds: number): Promise<ClockState> {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      throw new BadRequestException('O avanço precisa ser um número positivo de milissegundos.');
    }

    if (milliseconds > MAX_ADVANCE_MS) {
      throw new BadRequestException(
        'O avanço máximo por chamada é de um ano. Avanços maiores costumam ser engano de unidade.',
      );
    }

    const clock = await this.prisma.organizationClock.findUnique({ where: { organizationId } });

    if (clock === null) {
      throw new BadRequestException(
        'O relógio desta organização não está congelado. Congele antes de avançar.',
      );
    }

    await this.prisma.organizationClock.update({
      where: { organizationId },
      data: { frozenAt: addMilliseconds(clock.frozenAt, milliseconds) },
    });

    return this.state(organizationId);
  }

  /** Devolve a organização ao relógio de parede. */
  async reset(organizationId: string): Promise<ClockState> {
    await this.prisma.organizationClock.deleteMany({ where: { organizationId } });
    return this.state(organizationId);
  }

  private async assertOrganizationExists(organizationId: string): Promise<void> {
    const found = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundException('Organização não encontrada.');
    }
  }
}
