'use client';

import { useTransition } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { revokeApiKey } from '@/lib/actions';

export function RevokeApiKeyButton({
  organizationId,
  apiKeyId,
  name,
}: {
  organizationId: string;
  apiKeyId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const confirm = useConfirm();

  /**
   * A confirmação acontece fora da transição, e a transição começa só depois.
   *
   * Esperar a resposta de uma pessoa dentro de `startTransition` mantém a
   * transição pendente por tempo indefinido e, pior, transforma a abertura do
   * diálogo em uma atualização de baixa prioridade presa dentro da própria
   * transição que depende dela para terminar. O resultado é um botão travado
   * em "Revogando..." para sempre.
   *
   * Transição serve para cobrir o trabalho no servidor, e não a espera por um
   * clique.
   */
  const handleClick = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Revogar "${name}"`,
      description:
        'Qualquer servidor que use esta chave perde o acesso na hora, e não há como reativá-la. A linha continua na lista para preservar a trilha de uso.',
      confirmLabel: 'Revogar',
    });

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const result = await revokeApiKey(organizationId, apiKeyId);

      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(`A chave "${name}" foi revogada.`);
    });
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        void handleClick();
      }}
      className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
    >
      {pending ? 'Revogando...' : 'Revogar'}
    </button>
  );
}
