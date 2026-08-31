import { Alert, Cell, PageHeader, Panel, Table } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api, type JournalEntry } from '@/lib/api';

export const metadata = { title: 'Razão · Paynow' };

/**
 * Explorador do razão.
 *
 * A tela existe para tornar visivel a decisão central do projeto: saldo não e
 * um campo, é a soma das linhas. Por isso ela mostra as duas coisas lado a
 * lado, e não apenas o saldo: a coluna de linhas diz de quantos lançamentos
 * cada saldo veio, e o total confere que tudo se anula.
 */
export default async function LedgerPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);

  const [balances, entries, verification] = await Promise.all([
    api.ledgerBalances(active.id),
    api.ledgerEntries(active.id),
    api.ledgerVerification(active.id),
  ]);

  const total = balances.reduce((soma, conta) => soma + BigInt(conta.balanceMinor), 0n);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Razão"
        title="Livro de partidas dobradas"
        description="Nenhum saldo é armazenado. Cada valor abaixo é a soma das linhas da conta, recalculada a cada carregamento desta página."
      />

      {verification.balanced ? (
        <Alert tone="success">
          <span className="font-medium">Razão íntegro.</span> {verification.entryCount}{' '}
          lançamento(s) e {verification.lineCount} linha(s) conferidos. Todo lançamento soma zero e
          nenhuma linha foi alterada desde que foi escrita.
        </Alert>
      ) : (
        <Alert tone="error">
          <span className="font-medium">
            {verification.violations.length} violacao(oes) encontrada(s).
          </span>
          <ul className="mt-2 ml-4 list-disc space-y-1 text-[13px]">
            {verification.violations.map((violation) => (
              <li key={violation}>{violation}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Panel
        title="Balancete"
        description="Positivo é saldo devedor, negativo é credor. A soma de tudo precisa ser zero."
      >
        <Table headers={['Conta', 'Natureza', 'Linhas', 'Saldo']}>
          {balances.map((conta) => (
            <tr key={conta.code}>
              <Cell>
                <span className="block font-mono text-[13px]">{conta.code}</span>
                <span className="block text-[13px] text-ink-muted">{conta.label}</span>
              </Cell>
              <Cell className="text-[13px] text-ink-muted">
                {conta.kind}
                <span className="block text-ink-faint">
                  saldo normal {conta.normalBalance === 'debit' ? 'devedor' : 'credor'}
                </span>
              </Cell>
              <Cell className="tabular text-right text-[13px] text-ink-muted">
                {conta.lineCount}
              </Cell>
              <Cell className="tabular text-right">
                <Amount value={conta.balance} currency={conta.currency} />
              </Cell>
            </tr>
          ))}
          <tr>
            <Cell className="font-medium">Soma</Cell>
            <Cell />
            <Cell />
            <Cell className="tabular text-right font-medium">
              {total === 0n ? (
                <span className="text-credit">0,00</span>
              ) : (
                <span className="text-debit">{total.toString()} (deveria ser zero)</span>
              )}
            </Cell>
          </tr>
        </Table>
      </Panel>

      <Panel
        title="Lançamentos"
        description="Cada um carrega o evento de domínio que o originou, e cada linha diz de onde o valor saiu e para onde foi."
      >
        {entries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            Nenhum lançamento ainda. Rode <span className="font-mono">pnpm db:seed</span> para
            carregar os cenários de referência do plano de contas.
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function EntryRow({ entry }: { entry: JournalEntry }) {
  const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
    new Date(entry.occurredAt),
  );

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{entry.description}</span>
        <span className="tabular text-[13px] text-ink-muted">{data}</span>
      </div>

      <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
        {entry.eventType} · {entry.eventId}
      </p>

      <ul className="mt-3 space-y-1">
        {entry.lines.map((line) => (
          <li key={line.id} className="flex items-baseline justify-between gap-4 text-[13px]">
            <span className="font-mono text-ink-muted">{line.account}</span>
            <span className="tabular">
              <Amount value={line.amount} currency={line.currency} />
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Valor com cor por natureza.
 *
 * Verde para débito e vermelho para crédito não e escolha estetica: é a mesma
 * convenção do razão em papel, e a paleta do painel foi construida em volta
 * dela desde a fase 01.
 */
function Amount({ value, currency }: { value: string; currency: string }) {
  const negativo = value.startsWith('-');
  const formatado = value.replace('.', ',');

  return (
    <span className={negativo ? 'text-debit' : 'text-credit'}>
      {formatado} <span className="text-ink-faint">{currency}</span>
    </span>
  );
}
