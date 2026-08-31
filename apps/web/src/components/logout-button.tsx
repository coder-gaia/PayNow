'use client';

import { logout } from '@/lib/actions';

export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="border border-rule px-3 py-1.5 text-sm text-ink-muted transition hover:border-rule-strong hover:text-ink"
      >
        Sair
      </button>
    </form>
  );
}
