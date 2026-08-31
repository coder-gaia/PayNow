import type { ComponentProps, ReactNode } from 'react';

import type { OrganizationRole } from '@/lib/api';

/**
 * Peças visuais compartilhadas.
 *
 * O painel é um instrumento de leitura antes de ser um formulário: quem abre
 * está conferindo estado. Por isso o kit privilegia densidade legível, rótulos
 * em monoespaçada e régua fina, e não cartões arredondados com sombra.
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-credit">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-balance">
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}

export function Panel({
  title,
  description,
  children,
  action,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border border-rule bg-surface">
      {title !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            {description !== undefined && (
              <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border border-rule bg-surface px-5 py-4">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="tabular mt-2 font-display text-2xl font-semibold">{value}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

const ROLE_STYLE: Record<OrganizationRole, string> = {
  OWNER: 'border-credit text-credit bg-credit-soft',
  ADMIN: 'border-rule-strong text-ink bg-surface-sunken',
  MEMBER: 'border-rule text-ink-muted bg-surface',
  READONLY: 'border-rule text-ink-faint bg-surface',
};

export function RolePill({ role }: { role: OrganizationRole }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 font-mono text-[10.5px] tracking-[0.08em] ${ROLE_STYLE[role]}`}
    >
      {role}
    </span>
  );
}

/**
 * Estado da assinatura.
 *
 * A cor segue a mesma leitura do resto do painel: verde é dinheiro entrando,
 * vermelho é dinheiro que não entrou, âmbar é decisão pendente. PAST_DUE fica
 * em âmbar de propósito, e não em vermelho: a assinatura ainda dá acesso, e
 * pintar de vermelho sugeriria que o acesso acabou.
 */
const SUBSCRIPTION_STYLE: Record<string, string> = {
  ACTIVE: 'border-credit text-credit bg-credit-soft',
  TRIALING: 'border-rule-strong text-ink bg-surface-sunken',
  INCOMPLETE: 'border-caution text-ink bg-caution-soft',
  PAST_DUE: 'border-caution text-ink bg-caution-soft',
  CANCELED: 'border-rule text-ink-faint bg-surface',
  UNPAID: 'border-debit text-debit bg-debit-soft',
};

const SUBSCRIPTION_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  TRIALING: 'Em teste',
  INCOMPLETE: 'Aguardando pagamento',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Cancelada',
  UNPAID: 'Não paga',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 font-mono text-[10.5px] tracking-[0.08em] ${
        SUBSCRIPTION_STYLE[status] ?? 'border-rule text-ink-muted bg-surface'
      }`}
      title={status}
    >
      {SUBSCRIPTION_LABEL[status] ?? status}
    </span>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-credit text-paper border-credit hover:opacity-90',
    secondary: 'bg-surface text-ink border-rule-strong hover:bg-surface-sunken',
    danger: 'bg-surface text-debit border-debit hover:bg-debit-soft',
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'caution';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-debit bg-debit-soft text-ink',
    success: 'border-credit bg-credit-soft text-ink',
    caution: 'border-caution bg-caution-soft text-ink',
  }[tone];

  return (
    <div role="status" className={`border-l-2 px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-ink-muted">{children}</p>;
}

/**
 * Cabeçalho de coluna.
 *
 * Coluna de número alinha à direita, e o rótulo precisa alinhar junto: título
 * à esquerda com valor à direita faz o olho procurar a que coluna cada número
 * pertence, que é exatamente o trabalho que uma tabela deveria poupar.
 */
export type Header = string | { label: string; align: 'right' };

const headerLabel = (header: Header): string =>
  typeof header === 'string' ? header : header.label;

const headerAlign = (header: Header): string =>
  typeof header === 'string' ? 'text-left' : 'text-right';

export function Table({ headers, children }: { headers: Header[]; children: ReactNode }) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[30rem] text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={headerLabel(header)}
                className={`border-b border-rule-strong px-3 py-2.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-ink-faint uppercase sm:px-5 ${headerAlign(header)}`}
              >
                {headerLabel(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({
  className = '',
  children = null,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <td className={`border-b border-rule px-3 py-3 align-middle sm:px-5 ${className}`}>
      {children}
    </td>
  );
}

/** Data no formato brasileiro, sem hora, que é o que o painel precisa mostrar. */
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value));
}
