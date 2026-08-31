'use client';

import { type ComponentProps, useState } from 'react';

import { useFieldControlProps } from './form';

/**
 * Campo de senha com alternância de visibilidade.
 *
 * Poder conferir o que foi digitado reduz erro de digitacao, e em senha longa,
 * que é o que a política do Paynow incentiva, isso pesa mais do que o risco de
 * alguém ler a tela por cima do ombro. Começa sempre oculto, e o estado nunca
 * persiste entre carregamentos.
 *
 * O botão fica dentro do campo, mas fora do fluxo de digitacao: `tabIndex={-1}`
 * evita que o Tab pare nele no meio do preenchimento do formulário. Ainda é
 * alcançável por clique e por navegação de leitor de tela.
 *
 * O estado visível é anunciado pelo `aria-pressed` do próprio botão. Uma
 * primeira versão tinha um texto de status ao lado, mas ele ficava dentro do
 * `<label>` do campo é passava a fazer parte do nome acessivel do input, que
 * virava "Senha A senha está oculta". O teste de interface pegou.
 */
export function PasswordInput({ className = '', ...props }: ComponentProps<'input'>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...useFieldControlProps()}
        {...props}
        type={visible ? 'text' : 'password'}
        className={`w-full border border-rule-strong bg-surface py-2 pr-11 pl-3 text-sm text-ink placeholder:text-ink-faint ${className}`}
      />

      <button
        type="button"
        tabIndex={-1}
        aria-pressed={visible}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        onClick={() => {
          setVisible((current) => !current);
        }}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint transition hover:text-ink"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.9 5.5A8.6 8.6 0 0 1 12 5.2c6.5 0 10.2 6.8 10.2 6.8a17 17 0 0 1-3.1 4" />
      <path d="M6.3 7.4A16.7 16.7 0 0 0 1.8 12S5.5 18.8 12 18.8c1.8 0 3.4-.5 4.7-1.2" />
      <path d="m10 10.2a2.6 2.6 0 0 0 3.7 3.7" />
      <path d="m3.5 3.5 17 17" />
    </svg>
  );
}
