import Link from 'next/link';

import { LoginForm } from './login-form';

export const metadata = { title: 'Entrar · Paynow' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sessao?: string }>;
}) {
  const { sessao } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="border-b-2 border-ink pb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-credit">Paynow</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Entrar no painel</h1>
      </div>

      <LoginForm expired={sessao === 'expirada'} />

      <p className="mt-6 text-sm text-ink-muted">
        Ainda nao tem conta?{' '}
        <Link href="/criar-conta" className="text-credit underline underline-offset-2">
          Criar uma agora
        </Link>
      </p>

      <div className="mt-10 border border-rule bg-surface px-4 py-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          Conta de demonstracao
        </p>
        <p className="mt-2 font-mono text-[13px] text-ink">ana@livraria-aurora.test</p>
        <p className="font-mono text-[13px] text-ink">paynow-demo-2026</p>
        <p className="mt-2 text-xs text-ink-muted">
          Criada por <span className="font-mono">pnpm db:seed</span>. Ha uma conta para cada papel.
        </p>
      </div>
    </main>
  );
}
