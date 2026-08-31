'use client';

import { useActionState, useState } from 'react';

import { Field, Input, Select } from '@/components/form';
import { Alert, Button } from '@/components/ui';
import { createApiKey, type FormState } from '@/lib/actions';

export function CreateApiKeyForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createApiKey.bind(null, organizationId),
    {},
  );

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}
      {state.secret !== undefined && <SecretReveal secret={state.secret} />}

      <form action={action} className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field label="Nome">
          <Input name="name" required minLength={2} placeholder="Servidor de producao" />
        </Field>

        <Field label="Ambiente">
          <Select name="environment" defaultValue="TEST">
            <option value="TEST">TEST</option>
            <option value="LIVE">LIVE</option>
          </Select>
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Criando...' : 'Criar chave'}
        </Button>
      </form>
    </div>
  );
}

/**
 * Exibicao do segredo recem criado.
 *
 * Aparece uma única vez porque o servidor guarda apenas o hash: nem o painel
 * nem a API conseguem recuperar o valor depois. O aviso e explicito para que
 * ninguém feche a tela achando que da para voltar.
 */
function SecretReveal({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Alert tone="success">
      <p className="font-medium">Chave criada. Copie agora.</p>
      <p className="mt-1 text-[13px] text-ink-muted">
        Este valor não aparece de novo: o servidor guarda apenas o hash.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 border border-rule bg-surface px-3 py-2 font-mono text-[13px] break-all">
          {secret}
        </code>
        <button
          type="button"
          className="border border-rule-strong px-3 py-2 text-[13px] transition hover:bg-surface-sunken"
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            });
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </Alert>
  );
}
