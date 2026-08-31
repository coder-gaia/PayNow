'use client';

import { useActionState } from 'react';

import { Alert, Button, Field, Input } from '@/components/ui';
import { type FormState, login } from '@/lib/actions';

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});

  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      {expired && (
        <Alert tone="caution">
          A sessao expirou ou foi encerrada por seguranca. Entre novamente.
        </Alert>
      )}

      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>

      <Field label="Senha">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );
}
