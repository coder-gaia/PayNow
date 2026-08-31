import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Money } from '@paynow/money';

import { CLOCK, type Clock } from '../../platform/clock/clock';
import { PrismaService } from '../../platform/prisma/prisma.service';
import {
  ACCOUNT,
  type AccountCode,
  accountDefinition,
  CHART_OF_ACCOUNTS,
  isAccountCode,
} from '../domain/chart-of-accounts';
import { assertBalanced, type EntryLine } from '../domain/journal-entry';
import {
  DuplicateEntryError,
  EntryNotFoundError,
  UnknownAccountError,
  ZeroAmountLineError,
} from '../domain/ledger.errors';

const UNIQUE_VIOLATION = 'P2002';

export interface PostEntryInput {
  readonly organizationId: string;
  /** Evento de domínio que originou o lançamento. Torna o lançamento idempotente. */
  readonly event: { readonly type: string; readonly id: string };
  readonly description: string;
  /** Quando o fato aconteceu. Omitido, usa o relógio injetado. */
  readonly occurredAt?: Date;
  readonly lines: readonly EntryLine[];
}

export interface PostedEntry {
  readonly id: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly description: string;
  readonly occurredAt: Date;
  readonly lines: { account: AccountCode; amount: Money }[];
}

export interface AccountBalance {
  readonly code: AccountCode;
  readonly label: string;
  readonly kind: string;
  readonly normalBalance: 'debit' | 'credit';
  readonly balance: Money;
  readonly lineCount: number;
}

export interface VerificationReport {
  readonly checkedAt: Date;
  readonly entryCount: number;
  readonly lineCount: number;
  readonly balanced: boolean;
  readonly violations: readonly string[];
}

