import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { REFRESH_COOKIE } from '@/lib/session';

import { Carrossel, type Depoimento } from './depoimentos';

/**
 * A página inicial.
 *
 * O argumento é que corretude se verifica em vez de se declarar, e a página
 * carrega esse argumento em duas camadas.
 *
 * A primeira é imediata: um herói com a promessa em uma frase, dois caminhos
 * claros para agir, e quatro números que vêm do banco agora. A primeira versão
 * desta página começava direto no lançamento contábil e escondia o botão de
 * entrar no rodapé. A ideia era boa e a página era morta: quem chega precisa de
 * três segundos para entender o que é e um lugar óbvio para clicar.
 *
 * A segunda é a demonstração: o lançamento de débito e crédito, os pilares, e
 * lançamentos reais do razão com a soma conferida na própria tela. Quem quiser
 * conferir tem o que conferir; quem não quiser já entendeu e já tem onde
 * clicar. Ver docs/pagina-inicial.md.
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

const PILARES: readonly { titulo: string; texto: string; detalhe: string }[] = [
  {
    titulo: 'Razão verificável',
    texto:
      'Partidas dobradas com os invariantes no banco, e não no código. Uma linha que não soma zero é recusada pelo PostgreSQL, não por um `if`.',
    detalhe: 'append-only · trigger de constraint adiada',
  },
  {
    titulo: 'Relógio virtual',
    texto:
      'O tempo é uma porta, e cada organização tem o seu. Um ano de renovações, recuperações e expirações cabe em segundos, de forma determinística.',
    detalhe: 'congelado, não deslocado · AsyncLocalStorage',
  },
  {
    titulo: 'Suíte adversarial',
    texto:
      'Cenários gerados por semente, com o provedor falhando, sumindo e repetindo. Afirma que a ordem de chegada não muda o desfecho, e que o razão fecha em todo passo.',
    detalhe: '800 pontos verificados por execução',
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
const REPOSITORIO = 'https://github.com/coder-gaia/PayNow';

/**
 * O razão da demonstração, buscado a cada visita.
 *
 * `no-store` de propósito: um número em cache não foi verificado agora, e a
 * página afirma exatamente que foi. Se a API estiver fora do ar, a página
 * continua de pé sem os números, porque o argumento não pode depender dela para
 * ser lido.
 */
