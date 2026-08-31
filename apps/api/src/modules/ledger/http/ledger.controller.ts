import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { OrganizationRoleGuard } from '../../platform/http/organization-role.guard';
import { LedgerService } from '../application/ledger.service';
import { AccountBalanceResponse, JournalEntryResponse, VerificationResponse } from './ledger.dto';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * Leitura do razão.
 *
 * Não existe rota de escrita: lançamento nasce de evento de domínio, dentro da
 * transação que o produziu, é nunca de uma chamada HTTP avulsa. Expor um
 * `POST /entries` daria a qualquer cliente autenticado o poder de inventar
 * fatos contábeis sem origem rastreável.
 *
 * Valores viajam em unidade mínima como string, e não como número. O JSON não
 * tem inteiro de 64 bits, e `10000000000000001` vira `10000000000000000` no
 * parser do navegador sem avisar ninguém.
 */
@ApiTags('ledger')
@ApiBearerAuth('usuário')
@Controller('organizations/:organizationId/ledger')
@UseGuards(OrganizationRoleGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('balances')
  @ApiOperation({
    summary: 'Saldo de cada conta',
    description:
      'Derivado das linhas, sempre. Devolve o plano de contas inteiro, inclusive as contas ' +
      'zeradas: zero e uma resposta, ausência não e.',
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
    summary: 'Últimos lançamentos, com as linhas',
    description: 'Cada lançamento carrega o evento de domínio que o originou.',
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
  @ApiOperation({ summary: 'Um lançamento específico' })
  @ApiOkResponse({ type: JournalEntryResponse })
  async entry(
    @Param('organizationId', uuid()) organizationId: string,
    @Param('entryId', uuid()) entryId: string,
  ): Promise<JournalEntryResponse> {
    return presentEntry(await this.ledger.entry(organizationId, entryId));
  }

  @Get('verification')
  @ApiOperation({
    summary: 'Auditoria dos invariantes contábeis',
    description:
      'Recalcula tudo a partir das linhas, sem confiar em valor derivado gravado. ' +
      'É a mesma verificação que `pnpm ledger:verify` roda no terminal.',
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
      // O relatório interno usa lista somente leitura; a resposta da API é
      // serializada, então a cópia mutável é o que o contrato declara.
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
      label: line.label,
      amountMinor: line.amount.minor.toString(),
      amount: line.amount.toDecimalString(),
      currency: line.amount.currencyCode,
    })),
  };
}
