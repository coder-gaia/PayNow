import Link from 'next/link';
import {
  Cell,
  EmptyState,
  formatDate,
  PageHeader,
  Panel,
  Stat,
  StatusPill,
  Table,
} from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api, type Invoice } from '@/lib/api';

import { InvoiceActions } from './invoice-actions';

export const metadata = { title: 'Faturas · Paynow' };

/**
 * Faturas e cobranças.
 *
 * A tela existe para responder uma pergunta que o suporte faz todo dia e que
 * quase nenhum sistema responde direito: **por que este cliente não pagou**.
 * Por isso cada fatura traz o histórico completo de tentativas, e não apenas a
 * última. A tentativa anterior não é sobrescrita pela seguinte, e é justamente
 * ela que contém a resposta.
 */
export default async function FaturasPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);

  const [invoices, refunds, dunning, clock] = await Promise.all([
    api.invoices(active.id),
    api.refunds(active.id),
    api.dunning(active.id),
    api.clock(active.id),
  ]);

  const agora = new Date(clock.now);

  const abertas = invoices.filter((invoice) => invoice.status === 'OPEN');
  const emAtraso = abertas.filter(
    (invoice) => new Date(invoice.dueAt).getTime() <= agora.getTime(),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Cobrança"
        title="Faturas"
        description="Cada tentativa de cobrança fica registrada, e nenhuma é sobrescrita pela seguinte. O histórico é o que responde por que um cliente foi cortado."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Faturas" value={invoices.length} />
        <Stat label="Em aberto" value={abertas.length} hint={`${emAtraso.length} já vencida(s)`} />
        <Stat
          label="A receber"
          value={somar(abertas)}
          hint="Soma do que foi emitido e ainda não entrou."
        />
      </div>

      <Panel
        title="Emitidas"
        description="Cobrar uma fatura já quitada não é erro: é repetição, e a resposta é o estado atual."
      >
        {invoices.length === 0 ? (
          <EmptyState>
            Nenhuma fatura ainda. Elas nascem quando uma assinatura começa ou quando o ciclo vira.
          </EmptyState>
        ) : (
          <Table
            headers={[
              'Fatura',
              'Cliente',
              'Estado',
              { label: 'Valor', align: 'right' },
              'Tentativas',
              { label: 'Ações', align: 'right' },
            ]}
          >
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <Cell>
                  {/* O número é o link: é por ele que se pergunta "de onde
                      veio este valor", e a tela da fatura responde com as
                      linhas do razão que ela originou. */}
                  <Link
                    href={`/painel/faturas/${invoice.id}`}
                    className="tabular block font-medium underline underline-offset-2 hover:text-credit"
                  >
                    nº {invoice.number}
                  </Link>
                  <span className="block text-[13px] text-ink-muted">
                    vence {formatDate(invoice.dueAt)}
                  </span>
                </Cell>

                <Cell>
                  <span className="block text-[13px]">{invoice.customer.name}</span>
                  <span className="block text-[13px] text-ink-faint">{invoice.customer.email}</span>
                </Cell>

                <Cell>
                  <StatusPill status={invoice.status} />
                  {invoice.nextAttemptAt !== null && invoice.status === 'OPEN' && (
                    <span className="mt-1 block text-[12px] text-ink-muted">
                      tenta de novo {formatDate(invoice.nextAttemptAt)}
                    </span>
                  )}
                </Cell>

                <Cell className="tabular text-right whitespace-nowrap">
                  {invoice.amount.replace('.', ',')} {invoice.currency}
                </Cell>

                <Cell>
                  <Tentativas invoice={invoice} />
                </Cell>

                <Cell>
                  <InvoiceActions organizationId={active.id} invoice={invoice} />
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Calendário de recuperação"
        description="O intervalo cresce porque as causas mudam de natureza com o tempo."
      >
        <div className="space-y-3 px-5 py-4 text-sm text-ink-muted">
          <p>
            Depois de uma recusa, a cobrança é tentada de novo em{' '}
            <span className="tabular text-ink">
              {dunning.scheduleHours.map(humanizar).join(', ')}
            </span>
            . São {dunning.maxAttempts} tentativas ao todo; esgotadas, a fatura vira incobrável e a
            assinatura deixa de valer.
          </p>
          <p>
            Nas primeiras horas a causa mais provável é saldo momentâneo. Depois de um dia, é o
            cliente ainda não ter reparado. Depois de três, é decisão.
          </p>
          <p>
            Recusa definitiva, como um cartão cancelado, não volta para a fila. Insistir queima a
            relação com o cliente e ainda conta como tentativa fracassada para o adquirente.
          </p>
        </div>
      </Panel>

      <Panel
        title="Estornos"
        description="O estorno não apaga o pagamento: é um lançamento novo, e o razão guarda os dois."
      >
        {refunds.length === 0 ? (
          <EmptyState>Nenhum estorno concedido.</EmptyState>
        ) : (
          <Table
            headers={['Fatura', 'Cliente', { label: 'Valor', align: 'right' }, 'Motivo', 'Quando']}
          >
            {refunds.map((refund) => (
              <tr key={refund.id}>
                <Cell className="tabular">nº {refund.invoiceNumber}</Cell>
                <Cell className="text-[13px]">{refund.customerName}</Cell>
                <Cell className="tabular text-right whitespace-nowrap text-debit">
                  {refund.amount.replace('.', ',')} {refund.currency}
                </Cell>
                <Cell className="text-[13px] text-ink-muted">{refund.reason}</Cell>
                <Cell className="tabular text-[13px] text-ink-muted">
                  {formatDate(refund.createdAt)}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

/**
 * O histórico de tentativas, em miniatura.
 *
 * Um ponto por tentativa, na ordem, com o motivo da recusa no title. É o
 * suficiente para bater o olho e ver que houve três tentativas e a terceira
 * passou, sem precisar abrir nada.
 */
function Tentativas({ invoice }: { invoice: Invoice }) {
  if (invoice.payments.length === 0) {
    return <span className="text-[13px] text-ink-faint">nenhuma</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {invoice.payments.map((payment) => (
        <span
          key={payment.id}
          title={
            payment.status === 'SUCCEEDED'
              ? `Tentativa ${payment.attempt}: confirmada (${payment.gatewayRef ?? ''})`
              : payment.status === 'PENDING'
                ? `Tentativa ${payment.attempt}: sem resposta do provedor. ${payment.failureMessage ?? ''}`
                : `Tentativa ${payment.attempt}: ${payment.failureCode ?? 'recusada'}. ${payment.failureMessage ?? ''}`
          }
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            payment.status === 'SUCCEEDED'
              ? 'bg-credit'
              : payment.status === 'PENDING'
                ? 'bg-caution'
                : 'bg-debit'
          }`}
        />
      ))}
      <span className="ml-1 text-[12px] text-ink-faint">{invoice.payments.length}</span>
    </span>
  );
}

/** "1h", "1 dia", "3 dias", "7 dias". */
function humanizar(horas: number): string {
  if (horas < 24) {
    return `${horas}h`;
  }

  const dias = horas / 24;
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

/** Soma em centavos, com bigint, pelo motivo da ADR-0002. */
function somar(invoices: Invoice[]): string {
  const total = invoices.reduce((soma, invoice) => {
    const [inteiros = '0', decimais = '00'] = invoice.amount.split('.');
    return soma + BigInt(inteiros) * 100n + BigInt(decimais.padEnd(2, '0').slice(0, 2));
  }, 0n);

  return `${(total / 100n).toString()},${(total % 100n).toString().padStart(2, '0')}`;
}
