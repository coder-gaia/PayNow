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
 * Confirmação de ação destrutiva.
 *
 * Substitui `window.confirm`, que trava a aba inteira, não aceita estilo e não
 * deixa distinguir uma remoção de uma revogação definitiva.
 *
 * Usa o elemento `<dialog>` nativo com `showModal()`, que já traz de graça o
 * que uma implementação caseira erra: prender o foco dentro do modal, devolver
 * o foco ao elemento de origem ao fechar, tornar o resto da página inerte para
 * leitores de tela, e fechar no Escape.
 */

export interface ConfirmOptions {
  readonly title: string;
  readonly description: string;
  /** Texto do botão que confirma. Deve dizer o que vai acontecer. */
  readonly confirmLabel: string;
  readonly tone?: 'danger' | 'neutral';
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);

  if (confirm === null) {
    throw new Error('useConfirm exige que a árvore esteja dentro de <ConfirmProvider>.');
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
        setPending((previous) => {
          // Uma segunda confirmação pedida antes de a primeira ser respondida
          // deixaria a promessa anterior pendurada para sempre, e quem a
          // aguardava nunca sairia do estado de carregamento. Resolver como
          // recusa encerra o pedido antigo antes de abrir o novo.
          previous?.resolve(false);
          return { options, resolve };
        });
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
          // O Escape dispara `cancel`. Sem interceptar, o diálogo fecharia e a
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
