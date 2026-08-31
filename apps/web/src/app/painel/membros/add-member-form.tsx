'use client';

import { useActionState } from 'react';

import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { addMember, type FormState } from '@/lib/actions';
import type { OrganizationRole } from '@/lib/api';

/** Papeis que a pessoa pode conceder: nunca um igual ou superior ao proprio. */
const GRANTABLE: Record<string, OrganizationRole[]> = {
  OWNER: ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'],
  ADMIN: ['MEMBER', 'READONLY'],
};

export function AddMemberForm({
  organizationId,
  actorRole,
}: {
  organizationId: string;
  actorRole: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    addMember.bind(null, organizationId),
    {},
  );

  const roles = GRANTABLE[actorRole] ?? [];

  return (
    <form action={action} className="flex flex-col gap-4 px-5 py-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}
      {state.ok === true && <Alert tone="success">Membro adicionado.</Alert>}

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field label="Email">
          <Input name="email" type="email" required placeholder="bruno@livraria-aurora.test" />
        </Field>

        <Field label="Papel">
          <Select name="role" defaultValue={roles.at(-1) ?? 'READONLY'}>
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Adicionando...' : 'Adicionar'}
        </Button>
      </div>
    </form>
  );
}
