'use client';

import { useActionState, useEffect, useRef } from 'react';

import { useToast } from '@/components/toast';
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
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  // O membro adicionado aparece na tabela acima, fora do campo de visao de quem
  // acabou de digitar aqui, entao a confirmacao vira toast. O erro fica no
  // formulario, que e onde o email errado sera corrigido.
  useEffect(() => {
    if (state.ok === true) {
      toast.success('Membro adicionado.');
      formRef.current?.reset();
    }
  }, [state, toast]);

  const roles = GRANTABLE[actorRole] ?? [];

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4 px-5 py-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

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