async function buscarRazao(): Promise<Razao | null> {
  try {
    const resposta = await fetch(`${API_URL}/demonstracao/razao`, { cache: 'no-store' });
    return resposta.ok ? ((await resposta.json()) as Razao) : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  // Quem já tem sessão vai direto ao painel: para essa pessoa o argumento já
  // foi feito.
  const sessao = await cookies();

  if (sessao.get(REFRESH_COOKIE) !== undefined) {
    redirect('/painel');
  }

  const razao = await buscarRazao();

  return (
    <div className="min-h-dvh bg-paper">
      <BarraDoTopo />
      <Heroi razao={razao} />

      <main>
        <Secao
          id="lancamento"
          numero="01"
          titulo="O que quebra, e o que fazemos"
          descricao="Seis pares. O da esquerda é o que acontece em sistemas de cobrança de verdade; o da direita é a decisão que tomamos a respeito."
        >
          <div className="grid grid-cols-1 border-t-2 border-ink sm:grid-cols-2">
            <p className="border-b border-rule px-4 py-3 font-mono text-[11px] tracking-[0.16em] text-debit uppercase">
              Débito · o que quebra
            </p>
            <p className="hidden border-b border-rule px-4 py-3 font-mono text-[11px] tracking-[0.16em] text-credit uppercase sm:block">
              Crédito · o que fazemos
            </p>

            {LANCAMENTO.map((par) => (
              /* Em 375px as duas colunas viram uma e o par é lido empilhado. A
                 régua entre pares é mais forte do que a de dentro do par: com
                 todas iguais, o par deixa de ser lido como par. */
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

          <p className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink px-4 py-5">
            <strong className="font-display text-3xl font-semibold">Soma 0,00</strong>
            <span className="font-mono text-[11px] tracking-[0.14em] text-ink-muted uppercase">
              {razao === null
                ? 'a API não respondeu'
                : razao.verification.balanced
                  ? `verificado agora · ${razao.verification.lineCount} linhas em ${razao.verification.entryCount} lançamentos`
                  : 'DIVERGÊNCIA ENCONTRADA'}
            </span>
          </p>
        </Secao>

        <Secao
          id="pilares"
          numero="02"
          titulo="Três coisas que a maioria não faz"
          descricao="Nenhuma delas é difícil sozinha. O que custa é sustentar as três ao mesmo tempo, e é isso que o projeto existe para mostrar."
        >
          <div className="grid gap-px bg-rule md:grid-cols-3">
            {PILARES.map((pilar, indice) => (
              <article key={pilar.titulo} className="flex flex-col bg-surface p-6">
                <span className="font-mono text-[11px] tracking-[0.16em] text-credit">
                  {String(indice + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-3 font-display text-xl font-semibold">{pilar.titulo}</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-muted">
                  {pilar.texto}
                </p>
                <p className="mt-4 border-t border-rule pt-3 font-mono text-[11px] text-ink-faint">
                  {pilar.detalhe}
                </p>
              </article>
            ))}
          </div>
        </Secao>

        {razao !== null && razao.entries.length > 0 && (
          <Secao
            id="linhas"
            numero="03"
            titulo="Não acredite em nada disso"
            descricao={`As linhas abaixo estão no razão de ${razao.organization} agora. O banco recusa qualquer lançamento que não some zero, então não há como uma delas estar aqui e estar errada.`}
          >
            <ul className="divide-y divide-rule border border-rule bg-surface">
              {razao.entries.map((entrada) => (
                <li key={entrada.id} className="px-4 py-5 sm:px-5">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[15px] font-medium">{entrada.description}</span>
                    <span className="font-mono text-[11px] text-ink-faint">
                      {entrada.eventType}
                    </span>
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
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {formatar(somar(entrada.lines))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          </Secao>
        )}

        <section
          className="border-y border-rule bg-surface-sunken py-16 sm:py-20"
          aria-labelledby="depoimentos"
        >
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <h2
              id="depoimentos"
              className="text-center font-mono text-[11px] tracking-[0.16em] text-ink-muted uppercase"
            >
              Seis negócios fictícios. O sistema que eles descrevem está a um clique.
            </h2>

            <div className="mt-10">
              <Carrossel depoimentos={DEPOIMENTOS} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="border-2 border-ink bg-surface px-6 py-10 text-center sm:px-12 sm:py-14">
            <h2 className="font-display text-3xl leading-tight font-semibold text-balance sm:text-4xl">
              Entre com a conta de demonstração e mexa em tudo.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-ink-muted">
              Congele o relógio, adiante três meses, force uma cobrança a falhar e veja a
              recuperação acontecer. Nada ali é maquete.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <BotaoPrimario href="/entrar">Entrar no painel</BotaoPrimario>
              <BotaoSecundario href={REPOSITORIO}>Ler o código</BotaoSecundario>
            </div>

            <p className="mt-6 font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              ana@livraria-aurora.test · paynow-demo-2026
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
          <p className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Paynow · projeto de portfólio · licença MIT
          </p>
          <p className="text-sm text-ink-faint">
            Os depoimentos são fictícios, e os negócios que eles citam existem na demonstração.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * A barra do topo existe por um motivo só: dar um lugar óbvio para clicar.
 *
 * A primeira versão desta página não tinha nenhum, e o único botão de entrar
 * ficava no rodapé, depois de tudo. Uma página pode ter o melhor argumento do
 * mundo e ainda assim perder quem não achou a porta.
 */
function BarraDoTopo() {
  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <span className="font-display text-lg font-semibold tracking-tight">Paynow</span>

        <nav className="flex items-center gap-2 sm:gap-3">
          <a
            href={REPOSITORIO}
            className="px-2 py-1.5 text-sm text-ink-muted hover:text-ink sm:px-3"
          >
            Ler o código
          </a>
          <BotaoPrimario href="/entrar" compacto>
            Entrar no painel
          </BotaoPrimario>
        </nav>
      </div>
    </header>
  );
}

function Heroi({ razao }: { razao: Razao | null }) {
  return (
    <section className="relative overflow-hidden border-b border-rule bg-surface">
      {/* Papel pautado, em CSS e sem imagem: a régua horizontal é a mesma do
          razão, e é o único enfeite da página. Uma biblioteca de animação numa
          página que defende simplicidade seria irônica. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_39px,var(--color-rule)_39px,var(--color-rule)_40px)]"
      />

      <div className="relative mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="surgir font-mono text-[11px] tracking-[0.16em] text-credit uppercase">
          Motor de cobrança recorrente
        </p>

        <h1
          className="surgir mt-5 max-w-3xl font-display text-[2.75rem] leading-[1.05] font-semibold text-balance sm:text-6xl"
          style={{ animationDelay: '60ms' }}
        >
          Cobrança recorrente que <span className="text-credit">você pode conferir</span>.
        </h1>

        <p
          className="surgir mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted sm:text-xl"
          style={{ animationDelay: '140ms' }}
        >
          Toda cobrança são duas linhas que somam zero. A maioria dos sistemas guarda só o total, e
          é por isso que ninguém consegue explicar de onde veio um centavo a menos.
        </p>

        <div className="surgir mt-9 flex flex-wrap gap-3" style={{ animationDelay: '220ms' }}>
          <BotaoPrimario href="/entrar">Entrar no painel</BotaoPrimario>
          <BotaoSecundario href="#linhas">Ver o razão ao vivo</BotaoSecundario>
        </div>

        {razao !== null && (
          <dl className="mt-14 grid max-w-3xl grid-cols-2 gap-px border border-rule bg-rule sm:grid-cols-4">
            {[
              { rotulo: 'Soma do razão', valor: '0,00', nota: 'conferida agora', destaque: true },
              {
                rotulo: 'Lançamentos',
                valor: razao.verification.entryCount.toString(),
                nota: 'na demonstração',
              },
              {
                rotulo: 'Linhas',
                valor: razao.verification.lineCount.toString(),
                nota: 'nenhuma órfã',
              },
              {
                rotulo: 'Invariantes',
                valor: razao.verification.balanced ? 'OK' : 'FALHA',
                nota: 'imposto pelo banco',
              },
            ].map((numero, indice) => (
              <Numero key={numero.rotulo} {...numero} atraso={`${300 + indice * 70}ms`} />
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  atraso,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  atraso: string;
  destaque?: boolean;
}) {
  return (
    <div className="surgir bg-surface px-4 py-4" style={{ animationDelay: atraso }}>
      <dt className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">{rotulo}</dt>
      <dd
        className={`mt-1.5 font-display text-3xl font-semibold tabular-nums ${
          destaque ? 'text-credit' : ''
        }`}
      >
        {valor}
      </dd>
      <p className="mt-0.5 text-[12px] text-ink-faint">{nota}</p>
    </div>
  );
}

function Secao({
  id,
  numero,
  titulo,
  descricao,
  children,
}: {
  id: string;
  numero: string;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
      <header className="mb-8 max-w-2xl">
        <p className="font-mono text-[11px] tracking-[0.16em] text-ink-faint">{numero}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold text-balance">{titulo}</h2>
        <p className="mt-3 leading-relaxed text-ink-muted">{descricao}</p>
      </header>
      {children}
    </section>
  );
}

function BotaoPrimario({
  href,
  children,
  compacto = false,
}: {
  href: string;
  children: string;
  compacto?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center border-2 border-credit bg-credit font-display font-semibold text-surface transition-opacity hover:opacity-90 ${
        compacto ? 'px-4 py-1.5 text-sm' : 'px-6 py-3 text-base'
      }`}
    >
      {children}
    </Link>
  );
}

function BotaoSecundario({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center border-2 border-ink px-6 py-3 font-display text-base font-semibold transition-colors hover:bg-surface-sunken"
    >
      {children}
    </a>
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
