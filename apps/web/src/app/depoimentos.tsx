'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Depoimento {
  readonly nome: string;
  readonly negocio: string;
  readonly texto: string;
}

/** Sete segundos: tempo de ler uma frase e meia sem sensação de pressa. */
const INTERVALO_MS = 7_000;

/**
 * Carrossel de depoimentos.
 *
 * Os depoimentos são fictícios, e a página diz isso em voz alta. O motivo não é
 * escrúpulo: esta página inteira defende que corretude se verifica em vez de se
 * afirmar, e depoimento inventado passado por verdadeiro é exatamente a coisa
 * que ela acusa. Quem percebesse a invenção passaria a duvidar de tudo que está
 * acima, inclusive do que é conferível.
 *
 * As regras de comportamento não são enfeite:
 *
 * - **Para no hover, no foco e depois de qualquer navegação manual.** Carrossel
 *   que não para é armadilha para quem lê devagar, e quem clicou numa seta
 *   demonstrou que quer controlar o ritmo.
 * - **Sem `aria-live`.** A troca automática não deve interromper leitor de tela.
 *   A navegação manual é que anuncia, e por isso ela move o foco para o texto.
 * - **`prefers-reduced-motion` desliga a rotação**, e não só a transição: quem
 *   pediu menos movimento não pediu movimento mais suave.
 * - **Sem JavaScript vira uma lista de todos**, empilhada. Nenhum depoimento
 *   fica inacessível porque um script não carregou.
 */
export function Carrossel({ depoimentos }: { depoimentos: readonly Depoimento[] }) {
  const [atual, setAtual] = useState(0);
  const [pausado, setPausado] = useState(false);

  // Começa desligado e só liga depois da hidratação. É o que faz a versão sem
  // JavaScript ser a lista completa: o servidor sempre renderiza todos.
  const [interativo, setInterativo] = useState(false);

  const textoRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setInterativo(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!interativo || pausado || depoimentos.length < 2) {
      return;
    }

    const timer = window.setInterval(() => {
      setAtual((anterior) => (anterior + 1) % depoimentos.length);
    }, INTERVALO_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [interativo, pausado, depoimentos.length]);

  /** Navegação manual: para a rotação e leva o foco ao texto, que anuncia. */
  const irPara = useCallback((indice: number) => {
    setAtual(indice);
    setPausado(true);
    textoRef.current?.focus();
  }, []);

  if (!interativo) {
    return (
      <ul className="mx-auto grid max-w-5xl gap-px bg-rule sm:grid-cols-2">
        {depoimentos.map((depoimento) => (
          <li key={depoimento.negocio} className="bg-surface-sunken px-6 py-8">
            <Citacao depoimento={depoimento} />
          </li>
        ))}
      </ul>
    );
  }

  const visivel = depoimentos[atual] as Depoimento;

  return (
    <div
      className="mx-auto max-w-3xl"
      role="group"
      aria-roledescription="carrossel"
      aria-label="Depoimentos fictícios"
      onMouseEnter={() => {
        setPausado(true);
      }}
      onMouseLeave={() => {
        setPausado(false);
      }}
      onFocusCapture={() => {
        setPausado(true);
      }}
    >
      <div className="min-h-[13rem] px-6 py-8 sm:min-h-[11rem]">
        <Citacao depoimento={visivel} textoRef={textoRef} />
      </div>

      <div className="mt-2 flex items-center justify-center gap-2">
        <Seta
          rotulo="Depoimento anterior"
          onClick={() => {
            irPara((atual - 1 + depoimentos.length) % depoimentos.length);
          }}
        >
          &lt;
        </Seta>

        {depoimentos.map((depoimento, indice) => (
          <button
            key={depoimento.negocio}
            type="button"
            // O rótulo diz de quem é, e não "ir para 3". Um marcador que só
            // existe como enfeite não serve para navegar.
            aria-label={`Depoimento de ${depoimento.negocio}`}
            aria-current={indice === atual ? 'true' : undefined}
            onClick={() => {
              irPara(indice);
            }}
            className={`h-2.5 w-2.5 rounded-full border border-rule-strong transition-colors ${
              indice === atual ? 'bg-credit' : 'bg-transparent hover:bg-rule-strong'
            }`}
          />
        ))}

        <Seta
          rotulo="Próximo depoimento"
          onClick={() => {
            irPara((atual + 1) % depoimentos.length);
          }}
        >
          &gt;
        </Seta>
      </div>
    </div>
  );
}

function Seta({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      className="px-2 py-1 font-mono text-sm text-ink-muted hover:text-ink"
    >
      {children}
    </button>
  );
}

function Citacao({
  depoimento,
  textoRef,
}: {
  depoimento: Depoimento;
  textoRef?: React.RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <figure>
      {/* Serifa grande para a citação, monoespaçada pequena para a assinatura:
          é a única seção da página que não é tabular, e o peso visual dela é
          proposital. */}
      <blockquote>
        <p
          ref={textoRef}
          tabIndex={-1}
          className="font-display text-xl leading-snug text-balance outline-none sm:text-2xl"
        >
          {depoimento.texto}
        </p>
      </blockquote>

      <figcaption className="mt-4 border-t border-rule pt-3 font-mono text-[11px] tracking-[0.14em] text-ink-muted uppercase">
        {depoimento.nome} · {depoimento.negocio}
      </figcaption>
    </figure>
  );
}
