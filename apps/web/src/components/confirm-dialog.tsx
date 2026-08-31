'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from './ui';

/**
 * Confirmacao de acao destrutiva.
 *
 * Substitui `window.confirm`, que trava a aba inteira, nao aceita estilo e nao
 * deixa distinguir uma remocao de uma revogacao definitiva.
 *
 * Usa o elemento `<dialog>` nativo com `showModal()`, que ja traz de graca o
 * que uma implementacao caseira erra: prender o foco dentro do modal, devolver
 * o foco ao elemento de origem ao fechar, tornar o resto da pagina inerte para
 * leitores de tela, e fechar no Escape.
 */

export interface ConfirmOptions {
  readonly title: string;
  readonly description: string;
  /** Texto do botao que confirma. Deve dizer o que vai acontecer. */
  readonly confirmLabel: string;
  readonly tone?: 'danger' | 'neutral';
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);

  if (confirm === null) {
    throw new Error('useConfirm exige que a arvore esteja dentro de <ConfirmProvider>.');
  }

  return confirm;
}

interface PendingConfirm {
  readonly options: ConfirmOptions;
  readonly resolve: (confirmed: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    if (pending !== null && !dialog.open) {
      dialog.showModal();
    }
  }, [pending]);

  const settle = useCallback(
    (confirmed: boolean) => {
      dialogRef.current?.close();
      pending?.resolve(confirmed);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        onCancel={(event) => {
          // O Escape dispara `cancel`. Sem interceptar, o dialogo fecharia e a
          // promessa ficaria pendurada para sempre.
          event.preventDefault();
          settle(false);
        }}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] border border-rule-strong bg-surface p-0 text-ink backdrop:bg-black/50"
      >
        {pending !== null && (
          <div className="flex flex-col gap-4 p-6">
            <div>
              <h2 id="confirm-title" className="font-display text-xl font-semibold">
                {pending.options.title}
              </h2>
              <p id="confirm-description" className="mt-2 text-sm text-ink-muted">
                {pending.options.description}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  settle(false);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant={pending.options.tone === 'neutral' ? 'primary' : 'danger'}
                autoFocus
                onClick={() => {
                  settle(true);
                }}
              >
                {pending.options.confirmLabel}
              </Button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
