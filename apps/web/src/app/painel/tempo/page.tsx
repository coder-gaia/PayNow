import { EmptyState, PageHeader, Panel, Stat, StatusPill } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

import { ClockControls } from './clock-controls';

export const metadata = { title: 'Tempo · Paynow' };

/**
 * Controle do tempo.
 *
 * Esta tela é o segundo pilar do projeto ficando visível. Cobrança recorrente
 * é um domínio onde quase tudo que importa acontece na passagem do tempo, e
 * demonstrar isso normalmente exige esperar. Aqui o tempo é congelado por
 * organização e anda por comando, então um ano de ciclos cabe em alguns
 * cliques, contra o banco de verdade e pelo mesmo caminho de código que a
 * produção usa.
 *
 * O que a tela deixa explícito, e que é a parte que interessa numa conversa
 * técnica: adiantar o relógio não muda só a data. Ele liquida o que venceu, o
 * que emite fatura, o que escreve no razão. A resposta do avanço traz a lista
 * do que aconteceu.
 */
export default async function TempoPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);

  const [clock, subscriptions] = await Promise.all([
    api.clock(active.id),
    api.subscriptions(active.id),
  ]);

  const agora = new Date(clock.now);

  // A próxima virada é a data mais próxima no futuro entre os fins de ciclo.
  // Mostrá-la evita o avanço às cegas: dá para pular exatamente até a véspera
  // de alguma coisa acontecer.
  const proxima = subscriptions
    .filter((subscription) => subscription.status !== 'CANCELED')
    .map((subscription) => new Date(subscription.currentPeriodEnd))
    .filter((data) => data.getTime() > agora.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const diasAteAProxima =
    proxima === undefined
      ? null
      : Math.ceil((proxima.getTime() - agora.getTime()) / (24 * 60 * 60 * 1000));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Relógio"
        title="Linha do tempo"
        description="Congelar o tempo desta organização e adiantá-lo por comando. Nada aqui é simulação: o avanço roda o ciclo de cobrança de verdade, emite as faturas e escreve no razão."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Relógio"
          value={clock.virtual ? 'Congelado' : 'De parede'}
          hint={
            clock.virtual
              ? 'O tempo só anda quando você mandar.'
              : 'Segue o relógio real do servidor.'
          }
        />
        <Stat
          label="Agora, para esta organização"
          value={formatarInstante(agora)}
          hint={clock.virtual ? `${clock.advancedDays} dia(s) adiantados` : 'Horário do servidor'}
        />
        <Stat
          label="Próxima virada de ciclo"
          value={diasAteAProxima === null ? 'nenhuma' : `em ${diasAteAProxima} dia(s)`}
          hint={
            proxima === undefined
              ? 'Nenhuma assinatura com ciclo em aberto.'
              : formatarInstante(proxima)
          }
        />
      </div>

      <ClockControls organizationId={active.id} clock={clock} daysToNextRenewal={diasAteAProxima} />

      <Panel
        title="Como isso está implementado"
        description="A pergunta que esta tela costuma provocar."
      >
        <div className="space-y-3 px-5 py-4 text-sm text-ink-muted">
          <p>
            O instante é resolvido uma vez na borda do request e guardado em um escopo de{' '}
            <span className="font-mono text-[13px]">AsyncLocalStorage</span>. Todo código chamado
            dentro dele enxerga a mesma hora sem receber parâmetro nenhum, então nenhuma assinatura
            de método precisou mudar para o relógio virtual existir.
          </p>
          <p>
            O tempo é <span className="font-medium text-ink">congelado</span>, e não deslocado. Um
            deslocamento somado ao relógio real continua andando sozinho, e a mesma sequência de
            comandos produziria históricos diferentes. Congelado, ela produz sempre a mesma
            história, que é o que torna a suíte adversarial possível.
          </p>
          <p>
            O congelamento vale só para esta organização. As outras seguem no relógio de parede.
          </p>
        </div>
      </Panel>

      <Panel title="Ciclos em aberto" description="O que o próximo avanço vai encontrar vencido.">
        {subscriptions.length === 0 ? (
          <EmptyState>Nenhuma assinatura para acompanhar.</EmptyState>
        ) : (
          <ul className="divide-y divide-rule">
            {subscriptions.map((subscription) => {
              const fim = new Date(subscription.currentPeriodEnd);
              const vencido = fim.getTime() <= agora.getTime();

              return (
                <li
                  key={subscription.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-3 sm:px-5"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <StatusPill status={subscription.status} />
                    <span className="font-medium">{subscription.customer.name}</span>
                    <span className="text-ink-muted">{subscription.plan.product}</span>
                  </span>
                  <span
                    className={`tabular text-[13px] whitespace-nowrap ${
                      vencido && subscription.status !== 'CANCELED'
                        ? 'text-caution'
                        : 'text-ink-muted'
                    }`}
                  >
                    {vencido && subscription.status !== 'CANCELED' ? 'venceu em ' : 'vence em '}
                    {formatarInstante(fim)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function formatarInstante(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(data);
}
