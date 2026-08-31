'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Link de navegacao que se marca como ativo pela rota atual. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === '/painel' ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`border-b-2 px-2 py-1 transition ${
        active
          ? 'border-credit text-ink'
          : 'border-transparent text-ink-muted hover:border-rule-strong hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
