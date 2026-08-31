'use client';

import { useTransition } from 'react';

import { Select } from '@/components/ui';
import { changeMemberRole, removeMember } from '@/lib/actions';
import type { Member, OrganizationRole } from '@/lib/api';

const ROLES: OrganizationRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'];

/**
 * Acoes por membro.
 *
 * A interface deixa tentar acoes que o servidor pode recusar, como rebaixar o
 * ultimo OWNER. Isso e deliberado: a regra vive no backend, e esconder o botao
 * aqui criaria uma segunda copia da regra que pode divergir. O erro volta e e
 * mostrado.
 */
export function MemberActions({
  organizationId,
  member,
  isSelf,
}: {
  organizationId: string;
  member: Member;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-2">
      <Select
        aria-label={`Papel de ${member.name}`}
        defaultValue={member.role}
        disabled={pending}
        className="w-auto py-1 text-[13px]"
        onChange={(event) => {
          const role = event.target.value as OrganizationRole;
          startTransition(async () => {
            const result = await changeMemberRole(organizationId, member.userId, role);
            if (result.error !== undefined) {
              window.alert(result.error);
            }
          });
        }}
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </Select>

      <button
        type="button"
        disabled={pending}
        className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
        onClick={() => {
          const question = isSelf
            ? 'Sair desta organizacao?'
            : `Remover ${member.name} da organizacao?`;

          if (!window.confirm(question)) {
            return;
          }

          startTransition(async () => {
            const result = await removeMember(organizationId, member.userId);
            if (result.error !== undefined) {
              window.alert(result.error);
            }
          });
        }}
      >
        {isSelf ? 'Sair' : 'Remover'}
      </button>
    </div>
  );
}
