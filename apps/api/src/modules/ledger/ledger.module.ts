import { Module } from '@nestjs/common';

import { LedgerService } from './application/ledger.service';
import { LedgerController } from './http/ledger.controller';

/**
 * O razao.
 *
 * Exporta o servico porque, a partir da fase 05, pagamentos e assinaturas
 * precisam registrar lancamentos. A comunicacao entre eles nao sera por import
 * direto, que a ADR-0001 proibe, e sim pelo outbox: quem move dinheiro publica
 * o evento, e o consumidor do ledger o transforma em lancamento.
 */
@Module({
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
