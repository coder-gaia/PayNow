import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Money } from '@paynow/money';

/**
 * Erros do ledger.
 *
 * Todos carregam o número que não fechou, e não apenas a informação de que
 * algo não fechou. Em conferência contábil, saber que sobraram sete centavos
 * em BRL vale muito mais do que saber que o lançamento estava errado.
 */

export class UnbalancedEntryError extends BadRequestException {
  constructor(readonly residuals: readonly Money[]) {
    const detalhe = residuals.map((residual) => residual.toString()).join(', ');
    super(
      `Lançamento não soma zero. Sobrou ${detalhe}. ` +
        'Débitos e créditos precisam se anular dentro de cada moeda.',
    );
  }
}

export class EmptyEntryError extends BadRequestException {
  constructor(readonly lineCount: number) {
    super(
      `Lançamento tem ${lineCount} linha(s). Partida dobrada exige ao menos duas: ` +
        'de onde o valor saiu e para onde foi.',
    );
  }
}

export class ZeroAmountLineError extends BadRequestException {
  constructor(readonly account: string) {
    super(`A linha de ${account} tem valor zero, e não movimenta nada.`);
  }
}

/**
 * O mesmo evento de domínio já produziu lançamento.
 *
 * Não e falha: e a idempotência contábil funcionando. Quem chama normalmente
 * trata devolvendo o lançamento que já existe.
 */
export class DuplicateEntryError extends ConflictException {
  constructor(
    readonly eventType: string,
    readonly eventId: string,
  ) {
    super(`O evento ${eventType}:${eventId} já foi lançado neste razão.`);
  }
}

export class UnknownAccountError extends BadRequestException {
  constructor(readonly code: string) {
    super(
      `Conta ${code} não existe no plano de contas. ` +
        'Contas novas entram por ADR, com lançamentos de referência e testes.',
    );
  }
}

export class EntryNotFoundError extends NotFoundException {
  constructor() {
    super('Lançamento não encontrado.');
  }
}
