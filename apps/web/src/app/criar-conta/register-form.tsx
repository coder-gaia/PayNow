'use client';

import { useActionState } from 'react';

import { PasswordInput } from '@/components/password-input';
import { Field, Input } from '@/components/form';
import { Alert, Button } from '@/components/ui';
import { type FormState, register } from '@/lib/actions';

export function RegisterForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(register, {});

  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      {state.error !== undefined && <Alert tone="error">{state.error}</Alert>}

      <Field label="Seu nome">
        <Input name="name" autoComplete="name" required autoFocus minLength={2} />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>

      <Field label="Senha" hint="Ao menos 10 caracteres. Não há regra de composição.">
        <PasswordInput name="password" autoComplete="new-password" required minLength={10} />
      </Field>

      <Field label="Nome da organização">
        <Input name="organizationName" required minLength={2} placeholder="Livraria Aurora" />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Criando...' : 'Criar conta'}
      </Button>
    </form>
  );
}
