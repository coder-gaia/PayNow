import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { LedgerService } from '../application/ledger.service';
import { AccountBalanceResponse, JournalEntryResponse, VerificationResponse } from './ledger.dto';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * Leitura do razao.
 *
 * Nao existe rota de escrita: lancamento nasce de evento de dominio, dentro da
 * transacao que o produziu, e nunca de uma chamada HTTP avulsa. Expor um
 * `POST /entries` daria a qualquer cliente autenticado o poder de inventar
 * fatos contabeis sem origem rastreavel.
 *
 * Valores viajam em unidade minima como string, e nao como numero. O JSON nao
 * tem inteiro de 64 bits, e `10000000000000001` vira `10000000000000000` no
 * parser do navegador sem avisar ninguem.
 */
@ApiTags('ledger')
@ApiBearerAuth('usuario')
@Controller('organizations/:organizationId/ledger')
@UseGuards(OrganizationRoleGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('balances')
  @ApiOperation({
    summary: 'Saldo de cada conta',
    description:
      'Derivado das linhas, sempre. Devolve o plano de contas inteiro, inclusive as contas ' +
      'zeradas: zero e uma resposta, ausencia nao e.',
  })
  @ApiQuery({ name: 'currency', required: false, example: 'BRL' })
  @ApiOkResponse({ type: [AccountBalanceResponse] })
  async balances(
    @Param('organizationId', uuid()) organizationId: string,
    @Query('currency') currency = 'BRL',
  ): Promise<AccountBalanceResponse[]> {
    const balances = await this.ledger.balances(organizationId, currency);

    return balances.map((account) => ({
      code: account.code,
      label: account.label,
      kind: account.kind,
      normalBalance: account.normalBalance,
      balanceMinor: account.balance.minor.toString(),
      balance: account.balance.toDecimalString(),
      currency: account.balance.currencyCode,
      lineCount: account.lineCount,
    }));
  }

  @Get('entries')
  @ApiOperation({
    summary: 'Ultimos lancamentos, com as linhas',
    description: 'Cada lancamento carrega o evento de dominio que o originou.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({ type: [JournalEntryResponse] })
  async entries(
    @Param('organizationId', uuid()) organizationId: string,
    @Query('limit') limit = '50',
  ): Promise<JournalEntryResponse[]> {
    const parsed = Number.parseInt(limit, 10);
    const entries = await this.ledger.entries(
      organizationId,
      Number.isFinite(parsed) ? parsed : 50,
    );

    return entries.map((entry) => presentEntry(entry));
  }

  @Get('entries/:entryId')
  @ApiOperation({ summary: 'Um lancamento especifico' })
  @ApiOkResponse({ type: JournalEntryResponse })
  async entry(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('entryId', uuid()) entryId: string,
  ): Promise<JournalEntryResponse> {
    return presentEntry(await this.ledger.entry(organizationId, entryId));
  }

  @Get('verification')
  @ApiOperation({
    summary: 'Auditoria dos invariantes contabeis',
    description:
      'Recalcula tudo a partir das linhas, sem confiar em valor derivado gravado. ' +
      'E a mesma verificacao que `pnpm ledger:verify` roda no terminal.',
  })
  @ApiOkResponse({ type: VerificationResponse })
  async verification(
    @Param('organizationId', uuid()) organizationId: string,
  ): Promise<VerificationResponse> {
    const report = await this.ledger.verify(organizationId);

    return {
      checkedAt: report.checkedAt,
      entryCount: report.entryCount,
      lineCount: report.lineCount,
      balanced: report.balanced,
      // O relatorio interno usa lista somente leitura; a resposta da API e
      // serializada, entao a copia mutavel e o que o contrato declara.
      violations: [...report.violations],
    };
  }
}

type ServiceEntry = Awaited<ReturnType<LedgerService['entry']>>;

function presentEntry(entry: ServiceEntry): JournalEntryResponse {
  return {
    id: entry.id,
    eventType: entry.eventType,
    eventId: entry.eventId,
    description: entry.description,
    occurredAt: entry.occurredAt,
    createdAt: entry.createdAt,
    total: entry.total.toDecimalString(),
    lines: entry.lines.map((line) => ({
      id: line.id,
      account: line.account,
      amountMinor: line.amount.minor.toString(),
      amount: line.amount.toDecimalString(),
      currency: line.amount.currencyCode,
    })),
  };
}
