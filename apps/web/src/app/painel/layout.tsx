import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { LogoutButton } from '@/components/logout-button';
import { resolveActiveOrganization } from '@/lib/active-organization';
import { api, UnauthenticatedError } from '@/lib/api';

import { NavLink } from './nav-link';
import { OrganizationSwitcher } from './organization-switcher';

/**
 * Casca do painel.
 *
 * O perfil e carregado aqui, no servidor, uma vez por navegacao. As paginas
 * filhas resolvem a organizacao ativa pelo mesmo caminho, o que mantem a
 * escolha coerente entre o cabecalho e o conteudo.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let profile;

  try {
    profile = await api.profile();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect('/entrar?sessao=expirada');
    }
    throw error;
  }

  const active = await resolveActiveOrganization(profile);

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href="/painel" className="font-display text-lg font-semibold">
            Paynow
          </Link>

          <OrganizationSwitcher organizations={profile.organizations} active={active} />

          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/painel">Visao geral</NavLink>
            <NavLink href="/painel/membros">Membros</NavLink>
            <NavLink href="/painel/chaves">Chaves de API</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{profile.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>

      <footer className="mx-auto max-w-5xl px-6 pb-10">
        <p className="border-t border-rule pt-4 font-mono text-[11px] text-ink-faint">
          Fase 01 de 09. As telas de ledger, assinaturas e cobranca chegam nas fases seguintes.
        </p>
      </footer>
    </div>
  );
}
