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

  return (
    <button
      type="button"
      disabled={pending}
      className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
      onClick={() => {
        startTransition(async () => {
          const confirmed = await confirm({
            title: `Revogar "${name}"`,
            description:
              'Qualquer servidor que use esta chave perde o acesso na hora, e nao ha como reativa-la. A linha continua na lista para preservar a trilha de uso.',
            confirmLabel: 'Revogar',
          });

          if (!confirmed) {
            return;
          }

          const result = await revokeApiKey(organizationId, apiKeyId);

          if (result.error !== undefined) {
            toast.error(result.error);
            return;
          }

          toast.success(`A chave "${name}" foi revogada.`);
        });
      }}
    >
      {pending ? 'Revogando...' : 'Revogar'}
    </button>
  );
}
