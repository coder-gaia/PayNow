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
/**
 * Natureza da conta, em português.
 *
 * O tipo contábil continua sendo o do plano de contas na API, porque é o que
 * um integrador espera receber. Aqui ele é traduzido: quem lê o balancete no
 * painel não tem obrigação de saber o que é CONTRA_REVENUE.
 */
const NATUREZA: Record<string, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  REVENUE: 'Receita',
  EXPENSE: 'Despesa',
  CONTRA_REVENUE: 'Redutora de receita',
};

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
              {/*
                O nome da conta na frente e o que ela significa embaixo. O
                código continua sendo a identidade da conta para quem integra,
                mas fica no title: "customer:receivable" não diz nada para quem
                abriu o balancete para conferir quanto tem a receber.
              */}
              <Cell>
                <span className="block font-medium" title={conta.code}>
                  {conta.label}
                </span>
                <span className="block text-[13px] text-ink-muted">{conta.description}</span>
              </Cell>
              <Cell className="text-[13px] text-ink-muted">
                {NATUREZA[conta.kind] ?? conta.kind}
                <span className="block text-ink-faint">
                  cresce no {conta.normalBalance === 'debit' ? 'débito' : 'crédito'}
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
 * Nome legível do evento que originou o lançamento.
 *
 * O tipo técnico continua sendo a identidade do evento, e é ele que aparece no
 * title e nos testes. Na tela vale o nome que uma pessoa reconhece: quem abre
 * o razão quer saber que aquilo foi uma troca de plano, e não decorar a
 * convenção de nomes do barramento.
 */
const EVENTO: Record<string, string> = {
  'invoice.issued': 'Fatura emitida',
  'payment.succeeded': 'Pagamento confirmado',
  'refund.issued': 'Estorno',
  'subscription.started': 'Assinatura iniciada',
  'subscription.trial_started': 'Período de teste iniciado',
  'subscription.plan_changed': 'Troca de plano',
  'subscription.downgraded': 'Troca de plano',
  'subscription.canceled': 'Cancelamento',
  'subscription.renewed': 'Renovação',
};

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
 *
 * O que identifica tecnicamente o lançamento, o tipo do evento e a chave de
 * idempotência, vive no title e não na tela. São o que torna a duplicata
 * impossível, e não algo que alguém leia de relance.
 */
function EntryRow({ entry }: { entry: JournalEntry }) {
  const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
    new Date(entry.occurredAt),
  );

  const debitos = entry.lines.filter((line) => !line.amount.startsWith('-'));
  const creditos = entry.lines.filter((line) => line.amount.startsWith('-'));

  return (
    <li className="px-3 py-5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{entry.description}</span>
        <span className="tabular text-[13px] whitespace-nowrap text-ink-muted">{data}</span>
      </div>

      <p className="mt-1.5">
        <span
          className="inline-block border border-rule bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-muted"
          title={`${entry.eventType} · ${entry.eventId}`}
        >
          {EVENTO[entry.eventType] ?? entry.eventType}
        </span>
      </p>

      {/*
        Colunas de largura fixa, e não automática: com `auto` cada lançamento
        dimensiona as próprias colunas pelo maior valor que ele tem, e a lista
        deixa de alinhar de um lançamento para o outro. Conferir uma coluna de
        números que serpenteia é justamente o trabalho que a tabela deveria
        poupar.
      */}
      <table className="mt-3 w-full table-fixed text-[13px]">
        <caption className="sr-only">Linhas do lançamento, em débito e crédito</caption>
        <colgroup>
          <col />
          <col className="w-[4.5rem] sm:w-28" />
          <col className="w-[4.5rem] sm:w-28" />
        </colgroup>
        <thead>
          <tr className="text-ink-faint">
            <th
              scope="col"
              className="pb-1 text-left font-mono text-[10px] font-normal tracking-[0.1em] uppercase"
            >
              Conta
            </th>
            <th
              scope="col"
              className="pb-1 text-right font-mono text-[10px] font-normal tracking-[0.1em] uppercase"
            >
              Débito
            </th>
            <th
              scope="col"
              className="pb-1 text-right font-mono text-[10px] font-normal tracking-[0.1em] uppercase"
            >
              Crédito
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((line) => (
            <LineRow key={line.id} line={line} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-rule-strong">
            <th scope="row" className="pt-2 text-left font-normal text-ink-muted">
              Total
            </th>
            <td className="tabular pt-2 text-right whitespace-nowrap text-credit">
              {somar(debitos)}
            </td>
            <td className="tabular pt-2 text-right whitespace-nowrap text-debit">
              {somar(creditos)}
            </td>
          </tr>
        </tfoot>
      </table>
    </li>
  );
}

/**
 * Uma linha do lançamento.
 *
 * O código da conta sai da tela e vai para o title. Ele é a identidade da
 * conta, mas repetir `merchant:revenue` embaixo de "Receita do merchant" só
 * dobra o texto sem acrescentar nada: quem quiser o código o encontra no
 * balancete, que existe justamente para ligar um ao outro.
 *
 * A régua embaixo de cada linha é o que impede o número de parecer flutuando:
 * sem ela, o olho perde a altura entre o nome da conta à esquerda e o valor à
 * direita.
 */
function LineRow({ line }: { line: JournalLine }) {
  const credito = line.amount.startsWith('-');
  const valor = formatar(line.amount);

  return (
    <tr className="border-b border-rule/70">
      <th scope="row" className="py-1.5 pr-2 text-left font-normal" title={line.account}>
        {line.label}
      </th>
      <td className="tabular py-1.5 text-right whitespace-nowrap text-credit">
        {credito ? '' : valor}
      </td>
      <td className="tabular py-1.5 text-right whitespace-nowrap text-debit">
        {credito ? valor : ''}
      </td>
    </tr>
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
