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
import { api, type Price, type Subscription } from '@/lib/api';

import { SubscriptionActions } from './subscription-actions';

export const metadata = { title: 'Assinaturas · Paynow' };

export type PlanOption = Price & { product: string };

/**
 * Assinaturas da organização.
 *
 * A tela mostra a máquina de estados em funcionamento, e não apenas uma lista.
 * Cada linha diz em que estado a assinatura está, se esse estado dá acesso ao
 * produto e quando o ciclo atual termina. Os três juntos respondem à pergunta
 * que o suporte faz todo dia: "esta pessoa pode usar o sistema agora?".
 *
 * A troca de plano é a operação interessante daqui. O rateio é calculado no
 * servidor e volta para a tela, que o mostra em vez de escondê-lo: quem trocou
 * de plano tem direito de ver quanto foi creditado e quanto foi cobrado.
 */
export default async function SubscriptionsPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);

  const [subscriptions, products] = await Promise.all([
    api.subscriptions(active.id),
    api.products(active.id),
  ]);

  // O seletor de plano precisa do preço com o nome do produto junto, porque
  // "R$ 100,00 por mês" não diz a ninguém de que plano se trata.
  const planos: PlanOption[] = products.flatMap((product) =>
    product.prices
      .filter((price) => price.active)
      .map((price) => ({ ...price, product: product.name })),
  );

  const comAcesso = subscriptions.filter((subscription) => subscription.hasAccess).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Cobrança"
        title="Assinaturas"
        description="Trocar de plano no meio do ciclo credita o que não foi usado do plano antigo e cobra o proporcional do novo, no mesmo lançamento contábil."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Assinaturas" value={subscriptions.length} />
        <Stat
          label="Com acesso"
          value={comAcesso}
          hint="Inclui teste e atraso: quem está em atraso ainda usa o produto."
        />
        <Stat
          label="Receita recorrente"
          value={somarAtivas(subscriptions)}
          hint="Soma dos planos que estão ativos ou em teste."
        />
      </div>

      <Panel
        title="Carteira"
        description="O estado vem da máquina de transições, e não de um campo editável: só as mudanças declaradas como possíveis são aceitas."
      >
        {subscriptions.length === 0 ? (
          <EmptyState>
            Nenhuma assinatura ainda. Rode <span className="font-mono">pnpm db:seed</span> para
            carregar a carteira de demonstração.
          </EmptyState>
        ) : (
          <Table
            headers={[
              'Cliente',
              'Plano',
              'Estado',
              'Ciclo atual',
              { label: 'Ações', align: 'right' },
            ]}
          >
            {subscriptions.map((subscription) => (
              <tr key={subscription.id}>
                <Cell>
                  <span className="block font-medium">{subscription.customer.name}</span>
                  <span className="block text-[13px] text-ink-muted">
                    {subscription.customer.email}
                  </span>
                </Cell>

                <Cell>
                  <span className="block text-[13px]">{subscription.plan.product}</span>
                  <span className="tabular block text-[13px] text-ink-muted">
                    {subscription.plan.amount.replace('.', ',')} {subscription.plan.currency} por{' '}
                    {intervalo(subscription.plan.interval)}
                  </span>
                </Cell>

                <Cell>
                  <StatusPill status={subscription.status} />
                  {subscription.cancelAtPeriodEnd && (
                    <span className="mt-1 block text-[12px] text-ink-muted">
                      encerra no fim do ciclo
                    </span>
                  )}
                </Cell>

                <Cell className="tabular text-[13px] text-ink-muted">
                  {formatDate(subscription.currentPeriodStart)} a{' '}
                  {formatDate(subscription.currentPeriodEnd)}
                  {subscription.trialEndsAt !== null && (
                    <span className="block text-ink-faint">
                      teste até {formatDate(subscription.trialEndsAt)}
                    </span>
                  )}
                </Cell>

                <Cell>
                  <SubscriptionActions
                    organizationId={active.id}
                    subscription={subscription}
                    plans={planos}
                  />
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Planos publicados"
        description="Preço é imutável: mudar de valor cria outro preço e migra as assinaturas."
      >
        {planos.length === 0 ? (
          <EmptyState>Nenhum plano cadastrado.</EmptyState>
        ) : (
          <Table headers={['Produto', { label: 'Valor', align: 'right' }, 'Intervalo', 'Teste']}>
            {planos.map((plano) => (
              <tr key={plano.id}>
                <Cell className="font-medium">{plano.product}</Cell>
                <Cell className="tabular text-right whitespace-nowrap">
                  {plano.amount.replace('.', ',')} {plano.currency}
                </Cell>
                <Cell className="text-[13px] text-ink-muted">
                  {plano.intervalCount > 1 ? `a cada ${plano.intervalCount} ` : 'a cada '}
                  {intervalo(plano.interval, plano.intervalCount)}
                </Cell>
                <Cell className="tabular text-[13px] text-ink-muted">
                  {plano.trialDays === 0 ? 'sem teste' : `${plano.trialDays} dias`}
                </Cell>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

const INTERVALO: Record<string, readonly [string, string]> = {
  DAY: ['dia', 'dias'],
  WEEK: ['semana', 'semanas'],
  MONTH: ['mês', 'meses'],
  YEAR: ['ano', 'anos'],
};

function intervalo(interval: string, count = 1): string {
  const forma = INTERVALO[interval];

  if (forma === undefined) {
    return interval.toLowerCase();
  }

  return count > 1 ? forma[1] : forma[0];
}

/**
 * Receita recorrente das assinaturas que estão rendendo.
 *
 * Cancelada e expirada ficam de fora porque não geram mais cobrança, e
 * INCOMPLETE fica de fora porque o primeiro pagamento ainda não confirmou:
 * contar dinheiro que talvez nunca entre é como um painel começa a mentir.
 *
 * A soma é feita em centavos, com bigint, pelo mesmo motivo da ADR-0002.
 */
function somarAtivas(subscriptions: Subscription[]): string {
  const total = subscriptions
    .filter(
      (subscription) => subscription.status === 'ACTIVE' || subscription.status === 'TRIALING',
    )
    .reduce((soma, subscription) => soma + paraCentavos(subscription.plan.amount), 0n);

  const inteiros = total / 100n;
  const centavos = (total % 100n).toString().padStart(2, '0');

  return `${inteiros.toString()},${centavos}`;
}

/** "129.90" vira 12990n, sem passar por ponto flutuante em momento nenhum. */
function paraCentavos(amount: string): bigint {
  const [inteiros = '0', decimais = '00'] = amount.split('.');
  return BigInt(inteiros) * 100n + BigInt(decimais.padEnd(2, '0').slice(0, 2));
}
