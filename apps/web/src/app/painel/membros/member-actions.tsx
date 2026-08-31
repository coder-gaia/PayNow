'use client';

import { useOptimistic, useTransition } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { Select } from '@/components/ui';
import { changeMemberRole, removeMember } from '@/lib/actions';
import type { Member, OrganizationRole } from '@/lib/api';

const ROLES: OrganizationRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'];

/**
 * Acoes por membro.
 *
 * A interface deixa tentar acoes que o servidor pode recusar, como rebaixar o
 * ultimo OWNER. Isso e deliberado: a regra vive no backend, e esconder o
 * controle aqui criaria uma segunda copia da regra que pode divergir da
 * primeira.
 *
 * O papel exibido usa `useOptimistic` justamente por causa disso. Um `<select>`
 * nao controlado guardaria o valor que a pessoa escolheu mesmo depois de o
 * servidor recusar a mudanca, e a tela passaria a mostrar um papel que nao
 * existe no banco. Com estado otimista, o valor aparece na hora e volta
 * sozinho para o dado real quando a transicao termina, tenha ela dado certo
 * ou nao.
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
  const [role, setOptimisticRole] = useOptimistic(member.role);
  const toast = useToast();
  const confirm = useConfirm();

  const handleRoleChange = (next: OrganizationRole) => {
    if (next === member.role) {
      return;
    }

    startTransition(async () => {
      setOptimisticRole(next);
      const result = await changeMemberRole(organizationId, member.userId, next);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(`${member.name} agora e ${next}.`);
    });
  };

  const handleRemove = () => {
    startTransition(async () => {
      const confirmed = await confirm(
        isSelf
          ? {
              title: 'Sair da organizacao',
              description:
                'Voce perde o acesso a esta organizacao. Para voltar, alguem precisara te adicionar de novo.',
              confirmLabel: 'Sair',
            }
          : {
              title: `Remover ${member.name}`,
              description: `${member.email} perde o acesso a esta organizacao imediatamente.`,
              confirmLabel: 'Remover',
            },
      );

      if (!confirmed) {
        return;
      }

      const result = await removeMember(organizationId, member.userId);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(isSelf ? 'Voce saiu da organizacao.' : `${member.name} foi removida.`);
    });
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <Select
        aria-label={`Papel de ${member.name}`}
        value={role}
        disabled={pending}
        className="w-auto py-1 text-[13px]"
        onChange={(event) => {
          handleRoleChange(event.target.value as OrganizationRole);
        }}
      >
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>

      <button
        type="button"
        disabled={pending}
        onClick={handleRemove}
        className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
      >
        {isSelf ? 'Sair' : 'Remover'}
      </button>
    </div>
  );
}