/**
 * O razão.
 *
 * Toda movimentacao financeira do sistema passa por aqui, e nenhuma outra parte
 * do código escreve nas tabelas do ledger. Saldo nunca e gravado: é sempre uma
 * soma sobre linhas imutaveis (ADR-0003).
 *
 * O serviço válida o lançamento antes de enviar ao banco, mas quem garante e o
 * banco: constraint diferida para soma zero, trigger que recusa UPDATE e
 * DELETE, e índice único sobre o evento de origem. A validação aqui existe
 * para produzir mensagem útil, e não para ser a única barreira.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Registra um lançamento.
   *
   * As contas envolvidas são criadas sob demanda, na mesma transação. Isso
   * evita que o módulo de identidade precise conhecer o ledger para provisionar
   * o plano de contas ao criar a organização, o que a ADR-0001 proíbe.
   *
   * Recebendo uma transação, escreve dentro dela em vez de abrir a sua. É o que
   * permite que o efeito contábil de um evento de domínio viva ou morra junto
   * com o fato que o produziu: trocar de plano e registrar o rateio acontecem
   * na mesma transação, ou nenhum dos dois acontece.
   */
  async post(input: PostEntryInput, tx?: Prisma.TransactionClient): Promise<PostedEntry> {
    assertBalanced({ lines: input.lines });

    for (const line of input.lines) {
      if (!isAccountCode(line.account)) {
        throw new UnknownAccountError(line.account);
      }
      if (line.amount.isZero()) {
        throw new ZeroAmountLineError(line.account);
      }
    }

    const occurredAt = input.occurredAt ?? this.clock.now();

    const escrever = async (client: Prisma.TransactionClient) => {
      const created = await client.journalEntry.create({
        data: {
          organizationId: input.organizationId,
          eventType: input.event.type,
          eventId: input.event.id,
          description: input.description,
          occurredAt,
        },
      });

      for (const line of input.lines) {
        const account = await client.account.upsert({
          where: {
            organizationId_code_currency: {
              organizationId: input.organizationId,
              code: line.account,
              currency: line.amount.currencyCode,
            },
          },
          create: {
            organizationId: input.organizationId,
            code: line.account,
            kind: accountDefinition(line.account).kind,
            currency: line.amount.currencyCode,
          },
          update: {},
        });

        await client.journalLine.create({
          data: {
            entryId: created.id,
            accountId: account.id,
            amountMinor: line.amount.minor,
            currency: line.amount.currencyCode,
          },
        });
      }

      return created;
    };

    try {
      const entry =
        tx === undefined ? await this.prisma.$transaction(escrever) : await escrever(tx);

      return {
        id: entry.id,
        eventType: entry.eventType,
        eventId: entry.eventId,
        description: entry.description,
        occurredAt: entry.occurredAt,
        lines: input.lines.map((line) => ({ account: line.account, amount: line.amount })),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new DuplicateEntryError(input.event.type, input.event.id);
      }
      throw error;
    }
  }

  /**
   * Saldo de cada conta, derivado das linhas.
   *
   * Devolve o plano de contas inteiro, e não apenas as contas que já existem no
   * banco: uma organização que ainda não movimentou nada tem seis contas
   * zeradas, e não uma lista vazia. Zero e uma resposta, ausência não e.
   */
  async balances(organizationId: string, currency = 'BRL'): Promise<AccountBalance[]> {
    const rows = await this.prisma.$queryRaw<
      { code: string; balance: bigint; line_count: bigint }[]
    >`
      SELECT a.code,
             COALESCE(SUM(l.amount_minor), 0)::bigint AS balance,
             COUNT(l.id)::bigint AS line_count
        FROM accounts a
        LEFT JOIN journal_lines l ON l.account_id = a.id
       WHERE a.organization_id = ${organizationId}::uuid
         AND a.currency = ${currency}
       GROUP BY a.code
    `;

    const byCode = new Map(rows.map((row) => [row.code, row]));

    return CHART_OF_ACCOUNTS.map((definition) => {
      const row = byCode.get(definition.code);

      return {
        code: definition.code,
        label: definition.label,
        kind: definition.kind,
        normalBalance: definition.normalBalance,
        balance: Money.fromMinor(row?.balance ?? 0n, currency),
        lineCount: Number(row?.line_count ?? 0n),
      };
    });
  }

  /** Últimos lançamentos, com as linhas, para o explorador do painel. */
  async entries(organizationId: string, limit = 50) {
    const entries = await this.prisma.journalEntry.findMany({
      where: { organizationId },
      include: { lines: { include: { account: true } } },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(limit, 200),
    });

    return entries.map((entry) => this.present(entry));
  }

  async entry(organizationId: string, entryId: string) {
    const found = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, organizationId },
      include: { lines: { include: { account: true } } },
    });

    if (found === null) {
      throw new EntryNotFoundError();
    }

    return this.present(found);
  }

  /**
   * Auditoria completa do razão.
   *
   * Recalcula os invariantes a partir das linhas, sem confiar em nenhum valor
   * derivado que já esteja gravado. E o que `pnpm ledger:verify` roda, é o que
   * a rotina de reconciliação vai chamar quando o worker entrar na fase 05.
   */
  async verify(organizationId?: string): Promise<VerificationReport> {
    const scope = organizationId ?? null;
    const violations: string[] = [];

    const [totals] = await this.prisma.$queryRaw<{ entries: bigint; lines: bigint }[]>`
      SELECT (SELECT COUNT(*)::bigint FROM journal_entries e
               WHERE ${scope}::uuid IS NULL OR e.organization_id = ${scope}::uuid) AS entries,
             (SELECT COUNT(*)::bigint FROM journal_lines l
                JOIN journal_entries e ON e.id = l.entry_id
               WHERE ${scope}::uuid IS NULL OR e.organization_id = ${scope}::uuid) AS lines
    `;

    // 1. Cada lançamento soma zero, por moeda.
    const unbalanced = await this.prisma.$queryRaw<
      { entry_id: string; currency: string; residual: bigint }[]
    >`
      SELECT l.entry_id, l.currency, SUM(l.amount_minor)::bigint AS residual
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id
       WHERE ${scope}::uuid IS NULL OR e.organization_id = ${scope}::uuid
       GROUP BY l.entry_id, l.currency
      HAVING SUM(l.amount_minor) <> 0
       LIMIT 20
    `;

    for (const row of unbalanced) {
      violations.push(
        `Lançamento ${row.entry_id} não soma zero em ${row.currency}: sobrou ${row.residual.toString()}.`,
      );
    }

    // 2. Nenhum lançamento com menos de duas linhas.
    const thin = await this.prisma.$queryRaw<{ entry_id: string; line_count: bigint }[]>`
      SELECT e.id AS entry_id, COUNT(l.id)::bigint AS line_count
        FROM journal_entries e
        LEFT JOIN journal_lines l ON l.entry_id = e.id
       WHERE ${scope}::uuid IS NULL OR e.organization_id = ${scope}::uuid
       GROUP BY e.id
      HAVING COUNT(l.id) < 2
       LIMIT 20
    `;

    for (const row of thin) {
      violations.push(
        `Lançamento ${row.entry_id} tem ${row.line_count.toString()} linha(s), e partida dobrada exige duas.`,
      );
    }

    // 3. A soma global de cada moeda é zero. Se cada lançamento fecha, o total
    //    fecha por consequência, mas verificar os dois pega corrupcao que
    //    tenha passado por fora da aplicação.
    const global = await this.prisma.$queryRaw<{ currency: string; residual: bigint }[]>`
      SELECT l.currency, SUM(l.amount_minor)::bigint AS residual
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.entry_id
       WHERE ${scope}::uuid IS NULL OR e.organization_id = ${scope}::uuid
       GROUP BY l.currency
      HAVING SUM(l.amount_minor) <> 0
    `;

    for (const row of global) {
      violations.push(`Soma global em ${row.currency} não é zero: ${row.residual.toString()}.`);
    }

    // 4. A moeda da linha bate com a da conta.
    const mismatched = await this.prisma.$queryRaw<{ line_id: string }[]>`
      SELECT l.id AS line_id
        FROM journal_lines l
        JOIN accounts a ON a.id = l.account_id
        JOIN journal_entries e ON e.id = l.entry_id
       WHERE l.currency <> a.currency
         AND (${scope}::uuid IS NULL OR e.organization_id = ${scope}::uuid)
       LIMIT 20
    `;

    for (const row of mismatched) {
      violations.push(`Linha ${row.line_id} tem moeda diferente da conta a que pertence.`);
    }

    const report: VerificationReport = {
      checkedAt: this.clock.now(),
      entryCount: Number(totals?.entries ?? 0n),
      lineCount: Number(totals?.lines ?? 0n),
      balanced: violations.length === 0,
      violations,
    };

    if (!report.balanced) {
      this.logger.error(
        `Ledger inconsistente: ${violations.length} violação(oes) em ${report.entryCount} lançamento(s).`,
      );
    }

    return report;
  }

  private present(entry: {
    id: string;
    eventType: string;
    eventId: string;
    description: string;
    occurredAt: Date;
    createdAt: Date;
    lines: { id: string; amountMinor: bigint; currency: string; account: { code: string } }[];
  }) {
    const lines = entry.lines.map((line) => ({
      id: line.id,
      account: line.account.code,
      amount: Money.fromMinor(line.amountMinor, line.currency),
    }));

    const currency = lines[0]?.amount.currencyCode ?? 'BRL';
    const total = lines
      .filter((line) => line.amount.isPositive())
      .reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));

    return {
      id: entry.id,
      eventType: entry.eventType,
      eventId: entry.eventId,
      description: entry.description,
      occurredAt: entry.occurredAt,
      createdAt: entry.createdAt,
      total,
      lines,
    };
  }
}

export { ACCOUNT };
