import { Alert, Cell, PageHeader, Panel, Table } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api, type JournalEntry, type JournalLine } from '@/lib/api';

export const metadata = { title: 'Razão · Paynow' };

/**
 * Explorador do razão.
 *
 * A tela existe para tornar visível a decisão central do projeto: saldo não é
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
            {verification.violations.length} violação(ões) encontrada(s).
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
        <Table
          headers={[
            'Conta',
            'Natureza',
            { label: 'Linhas', align: 'right' },
            { label: 'Saldo', align: 'right' },
          ]}
        >
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
              <Cell className="tabular text-right whitespace-nowrap">
                <Amount value={conta.balance} currency={conta.currency} />
              </Cell>
            </tr>
          ))}
          <tr>
            <Cell className="font-medium">Soma</Cell>
            <Cell />
            <Cell />
            <Cell className="tabular text-right font-medium whitespace-nowrap">
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

/**
 * Um lançamento, apresentado como partida dobrada de verdade.
 *
 * As colunas são débito e crédito, e não um valor com sinal. Sinal é como o
 * banco guarda; débito e crédito é como contabilidade se lê, e a diferença
 * aparece justamente no caso mais comum daqui: a troca de plano toca a mesma
 * conta de receita duas vezes, uma devolvendo o não usado e outra reconhecendo
 * o novo. Com sinal, as duas linhas pareciam contraditórias.
 *
 * A soma dos dois lados fecha embaixo, o que prova por linha o que a faixa no
 * topo da página afirma sobre o razão inteiro.
 */
function EntryRow({ entry }: { entry: JournalEntry }) {
  const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
    new Date(entry.occurredAt),
  );

  const debitos = entry.lines.filter((line) => !line.amount.startsWith('-'));
  const creditos = entry.lines.filter((line) => line.amount.startsWith('-'));

  return (
    <li className="px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{entry.description}</span>
        <span className="tabular text-[13px] whitespace-nowrap text-ink-muted">{data}</span>
      </div>

      <p className="mt-1 font-mono text-[11px] text-credit">{entry.eventType}</p>

      {/*
        Colunas de largura fixa, e não automática: com `auto` cada lançamento
        dimensiona as próprias colunas pelo maior valor que ele tem, e a lista
        deixa de alinhar de um lançamento para o outro. Conferir uma coluna de
        números que serpenteia é justamente o trabalho que a tabela deveria
        poupar.
      */}
      <div className="mt-3 grid grid-cols-[1fr_5rem_5rem] gap-x-3 text-[13px] sm:grid-cols-[1fr_7rem_7rem] sm:gap-x-6">
        <span className="font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">
          Conta
        </span>
        <span className="text-right font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">
          Débito
        </span>
        <span className="text-right font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">
          Crédito
        </span>

        {entry.lines.map((line) => (
          <LineRow key={line.id} line={line} />
        ))}

        <span className="mt-1 border-t border-rule pt-1 text-ink-muted">Total</span>
        <span className="tabular mt-1 border-t border-rule pt-1 text-right whitespace-nowrap text-credit">
          {somar(debitos)}
        </span>
        <span className="tabular mt-1 border-t border-rule pt-1 text-right whitespace-nowrap text-debit">
          {somar(creditos)}
        </span>
      </div>

      {/*
        O identificador do evento fica, mas em segundo plano: é o que liga o
        lançamento ao fato que o originou e o que torna a duplicata impossível,
        e não algo que alguém leia de relance. O texto completo vem no title.
      */}
      <p
        className="mt-3 truncate font-mono text-[10.5px] text-ink-faint"
        title={`Evento de origem: ${entry.eventId}`}
      >
        evento {entry.eventId}
      </p>
    </li>
  );
}

function LineRow({ line }: { line: JournalLine }) {
  const credito = line.amount.startsWith('-');
  const valor = formatar(line.amount);

  return (
    <>
      <span className="py-0.5">
        <span className="block">{line.label}</span>
        <span className="block font-mono text-[11px] text-ink-faint">{line.account}</span>
      </span>
      <span className="tabular py-0.5 text-right whitespace-nowrap text-credit">
        {credito ? '' : valor}
      </span>
      <span className="tabular py-0.5 text-right whitespace-nowrap text-debit">
        {credito ? valor : ''}
      </span>
    </>
  );
}

/**
 * Soma de um lado do lançamento, em centavos.
 *
 * Feita com bigint pelo mesmo motivo da ADR-0002: `Number` sobre valor
 * monetário é onde o centavo some. Os créditos chegam negativos e são
 * apresentados pelo valor absoluto, porque a coluna já diz o lado.
 */
function somar(lines: JournalLine[]): string {
  const total = lines.reduce((soma, line) => {
    const minor = BigInt(line.amountMinor);
    return soma + (minor < 0n ? -minor : minor);
  }, 0n);

  const centavos = (total % 100n).toString().padStart(2, '0');

  return `${(total / 100n).toString()},${centavos}`;
}

/** "-9.68" vira "9,68": o sinal virou coluna, então não precisa aparecer. */
function formatar(amount: string): string {
  return amount.replace('-', '').replace('.', ',');
}

/**
 * Valor com cor por natureza.
 *
 * Verde para débito e vermelho para crédito não é escolha estética: é a mesma
 * convenção do razão em papel, e a paleta do painel foi construída em volta
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
