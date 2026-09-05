import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { REFRESH_COOKIE } from '@/lib/session';

import { Carrossel, type Depoimento } from './depoimentos';

/**
 * A página inicial é um lançamento contábil.
 *
 * Uma página que **afirma** que o sistema é confiável contradiz o produto,
 * cuja tese inteira é que corretude se verifica e não se declara. Uma página
 * cheia de adjetivos seria a primeira coisa a desmentir isso.
 *
 * Então ela não explica o produto: ela **é** o produto, em pequeno. Coluna de
 * débito com o que quebra num sistema de cobrança, coluna de crédito com o que
 * fazemos a respeito, e a soma fechando em zero no rodapé, calculada agora, a
 * cada visita, a partir das linhas que estão no banco.
 *
 * Vantagem colateral que também é requisito: uma linha de razão é curta por
 * natureza. O formato **força** o texto direto, porque não há onde escrever
 * parágrafo. Ver docs/pagina-inicial.md.
 */

const LANCAMENTO: readonly { debito: string; credito: string }[] = [
  {
    debito: 'O saldo é um campo que alguém atualizou.',
    credito: 'Saldo é a soma das linhas. Nenhum total é armazenado.',
  },
  {
    debito: 'Um centavo some no rateio e ninguém acha.',
    credito: 'Dinheiro é inteiro. A sobra vira crédito, nunca arredondamento.',
  },
  {
    debito: 'Testar a renovação exige esperar trinta dias.',
    credito: 'O relógio congela. Um ano de ciclos cabe em um clique.',
  },
  {
    debito: 'O gateway falhou e cobrou duas vezes.',
    credito: 'A chave do evento é única. A segunda cobrança não entra.',
  },
  {
    debito: 'Deu errado em produção e o log não diz por quê.',
    credito: 'Todo lançamento carrega o evento que o originou.',
  },
  {
    debito: '"Confia, está certo."',
    credito: 'Soma zero. Confira você mesmo.',
  },
];

const DEPOIMENTOS: readonly Depoimento[] = [
  {
    nome: 'Ana Ribeiro',
    negocio: 'Livraria Aurora',
    texto:
      'Fechei o mês sem planilha pela primeira vez. O saldo não vem de um campo, vem das linhas, e eu aponto de onde saiu cada centavo.',
  },
  {
    nome: 'Marcos Vieira',
    negocio: 'Padaria Lua',
    texto:
      'Um cliente trocou de plano no dia 14 e perguntou quanto ia pagar. Respondi em dez segundos, com a conta na tela.',
  },
  {
    nome: 'Júlia Nakamura',
    negocio: 'Studio Vega',
    texto:
      'Adiantei três meses num clique e vi as renovações acontecendo. Aprovei o sistema antes de ter o primeiro cliente.',
  },
  {
    nome: 'Rafael Duarte',
    negocio: 'Bike Norte',
    texto:
      'O gateway repetiu o webhook duas vezes numa madrugada. A segunda cobrança não entrou, e eu só soube disso lendo o log no dia seguinte.',
  },
  {
    nome: 'Camila Torres',
    negocio: 'Mercado Sul',
    texto:
      'Meu cartão falhou e eu continuei com acesso. Descobri que era de propósito quando a cobrança passou dois dias depois.',
  },
  {
    nome: 'Diego Salles',
    negocio: 'Café Meridiano',
    texto:
      'Pedi o extrato de um cliente para o contador. Mandei o razão inteiro. Ele não pediu mais nada.',
  },
];

interface Linha {
  readonly account: string;
  readonly label: string;
  readonly amountMinor: string;
  readonly currency: string;
}

interface Lancamento {
  readonly id: string;
  readonly description: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly lines: readonly Linha[];
}

interface Razao {
  readonly organization: string;
  readonly entries: readonly Lancamento[];
  readonly verification: {
    readonly balanced: boolean;
    readonly entryCount: number;
    readonly lineCount: number;
    readonly checkedAt: string;
  };
}

const API_URL = process.env['PAYNOW_API_URL'] ?? 'http://localhost:3333/v1';

/**
 * O razão da demonstração, buscado a cada visita.
 *
 * `no-store` de propósito: um número em cache não foi verificado agora, e o
 * rodapé desta página afirma exatamente que foi. Se a API estiver fora do ar, a
 * página continua de pé sem a faixa, porque a leitura não pode depender dela.
 */
async function buscarRazao(): Promise<Razao | null> {
  try {
    const resposta = await fetch(`${API_URL}/demonstracao/razao`, { cache: 'no-store' });

    if (!resposta.ok) {
      return null;
    }

    return (await resposta.json()) as Razao;
  } catch {
    return null;
  }
}

