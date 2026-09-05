import Link from 'next/link';

import { formatDate, PageHeader, Panel, StatusPill } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

export const metadata = { title: 'Fatura · Paynow' };

/**
 * A fatura explicável.
 *
 * A pergunta que esta tela responde é "por que este número". Um sistema de
 * cobrança que mostra só o total obriga quem pergunta a acreditar; aqui a
 * fatura vem acompanhada das linhas do razão que ela originou, e a soma de cada
 * lançamento aparece na tela.
 *
 * O histórico de tentativas fica junto, e é o que responde a outra pergunta
 * incômoda: "por que este cliente foi cortado". Nenhuma tentativa é
 * sobrescrita pela seguinte.
 */
export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;

  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);
  const invoice = await api.invoice(active.id, invoiceId);

  // As chaves vêm da fatura, e as linhas vêm do razão. É o painel que junta:
  // as fronteiras de módulo proíbem cobrança importar o razão.
  const lancamentos =
    invoice.ledgerEventIds.length === 0
      ? []
      : await api.ledgerEntries(active.id, { eventIds: invoice.ledgerEventIds });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Fatura nº ${invoice.number}`}
        title={invoice.customer.name}
        description={`${invoice.plan ?? 'Sem plano'} · período de ${formatDate(invoice.periodStart)} a ${formatDate(invoice.periodEnd)}.`}
        action={<StatusPill status={invoice.status} />}
      />

      <section className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
        <Numero rotulo="Valor" valor={`R$ ${invoice.amount.replace('.', ',')}`} destaque />
        <Numero
          rotulo="Vencimento"
          valor={formatDate(invoice.dueAt)}
          nota={
            invoice.paidAt === null ? 'ainda não paga' : `paga em ${formatDate(invoice.paidAt)}`
          }
        />
        <Numero
          rotulo="Tentativas"
          valor={invoice.attemptCount.toString()}
          nota={
            invoice.nextAttemptAt === null
              ? 'nenhuma agendada'
              : `próxima em ${formatDate(invoice.nextAttemptAt)}`
          }
        />
      </section>

      <Panel
        title="De onde vem este número"
        description="As linhas que esta fatura escreveu no razão. Cada lançamento soma zero, e a soma está na tela."
        action={
          <Link href="/painel/ledger" className="text-sm text-credit underline underline-offset-2">
            Abrir o razão
          </Link>
        }
      >
        {lancamentos.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Nenhum lançamento ainda. Eles nascem quando a fatura é emitida e quando o dinheiro
            entra.
          </p>
        ) : (
          <ul className="divide-y divide-rule">
            {lancamentos.map((lancamento) => (
              <li key={lancamento.id} className="px-5 py-4">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{lancamento.description}</span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {formatDate(lancamento.occurredAt)} · {lancamento.eventType}
                  </span>
                </p>

                <div className="scroll-x mt-3">
                  <table className="w-full min-w-[22rem] font-mono text-[13px]">
                    <tbody>
                      {lancamento.lines.map((linha) => (
                        <tr key={linha.id} className="border-t border-rule">
                          <td className="py-1.5 pr-4 text-ink-muted" title={linha.account}>
                            {linha.label}
                          </td>
                          <td
                            className={`py-1.5 text-right tabular-nums ${
                              linha.amountMinor.startsWith('-') ? 'text-credit' : 'text-debit'
                            }`}
                          >
                            {formatarCentavos(linha.amountMinor)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-rule-strong">
                        <td className="py-1.5 pr-4 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
                          Soma
                        </td>
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {formatarCentavos(
                            lancamento.lines
                              .reduce((total, linha) => total + BigInt(linha.amountMinor), 0n)
                              .toString(),
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Tentativas de cobrança"
        description='O que responde "por que este cliente foi cortado". Nenhuma tentativa é sobrescrita pela seguinte.'
      >
        {invoice.payments.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">Nenhuma cobrança tentada ainda.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {invoice.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3"
              >
                <span className="font-mono text-[11px] text-ink-faint">nº {payment.attempt}</span>
                <StatusPill status={payment.status} />
                <span className="font-mono text-[11px] text-ink-muted">{payment.gateway}</span>
                {payment.failureMessage !== null && (
                  <span className="w-full text-sm text-debit">{payment.failureMessage}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p>
        <Link href="/painel/faturas" className="text-sm text-credit underline underline-offset-2">
          Voltar para as faturas
        </Link>
      </p>
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div className="bg-surface px-5 py-5">
      <p className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">{rotulo}</p>
      <p
        className={`mt-2 font-display text-2xl font-semibold tabular-nums ${destaque ? 'text-credit' : ''}`}
      >
        {valor}
      </p>
      {nota !== undefined && <p className="mt-1 text-[13px] text-ink-muted">{nota}</p>}
    </div>
  );
}

/** Centavos em reais, sem passar por ponto flutuante. Ver ADR-0002. */
function formatarCentavos(minor: string): string {
  const valor = BigInt(minor);
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const centavos = (absoluto % 100n).toString().padStart(2, '0');

  return `${negativo ? '-' : ''}${(absoluto / 100n).toString()},${centavos}`;
}
