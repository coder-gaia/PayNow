import Link from 'next/link';

import { formatDate, PageHeader, Panel, RolePill, Stat } from '@/components/ui';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api } from '@/lib/api';

export const metadata = { title: 'Visao geral · Paynow' };

export default async function OverviewPage() {
  const profile = await api.profile();
  const active = await resolveActiveOrganization(profile);
  const organization = await api.organization(active.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Visao geral"
        title={organization.name}
        description={`Organização criada em ${formatDate(organization.createdAt)}. O identificador abaixo é o que a API usa nas rotas.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Membros" value={organization.memberCount} hint="Pessoas com acesso" />
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
            Até aqui: identidade na fase 01 e o razão de partidas dobradas na fase 02. O painel
            cresce junto com o backend a cada fase.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Fase 03: planos, preços e assinaturas</li>
            <li>Fase 04: linha do tempo arrastavel, para simular meses em segundos</li>
            <li>Fase 05: cobranças, tentativas e recuperação</li>
          </ul>
          <p>
            Enquanto isso, o{' '}
            <Link href="/painel/ledger" className="text-credit underline underline-offset-2">
              razão
            </Link>{' '}
            já mostra a decisão central do projeto: saldo não é um campo, é a soma das linhas.
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
