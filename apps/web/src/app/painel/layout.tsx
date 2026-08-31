import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { LogoutButton } from '@/components/logout-button';
import { RolePill } from '@/components/ui';
import { api, UnauthenticatedError } from '@/lib/api';

import { NavLink } from './nav-link';

/**
 * Casca do painel.
 *
 * O perfil e carregado aqui, no servidor, uma vez por navegacao, e as paginas
 * filhas recebem a organizacao ativa pelo caminho. Isso evita que cada tela
 * repita a mesma consulta.
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

  const active = profile.organizations[0];

  if (active === undefined) {
    // Nao deveria acontecer: cadastro sempre cria a primeira organizacao.
    redirect('/entrar');
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href="/painel" className="font-display text-lg font-semibold">
            Paynow
          </Link>

          <span className="flex items-center gap-2 border-l border-rule pl-4 text-sm">
            <span className="text-ink-muted">{active.name}</span>
            <RolePill role={active.role} />
          </span>

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
