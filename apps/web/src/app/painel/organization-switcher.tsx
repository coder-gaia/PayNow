'use client';

import { useTransition } from 'react';

import { RolePill } from '@/components/ui';
import { selectOrganization } from '@/lib/actions';
import type { ActiveOrganization } from '@/lib/active-organization';

/**
 * Troca da organização ativa.
 *
 * Com uma única organização não há o que escolher, e um seletor de um item só
 * seria ruído: o nome aparece como texto. O controle só surge quando existe
 * escolha de verdade.
 */
export function OrganizationSwitcher({
  organizations,
  active,
}: {
  organizations: ActiveOrganization[];
  active: ActiveOrganization;
}) {
  const [pending, startTransition] = useTransition();

  if (organizations.length < 2) {
    return (
      <span className="flex items-center gap-2 border-l border-rule pl-4 text-sm">
        <span className="text-ink-muted">{active.name}</span>
        <RolePill role={active.role} />
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 border-l border-rule pl-4 text-sm">
      <select
        aria-label="Organização ativa"
        value={active.id}
        disabled={pending}
        onChange={(event) => {
          const chosen = event.target.value;
          startTransition(async () => {
            await selectOrganization(chosen);
          });
        }}
        className="border border-rule bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
      >
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.name}
          </option>
        ))}
      </select>
      <RolePill role={active.role} />
    </span>
  );
}
