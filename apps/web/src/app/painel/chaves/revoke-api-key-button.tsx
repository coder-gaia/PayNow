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
   * A confirmacao acontece fora da transicao, e a transicao comeca so depois.
   *
   * Esperar a resposta de uma pessoa dentro de `startTransition` mantem a
   * transicao pendente por tempo indefinido e, pior, transforma a abertura do
   * dialogo em uma atualizacao de baixa prioridade presa dentro da propria
   * transicao que depende dela para terminar. O resultado e um botao travado
   * em "Revogando..." para sempre.
   *
   * Transicao serve para cobrir o trabalho no servidor, e nao a espera por um
   * clique.
   */
  const handleClick = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Revogar "${name}"`,
      description:
        'Qualquer servidor que use esta chave perde o acesso na hora, e nao ha como reativa-la. A linha continua na lista para preservar a trilha de uso.',
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
