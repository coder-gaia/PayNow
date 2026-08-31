import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Money } from '@paynow/money';

/**
 * Erros do ledger.
 *
 * Todos carregam o numero que nao fechou, e nao apenas a informacao de que
 * algo nao fechou. Em conferencia contabil, saber que sobraram sete centavos
 * em BRL vale muito mais do que saber que o lancamento estava errado.
 */

export class UnbalancedEntryError extends BadRequestException {
  constructor(readonly residuals: readonly Money[]) {
    const detalhe = residuals.map((residual) => residual.toString()).join(', ');
    super(
      `Lancamento nao soma zero. Sobrou ${detalhe}. ` +
        'Debitos e creditos precisam se anular dentro de cada moeda.',
    );
  }
}

export class EmptyEntryError extends BadRequestException {
  constructor(readonly lineCount: number) {
    super(
      `Lancamento tem ${lineCount} linha(s). Partida dobrada exige ao menos duas: ` +
        'de onde o valor saiu e para onde foi.',
    );
  }
}

export class ZeroAmountLineError extends BadRequestException {
  constructor(readonly account: string) {
    super(`A linha de ${account} tem valor zero, e nao movimenta nada.`);
  }
}

/**
 * O mesmo evento de dominio ja produziu lancamento.
 *
 * Nao e falha: e a idempotencia contabil funcionando. Quem chama normalmente
 * trata devolvendo o lancamento que ja existe.
 */
export class DuplicateEntryError extends ConflictException {
  constructor(
    readonly eventType: string,
    readonly eventId: string,
  ) {
    super(`O evento ${eventType}:${eventId} ja foi lancado neste razao.`);
  }
}

export class UnknownAccountError extends BadRequestException {
  constructor(readonly code: string) {
    super(
      `Conta ${code} nao existe no plano de contas. ` +
        'Contas novas entram por ADR, com lancamentos de referencia e testes.',
    );
  }
}

export class EntryNotFoundError extends NotFoundException {
  constructor() {
    super('Lancamento nao encontrado.');
  }
}
