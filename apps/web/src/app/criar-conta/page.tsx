import Link from 'next/link';

import { RegisterForm } from './register-form';

export const metadata = { title: 'Criar conta · Paynow' };

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="border-b-2 border-ink pb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-credit">Paynow</p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Criar conta</h1>
        <p className="mt-2 text-sm text-ink-muted">
          A conta e a primeira organizacao nascem na mesma transacao: nao existe conta sem
          organizacao.
        </p>
      </div>

      <RegisterForm />

      <p className="mt-6 text-sm text-ink-muted">
        Ja tem conta?{' '}
        <Link href="/entrar" className="text-credit underline underline-offset-2">
          Entrar
        </Link>
      </p>
    </main>
  );
}