export default async function Home() {
  // Quem já tem sessão vai direto ao painel: para essa pessoa, o argumento já
  // foi feito.
  const sessao = await cookies();

  if (sessao.get(REFRESH_COOKIE) !== undefined) {
    redirect('/painel');
  }

  const razao = await buscarRazao();

  return (
    <main className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
      <header>
        <p className="font-mono text-[11px] tracking-[0.16em] text-credit uppercase">Paynow</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight font-semibold text-balance sm:text-5xl">
          Um motor de cobrança recorrente que você pode conferir.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">
          Toda cobrança são duas linhas que somam zero. A maioria dos sistemas guarda só o total.
        </p>
      </header>

      <section className="mt-16" aria-labelledby="lancamento">
        <h2 id="lancamento" className="sr-only">
          O que quebra, e o que fazemos a respeito
        </h2>

        <div className="grid grid-cols-1 border-t-2 border-ink sm:grid-cols-2">
          <p className="border-b border-rule px-4 py-3 font-mono text-[11px] tracking-[0.16em] text-debit uppercase">
            Débito · o que quebra
          </p>
          <p className="hidden border-b border-rule px-4 py-3 font-mono text-[11px] tracking-[0.16em] text-credit uppercase sm:block">
            Crédito · o que fazemos
          </p>

          {LANCAMENTO.map((par) => (
            /* Em 375px as duas colunas viram uma, e o par passa a ser lido
               empilhado com a régua entre eles. A borda inferior do débito só
               existe no telefone, onde ela é o que separa o par do seguinte. */
            <div key={par.debito} className="contents">
              <p className="px-4 pt-4 pb-1 text-[15px] text-ink-muted sm:border-r sm:border-b sm:border-rule sm:py-4">
                <span className="mr-2 font-mono text-[10px] tracking-[0.14em] text-debit uppercase sm:hidden">
                  Débito
                </span>
                {par.debito}
              </p>
              <p className="border-b-2 border-rule-strong px-4 pt-1 pb-4 text-[15px] sm:border-b sm:border-rule sm:py-4">
                <span className="mr-2 font-mono text-[10px] tracking-[0.14em] text-credit uppercase sm:hidden">
                  Crédito
                </span>
                {par.credito}
              </p>
            </div>
          ))}
        </div>

        {razao !== null && (
          <p className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink px-4 py-4">
            <strong className="font-display text-2xl font-semibold">Soma 0,00</strong>
            <span className="font-mono text-[11px] tracking-[0.14em] text-ink-muted uppercase">
              {razao.verification.balanced ? 'verificado agora' : 'DIVERGÊNCIA ENCONTRADA'} ·{' '}
              {razao.verification.lineCount} linhas em {razao.verification.entryCount} lançamentos
            </span>
          </p>
        )}
      </section>

      {razao !== null && razao.entries.length > 0 && (
        <section className="mt-16" aria-labelledby="linhas">
          <h2 id="linhas" className="font-display text-2xl font-semibold">
            Não acredite em nada disso.
          </h2>
          <p className="mt-2 max-w-2xl text-ink-muted">
            As linhas abaixo estão no razão de {razao.organization} agora. O banco recusa qualquer
            lançamento que não some zero, então não há como uma delas estar aqui e estar errada.
          </p>

          <ul className="mt-6 divide-y divide-rule border border-rule">
            {razao.entries.map((entrada) => (
              <li key={entrada.id} className="px-4 py-4">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px]">{entrada.description}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{entrada.eventType}</span>
                </p>

                <table className="mt-3 w-full font-mono text-[13px]">
                  <tbody>
                    {entrada.lines.map((linha, indice) => (
                      <tr key={`${entrada.id}-${indice}`} className="border-t border-rule">
                        <td className="py-1.5 pr-4 text-ink-muted">{linha.label}</td>
                        <td
                          className={`py-1.5 text-right tabular-nums ${
                            linha.amountMinor.startsWith('-') ? 'text-credit' : 'text-debit'
                          }`}
                        >
                          {formatar(linha.amountMinor)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-rule-strong">
                      <td className="py-1.5 pr-4 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
                        Soma
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatar(somar(entrada.lines))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="mt-20 -mx-5 border-y border-rule bg-surface-sunken px-5 py-14 sm:-mx-8 sm:px-8"
        aria-labelledby="depoimentos"
      >
        <h2
          id="depoimentos"
          className="text-center font-mono text-[11px] tracking-[0.16em] text-ink-muted uppercase"
        >
          Seis negócios fictícios. O sistema que eles descrevem está a um clique.
        </h2>

        <div className="mt-8">
          <Carrossel depoimentos={DEPOIMENTOS} />
        </div>
      </section>

      <footer className="mt-20 flex flex-wrap items-center gap-x-8 gap-y-3 border-t-2 border-ink pt-6">
        <Link href="/entrar" className="font-display text-lg font-semibold underline">
          Entrar no painel
        </Link>
        <a
          href="https://github.com/coder-gaia/PayNow"
          className="font-display text-lg font-semibold underline"
        >
          Ler o código
        </a>
        <span className="text-sm text-ink-faint">
          Os depoimentos acima são fictícios, e os negócios que eles citam existem na demonstração.
        </span>
      </footer>
    </main>
  );
}

/**
 * Centavos em reais, sem passar por ponto flutuante.
 *
 * Dividir por 100 traria de volta exatamente o que a ADR-0002 mantém fora do
 * sistema, e uma conversão dessas, uma vez escrita, acaba copiada para algum
 * lugar onde importa.
 */
function formatar(minor: string): string {
  const valor = BigInt(minor);
  const negativo = valor < 0n;
  const absoluto = negativo ? -valor : valor;
  const centavos = (absoluto % 100n).toString().padStart(2, '0');

  return `${negativo ? '-' : ''}${(absoluto / 100n).toString()},${centavos}`;
}

function somar(linhas: readonly Linha[]): string {
  return linhas.reduce((total, linha) => total + BigInt(linha.amountMinor), 0n).toString();
}
