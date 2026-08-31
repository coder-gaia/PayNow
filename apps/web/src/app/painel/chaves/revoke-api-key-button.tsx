'use client';

import { useTransition } from 'react';

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

  return (
    <button
      type="button"
      disabled={pending}
      className="border border-rule px-2 py-1 text-[13px] text-debit transition hover:border-debit disabled:opacity-50"
      onClick={() => {
        if (!window.confirm(`Revogar a chave "${name}"? Isso nao tem volta.`)) {
          return;
        }

        startTransition(async () => {
          const result = await revokeApiKey(organizationId, apiKeyId);
          if (result.error !== undefined) {
            window.alert(result.error);
          }
        });
      }}
    >
      {pending ? 'Revogando...' : 'Revogar'}
    </button>
  );
}
