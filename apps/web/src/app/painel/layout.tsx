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
 * O perfil é carregado aqui, no servidor, uma vez por navegação. As páginas
 * filhas resolvem a organização ativa pelo mesmo caminho, o que mantém a
 * escolha coerente entre o cabeçalho e o conteúdo.
 *
 * Toda falha de sessão sai por /sair, e não por um redirect direto para o
 * login. O motivo é que um Server Component não grava cookie: redirecionar
 * daqui deixaria o refresh token velho no navegador, e o middleware, vendo um
 * refresh token presente, mandaria de volta para o painel. O Route Handler
 * limpa os cookies antes de mandar para o login, o que fecha o laço.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let profile;

  try {
    profile = await api.profile();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect('/sair?motivo=expirada');
    }
    throw error;
  }

  const active = await resolveActiveOrganization(profile);
  const clock = await api.clock(active.id);

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:gap-x-6 sm:px-6">
          <Link href="/painel" className="font-display text-lg font-semibold">
            Paynow
          </Link>

          <OrganizationSwitcher organizations={profile.organizations} active={active} />

          <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
            <NavLink href="/painel">Visão geral</NavLink>
            <NavLink href="/painel/assinaturas">Assinaturas</NavLink>
            <NavLink href="/painel/faturas">Faturas</NavLink>
            <NavLink href="/painel/tempo">Tempo</NavLink>
            <NavLink href="/painel/ledger">Razão</NavLink>
            <NavLink href="/painel/membros">Membros</NavLink>
            <NavLink href="/painel/chaves">Chaves de API</NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{profile.name}</span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/*
        Com o relógio congelado, toda data na tela é virtual. Mostrar isso em
        todas as telas, e não só na do relógio, evita a leitura errada mais
        provável da demonstração: alguém abre o razão, vê uma fatura de daqui a
        três meses e conclui que o sistema criou dado do futuro sozinho.
      */}
      {clock.virtual && (
        <div className="border-b border-caution bg-caution-soft">
          <p className="mx-auto max-w-5xl px-4 py-2 text-[13px] sm:px-6">
            <span className="font-medium">Tempo congelado.</span> Esta organização está{' '}
            {clock.advancedDays} dia(s) à frente, em{' '}
            <span className="tabular">
              {new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'America/Sao_Paulo',
              }).format(new Date(clock.now))}
            </span>
            . Todas as datas abaixo seguem esse relógio.{' '}
            <Link href="/painel/tempo" className="underline underline-offset-2">
              Ajustar
            </Link>
          </p>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-5xl px-6 pb-10">
        <p className="border-t border-rule pt-4 font-mono text-[11px] text-ink-faint">
          Fase 08 de 09. Falta o endurecimento: limite de taxa, modelo de ameaças e deploy.
        </p>
      </footer>
    </div>
  );
}
