'use client';

import { useOptimistic, useTransition } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { Select } from '@/components/form';
import { changeMemberRole, removeMember } from '@/lib/actions';
import type { Member, OrganizationRole } from '@/lib/api';

const ROLES: OrganizationRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'];

/**
 * Ações por membro.
 *
 * A interface deixa tentar ações que o servidor pode recusar, como rebaixar o
 * último OWNER. Isso é deliberado: a regra vive no backend, e esconder o
 * controle aqui criaria uma segunda copia da regra que pode divergir da
 * primeira.
 *
 * O papel exibido usa `useOptimistic` justamente por causa disso. Um `<select>`
 * não controlado guardaria o valor que a pessoa escolheu mesmo depois de o
 * servidor recusar a mudança, e a tela passaria a mostrar um papel que não
 * existe no banco. Com estado otimista, o valor aparece na hora e volta
 * sozinho para o dado real quando a transição termina, tenha ela dado certo
 * ou não.
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

      toast.success(`${member.name} agora é ${next}.`);
    });
  };

  /**
   * A confirmação fica fora da transição. Esperar a resposta de uma pessoa
   * dentro de `startTransition` prende a transição por tempo indefinido e
   * torna a abertura do diálogo uma atualização presa dentro da própria
   * transição que depende dela para terminar. Transição cobre o trabalho no
   * servidor, não a espera por um clique.
   */
  const handleRemove = async (): Promise<void> => {
    const confirmed = await confirm(
      isSelf
        ? {
            title: 'Sair da organização',
            description:
              'Você perde o acesso a esta organização. Para voltar, alguém precisará te adicionar de novo.',
            confirmLabel: 'Sair',
          }
        : {
            title: `Remover ${member.name}`,
            description: `${member.email} perde o acesso a esta organização imediatamente.`,
            confirmLabel: 'Remover',
          },
    );

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await removeMember(organizationId, member.userId);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(isSelf ? 'Você saiu da organização.' : `${member.name} foi removida.`);
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
        onClick={() => {
          void handleRemove();
        }}
        className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
      >
        {isSelf ? 'Sair' : 'Remover'}
      </button>
    </div>
  );
}
