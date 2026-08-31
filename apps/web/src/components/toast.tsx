'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Avisos de ação concluida.
 *
 * Substitui `window.alert`, que bloqueia a página inteira, não e estilizavel e
 * some sem deixar rastro do que aconteceu.
 *
 * A regra de quando usar toast e quando usar mensagem no formulário:
 *
 *   - mensagem sobre o que a pessoa acabou de digitar fica ao lado do campo,
 *     porque e ali que ela vai corrigir;
 *   - mensagem sobre algo que mudou em outro ponto da tela vira toast, porque
 *     o olhar não está necessariamente onde a mudança aconteceu.
 *
 * Erro não some sozinho. Sucesso some em quatro segundos: quem provocou a ação
 * já sabe o que pediu, e a confirmação só precisa existir tempo suficiente para
 * ser notada.
 */

type ToastTone = 'success' | 'error';

interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

const SUCCESS_DURATION_MS = 4_000;

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);

  if (api === null) {
    throw new Error('useToast exige que a árvore esteja dentro de <ToastProvider>.');
  }

  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, message }]);

      if (tone === 'success') {
        setTimeout(() => {
          dismiss(id);
        }, SUCCESS_DURATION_MS);
      }
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => {
        push('success', message);
      },
      error: (message: string) => {
        push('error', message);
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Regiao viva: leitores de tela anunciam sem que o foco saia de onde esta. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pb-6 sm:items-end sm:px-6"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const tone =
    toast.tone === 'success' ? 'border-l-credit bg-credit-soft' : 'border-l-debit bg-debit-soft';

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 border border-rule border-l-2 ${tone} px-4 py-3 shadow-lg motion-safe:animate-[toast-in_140ms_ease-out]`}
    >
      <p className="flex-1 text-sm text-ink">{toast.message}</p>

      <button
        type="button"
        aria-label="Dispensar aviso"
        onClick={() => {
          onDismiss(toast.id);
        }}
        className="-mr-1 -mt-0.5 px-1.5 py-0.5 text-lg leading-none text-ink-faint transition hover:text-ink"
      >
        &times;
      </button>
    </div>
  );
}
