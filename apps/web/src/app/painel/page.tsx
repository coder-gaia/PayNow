import Link from 'next/link';

import { formatDate, PageHeader, Panel, RolePill, Stat } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

export const metadata = { title: 'Visão geral · Paynow' };

export default async function OverviewPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);
  const [organization, subscriptions] = await Promise.all([
    api.organization(active.id),
    api.subscriptions(active.id),
  ]);

  const comAcesso = subscriptions.filter((subscription) => subscription.hasAccess).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Visão geral"
        title={organization.name}
        description={`Organização criada em ${formatDate(organization.createdAt)}. O identificador abaixo é o que a API usa nas rotas.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Assinaturas"
          value={subscriptions.length}
          hint={`${comAcesso} com acesso ao produto`}
        />
        <Stat
          label="Membros"
          value={organization.memberCount}
          hint="Pessoas com acesso ao painel"
        />
        <Stat
          label="Chaves de API"
          value={organization.apiKeyCount}
          hint="Incluindo as revogadas"
        />
        <Stat label="Seu papel" value={<RolePill role={active.role} />} />
      </div>

      <Panel title="Identificadores" description="O que a API espera receber nas rotas.">
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

      <Panel title="O que vem a seguir">
        <div className="space-y-3 px-5 py-4 text-sm text-ink-muted">
          <p>
            Até aqui: identidade na fase 01, o razão de partidas dobradas na fase 02 e o catálogo
            com assinaturas na fase 03. O painel cresce junto com o backend a cada fase.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Fase 04: linha do tempo arrastável, para simular meses em segundos</li>
            <li>Fase 05: cobranças, tentativas e recuperação</li>
            <li>Fase 06: webhooks com entrega garantida</li>
          </ul>
          <p>
            Enquanto isso, trocar o plano de uma{' '}
            <Link href="/painel/assinaturas" className="text-credit underline underline-offset-2">
              assinatura
            </Link>{' '}
            no meio do ciclo já escreve o rateio no{' '}
            <Link href="/painel/ledger" className="text-credit underline underline-offset-2">
              razão
            </Link>
            , onde saldo não é um campo: é a soma das linhas.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
      <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">{label}</dt>
      <dd className="font-mono text-[13px] break-all text-ink">{value}</dd>
    </div>
  );
}
