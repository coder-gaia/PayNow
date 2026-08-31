'use client';

import { type ComponentProps, createContext, type ReactNode, useContext, useId } from 'react';

/**
 * Campos de formulario.
 *
 * O rotulo se liga ao controle por `htmlFor`, e não envolvendo-o. A diferença
 * parece cosmetica e não e: quando um campo tem adorno interno, como o botão
 * de revelar senha, envolver faz o nome acessivel do input virar a soma de
 * tudo que está dentro do rotulo. O campo de senha era anunciado como
 * "Senha Mostrar senha".
 *
 * O identificador é gerado uma vez pelo `Field` e distribuido por contexto,
 * para que nenhum ponto de uso precise inventar e casar ids na mão.
 */

interface FieldContextValue {
  readonly id: string;
  readonly describedBy: string | undefined;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Propriedades de acessibilidade que o controle herda do `Field` que o contém.
 *
 * Fora de um `Field`, devolve nada: um controle solto, como o seletor de papel
 * dentro da tabela de membros, carrega o próprio `aria-label`.
 */
export function useFieldControlProps(): { id?: string; 'aria-describedby'?: string } {
  const field = useContext(FieldContext);

  if (field === null) {
    return {};
  }

  return {
    id: field.id,
    ...(field.describedBy === undefined ? {} : { 'aria-describedby': field.describedBy }),
  };
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const describedBy = hint === undefined ? undefined : `${id}-hint`;

  return (
    <div>
      <label
        htmlFor={id}
        className="block font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint"
      >
        {label}
      </label>

      <FieldContext.Provider value={{ id, describedBy }}>
        <div className="mt-1.5">{children}</div>
      </FieldContext.Provider>

      {hint !== undefined && (
        <p id={describedBy} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return (
    <input
      {...useFieldControlProps()}
      {...props}
      className={`w-full border border-rule-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint ${className}`}
    />
  );
}

export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...useFieldControlProps()}
      {...props}
      className={`w-full border border-rule-strong bg-surface px-3 py-2 text-sm text-ink ${className}`}
    />
  );
}
