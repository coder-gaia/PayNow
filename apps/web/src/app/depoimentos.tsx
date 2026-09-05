'use client';

import Link from 'next/link';
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
 * A primeira versão mostrava uma citação solta no meio de muito espaço vazio, e
 * parecia inacabada. Agora são cartões com peso: aspas grandes, iniciais do
 * negócio em bloco, e três de cada vez no desktop, com a janela deslizando de um
 * em um. Um por vez desperdiça a largura e faz a seção parecer uma sobra.
 *
 * As regras de comportamento não são enfeite:
 *
 * - **Para no hover, no foco e depois de qualquer navegação manual.** Carrossel
 *   que não para é armadilha para quem lê devagar, e quem clicou numa seta
 *   demonstrou que quer controlar o ritmo.
 * - **Sem `aria-live`.** A troca automática não deve interromper leitor de tela.
 *   A navegação manual é que anuncia, e por isso ela move o foco para o cartão.
 * - **`prefers-reduced-motion` desliga a rotação**, e não só a transição: quem
 *   pediu menos movimento não pediu movimento mais suave.
 * - **Sem JavaScript vira a grade com todos**, empilhada. Nenhum depoimento fica
 *   inacessível porque um script não carregou.
 */
export function Carrossel({ depoimentos }: { depoimentos: readonly Depoimento[] }) {
  const [inicio, setInicio] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [porVez, setPorVez] = useState(1);

  // Começa desligado e só liga depois da hidratação. É o que faz a versão sem
  // JavaScript ser a grade completa: o servidor sempre renderiza todos.
  const [interativo, setInterativo] = useState(false);

  const primeiroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
    const largo = window.matchMedia('(min-width: 1024px)');
    const medio = window.matchMedia('(min-width: 640px)');

    const ajustar = () => {
      setInterativo(!semMovimento.matches);
      setPorVez(largo.matches ? 3 : medio.matches ? 2 : 1);
    };

    ajustar();
    for (const consulta of [semMovimento, largo, medio]) {
      consulta.addEventListener('change', ajustar);
    }

    return () => {
      for (const consulta of [semMovimento, largo, medio]) {
        consulta.removeEventListener('change', ajustar);
      }
    };
  }, []);

  useEffect(() => {
    if (!interativo || pausado || depoimentos.length <= porVez) {
      return;
    }

    const timer = window.setInterval(() => {
      setInicio((anterior) => (anterior + 1) % depoimentos.length);
    }, INTERVALO_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [interativo, pausado, depoimentos.length, porVez]);

  /** Navegação manual: para a rotação e leva o foco ao primeiro cartão. */
  const irPara = useCallback((indice: number) => {
    setInicio(indice);
    setPausado(true);
    primeiroRef.current?.focus();
  }, []);

  if (!interativo) {
    return (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {depoimentos.map((depoimento) => (
          <li key={depoimento.negocio}>
            <Cartao depoimento={depoimento} />
          </li>
        ))}
      </ul>
    );
  }

  // A janela dá a volta, então o último e o primeiro ficam vizinhos em vez de
  // existir um fim onde o carrossel trava.
  const visiveis = Array.from(
    { length: Math.min(porVez, depoimentos.length) },
    (_, deslocamento) => depoimentos[(inicio + deslocamento) % depoimentos.length] as Depoimento,
  );

  return (
    <div
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visiveis.map((depoimento, posicao) => (
          <Cartao
            key={depoimento.negocio}
            depoimento={depoimento}
            cartaoRef={posicao === 0 ? primeiroRef : undefined}
          />
        ))}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2">
        <Seta
          rotulo="Depoimentos anteriores"
          onClick={() => {
            irPara((inicio - 1 + depoimentos.length) % depoimentos.length);
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
            aria-current={indice === inicio ? 'true' : undefined}
            onClick={() => {
              irPara(indice);
            }}
            className={`h-2 w-6 border border-rule-strong transition-colors ${
              indice === inicio ? 'bg-credit' : 'bg-transparent hover:bg-rule-strong'
            }`}
          />
        ))}

        <Seta
          rotulo="Próximos depoimentos"
          onClick={() => {
            irPara((inicio + 1) % depoimentos.length);
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
      className="border border-rule-strong px-2.5 py-1 font-mono text-sm text-ink-muted hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}

function Cartao({
  depoimento,
  cartaoRef,
}: {
  depoimento: Depoimento;
  cartaoRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <figure
      ref={cartaoRef}
      tabIndex={-1}
      className="flex h-full flex-col border border-rule bg-surface p-6 outline-none focus-visible:border-credit"
    >
      {/* A aspa é grande e em serifa de propósito: é a única seção da página que
          não é tabular, e o peso visual dela é o que impede a seção de parecer
          uma sobra no fim. */}
      <span aria-hidden className="font-display text-4xl leading-none text-credit">
        &ldquo;
      </span>

      <blockquote className="mt-2 flex-1">
        <p className="font-display text-lg leading-snug text-balance">{depoimento.texto}</p>
      </blockquote>

      <figcaption className="mt-6 flex items-center gap-3 border-t border-rule pt-4">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-rule-strong font-mono text-[11px] text-ink-muted"
        >
          {iniciais(depoimento.negocio)}
        </span>

        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{depoimento.nome}</span>
          {/* O negócio é link para o painel, e não texto morto: quem lê o
              depoimento da Padaria Lua encontra a Padaria Lua como assinatura
              de verdade. O depoimento deixa de ser enfeite e vira porta. */}
          <Link
            href="/painel/assinaturas"
            className="block truncate font-mono text-[11px] tracking-[0.12em] text-ink-faint uppercase hover:text-credit"
          >
            {depoimento.negocio}
          </Link>
        </span>
      </figcaption>
    </figure>
  );
}

function iniciais(negocio: string): string {
  return negocio
    .split(' ')
    .slice(0, 2)
    .map((palavra) => palavra.charAt(0).toUpperCase())
    .join('');
}
