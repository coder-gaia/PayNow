import Link from 'next/link';

import { formatDate, PageHeader, Panel, RolePill, StatusPill } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api, type Metrics } from '@/lib/api';

export const metadata = { title: 'Visão geral · Paynow' };

/**
 * A visão geral.
 *
 * A primeira versão desta tela contava assinaturas, membros e chaves de API, e
 * exibia três UUIDs em destaque. Nada ali é sobre dinheiro, que é a única coisa
 * que alguém abre um sistema de cobrança para ver. Os identificadores continuam
 * aqui, no fim, porque quem integra precisa deles: só deixaram de ser a
 * primeira coisa na tela.
 *
 * Nenhum valor mostrado aqui é lido de um campo de total. Todos são derivados,
 * pela mesma disciplina do razão e pelo mesmo motivo: um total armazenado é um
 * número que alguém precisa lembrar de atualizar.
 */
export default async function OverviewPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);

  const [organization, metrics, verificacao, lancamentos] = await Promise.all([
    api.organization(active.id),
    api.metrics(active.id),
    api.ledgerVerification(active.id),
    api.ledgerEntries(active.id, { limit: 5 }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Visão geral"
        title={organization.name}
        description={`Organização criada em ${formatDate(organization.createdAt)}. Os números abaixo são derivados das linhas, e nenhum deles está armazenado.`}
        action={<RolePill role={active.role} />}
      />

      <section
        aria-label="Dinheiro"
        className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4"
      >
        <Numero
          rotulo="Receita recorrente"
          valor={reais(metrics.mrrMinor)}
          nota={`${metrics.assinaturasAtivas} de ${metrics.assinaturasTotal} assinaturas dão acesso`}
          destaque
        />
        <Numero
          rotulo="Recebido, líquido"
          valor={reais(metrics.liquidoMinor)}
          nota={
            metrics.estornadoMinor === '0'
              ? 'nenhum estorno até aqui'
              : `${reais(metrics.recebidoMinor)} recebidos, ${reais(metrics.estornadoMinor)} estornados`
          }
        />
        <Numero
          rotulo="A receber"
          valor={reais(metrics.aReceberMinor)}
          nota={`${metrics.faturasAbertas} fatura(s) em aberto`}
          tom={metrics.aReceberMinor === '0' ? undefined : 'debito'}
        />
        <Numero
          rotulo="Em recuperação"
          valor={metrics.emRecuperacao.toString()}
          nota={
            metrics.emRecuperacao === 0
              ? 'nenhuma assinatura atrasada'
              : 'assinaturas com cobrança atrasada'
          }
          tom={metrics.emRecuperacao === 0 ? undefined : 'debito'}
        />
      </section>

      {/* O invariante mais forte do sistema, dito na primeira tela. Um razão
          que fecha só quando alguém abre a página do razão não fecha. */}
      <Panel
        title="Integridade do razão"
        description="Recalculada agora a partir das linhas, sem confiar em nenhum valor derivado já gravado."
        action={
          <Link href="/painel/ledger" className="text-sm text-credit underline underline-offset-2">
            Abrir o razão
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <p className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-semibold">
              {verificacao.balanced ? 'Soma 0,00' : 'Divergência'}
            </span>
            <StatusPill status={verificacao.balanced ? 'ACTIVE' : 'PAST_DUE'} />
          </p>
          <p className="font-mono text-[11px] tracking-[0.14em] text-ink-muted uppercase">
            {verificacao.lineCount} linhas em {verificacao.entryCount} lançamentos
          </p>
        </div>

        {!verificacao.balanced && (
          <ul className="border-t border-rule px-5 py-4 text-sm text-debit">
            {verificacao.violations.map((violacao) => (
              <li key={violacao}>{violacao}</li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <Panel
          title="Assinaturas por situação"
          description="A distribuição diz mais do que o total: cinco ativas e três em recuperação é outra empresa."
          action={
            <Link
              href="/painel/assinaturas"
              className="text-sm text-credit underline underline-offset-2"
            >
              Ver todas
            </Link>
          }
        >
          {Object.keys(metrics.porStatus).length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">Nenhuma assinatura ainda.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {Object.entries(metrics.porStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, quantas]) => (
                  <li key={status} className="flex items-center gap-4 px-5 py-3">
                    <span className="w-28 shrink-0">
                      <StatusPill status={status} />
                    </span>

                    {/* Barra proporcional, em CSS. Um número sozinho não deixa
                        comparar duas situações de relance. */}
                    <span className="h-2 flex-1 bg-surface-sunken" aria-hidden>
                      <span
                        className="block h-full bg-credit"
                        style={{ width: `${proporcao(quantas, metrics)}%` }}
                      />
                    </span>

                    <span className="w-8 text-right font-mono text-sm tabular-nums">{quantas}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Últimos lançamentos"
          description="Cada um carrega o evento de domínio que o originou."
          action={
            <Link
              href="/painel/ledger"
              className="text-sm text-credit underline underline-offset-2"
            >
              Ver o razão
            </Link>
          }
        >
          {lancamentos.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">
              Nenhum lançamento ainda. Eles nascem de eventos de domínio, nunca de chamada HTTP
              avulsa.
            </p>
          ) : (
            <ul className="divide-y divide-rule">
              {lancamentos.map((lancamento) => (
                <li key={lancamento.id} className="px-5 py-3">
                  <p className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 flex-1 text-sm">{lancamento.description}</span>
                    <span className="shrink-0 font-mono text-[12px] text-ink-muted tabular-nums">
                      {decimalEmReais(lancamento.total)}
                    </span>
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                    {formatDate(lancamento.occurredAt)} · {lancamento.eventType}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Identificadores"
        description="O que a API espera receber nas rotas. Ficam no fim porque só interessam a quem integra."
      >
        <dl className="divide-y divide-rule">
          <Row label="organizationId" value={organization.id} />
          <Row label="slug" value={organization.slug} />
          <Row label="Seu userId" value={profile.id} />
        </dl>
      </Panel>

      {profile.organizations.length > 1 && (
        <Panel
          title="Outras organizações"
          description="Troque a organização ativa pelo seletor no cabeçalho."
        >
          <ul className="divide-y divide-rule">
            {profile.organizations.map((organizacao) => (
              <li
                key={organizacao.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span>{organizacao.name}</span>
                <RolePill role={organizacao.role} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  destaque = false,
  tom,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  destaque?: boolean;
  tom?: 'debito';
}) {
  return (
    <div className="bg-surface px-5 py-5">
      <p className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">{rotulo}</p>
      <p
        className={`mt-2 font-display text-3xl font-semibold tabular-nums ${
          tom === 'debito' ? 'text-debit' : destaque ? 'text-credit' : ''
        }`}
      >
        {valor}
      </p>
      <p className="mt-1 text-[13px] text-ink-muted">{nota}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
      <dt className="font-mono text-[11px] tracking-[0.1em] text-ink-faint uppercase">{label}</dt>
      <dd className="font-mono text-[13px] break-all text-ink">{value}</dd>
    </div>
  );
}

function proporcao(quantas: number, metrics: Metrics): number {
  const maior = Math.max(...Object.values(metrics.porStatus), 1);
  return Math.round((quantas / maior) * 100);
}

/**
 * O total de um lançamento, que a API entrega em decimal ("103.00").
 *
 * Convertido por texto, e não com `Number`: um decimal em ponto flutuante é
 * exatamente o que a ADR-0002 mantém fora do sistema, e uma conversão dessas,
 * uma vez escrita, acaba copiada para algum lugar onde importa.
 */
function decimalEmReais(decimal: string): string {
  const [inteiros = '0', centavos = '00'] = decimal.split('.');
  return reais(`${inteiros}${centavos.padEnd(2, '0').slice(0, 2)}`);
}

/**
 * Centavos em reais, sem passar por ponto flutuante.
 *
 * Dividir por 100 traria de volta exatamente o que a ADR-0002 mantém fora do
 * sistema, e uma conversão dessas, uma vez escrita, acaba copiada para algum
 * lugar onde importa.
 */
function reais(minor: string): string {
  const valor = BigInt(minor);
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const centavos = (absoluto % 100n).toString().padStart(2, '0');
  const inteiros = (absoluto / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');

  return `${negativo ? '-' : ''}R$ ${inteiros},${centavos}`;
}
