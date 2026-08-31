# Página inicial: o argumento em forma de razão

Documento de desenho. A implementação é da fase 08, e o motivo de estar escrito
agora é que a ideia é mais fácil de perder do que de reconstruir.

## O problema desta página

Uma página inicial que **afirma** que o sistema é confiável contradiz o
produto. A tese inteira do Paynow é que corretude se verifica, não se declara.
Uma página cheia de adjetivos seria a primeira coisa a desmentir isso.

Então a página não explica o produto. Ela **é** o produto, em pequeno.

## A ideia

**A página é um lançamento contábil.**

O layout não é hero, features, depoimentos, preço. É um razão de partidas
dobradas: coluna de débito à esquerda, coluna de crédito à direita, e a soma
tem de fechar em zero no rodapé.

- **Débito** é o que quebra em um sistema de cobrança.
- **Crédito** é o que o Paynow faz a respeito.
- **A soma** é a promessa: nada sobra, nada falta.

A forma da página é a ideia central do produto. Quem perguntar "por que a
página inicial é um balancete?" já entendeu o que o projeto defende, e essa
pergunta é o melhor resultado possível numa entrevista.

Vantagem colateral, que também é requisito: uma linha de razão é curta por
natureza. O formato **força** o texto direto. Não há onde escrever parágrafo.

## O conteúdo

Título: uma frase, sem adjetivo.

> Um motor de cobrança recorrente que você pode conferir.
>
> Toda cobrança são duas linhas que somam zero. A maioria dos sistemas guarda
> só o total.

O corpo, como lançamento:

| Débito · o que quebra                           | Crédito · o que fazemos                                         |
| ----------------------------------------------- | --------------------------------------------------------------- |
| O saldo é um campo que alguém atualizou.        | Saldo é a soma das linhas. Nenhum total é armazenado.           |
| Um centavo some no rateio e ninguém acha.       | Dinheiro é inteiro. A sobra vira crédito, nunca arredondamento. |
| Testar a renovação exige esperar trinta dias.   | O relógio congela. Um ano de ciclos cabe em um clique.          |
| O gateway falhou e cobrou duas vezes.           | A chave do evento é única. A segunda cobrança não entra.        |
| Deu errado em produção e o log não diz por quê. | Todo lançamento carrega o evento que o originou.                |
| "Confia, está certo."                           | Soma zero. Confira você mesmo.                                  |

Rodapé do lançamento, e a única linha em destaque:

> **Soma 0,00** · verificado agora, em tempo real

## A parte que não é texto

Abaixo do lançamento, uma faixa com três botões que **fazem** em vez de
descrever. Cada um age contra a API de verdade, em uma organização pública de
demonstração, e o resultado aparece na hora, na própria página:

1. **Emitir uma fatura** → nascem duas linhas somando zero.
2. **Trocar de plano no meio do ciclo** → nascem quatro, com o rateio em
   centavos.
3. **Adiantar três meses** → nascem três faturas, uma por ciclo.

Uma frase acima da faixa:

> Não acredite em nada disso. Clique.

É aqui que a página deixa de ser marketing. Um número que a pessoa provocou e
viu aparecer vale mais do que qualquer afirmação sobre ele.

## Depoimentos

Uma seção própria, em faixa de largura total e fundo diferente do resto, com os
depoimentos girando em carrossel. Cada um traz **nome, negócio e texto**.

Eles são **fictícios, e a página diz isso**. O motivo não é escrúpulo: é que a
página inteira defende que corretude se verifica em vez de se afirmar, e
depoimento inventado passado por verdadeiro é exatamente a coisa que ela acusa.
Quem perceber a invenção passa a duvidar de tudo que está acima, inclusive do
que é conferível.

A saída torna a restrição um trunfo. Os negócios que aparecem aqui são os
**mesmos da organização de demonstração**: quem lê o depoimento da Padaria Lua
e entra no painel encontra a Padaria Lua como assinatura de verdade, com plano,
ciclo e lançamentos. O nome do negócio é um link para ela. O depoimento deixa
de ser enfeite e vira porta de entrada.

Cabeçalho da seção, em uma linha:

> Seis negócios fictícios. O sistema que eles descrevem está a um clique.

### Os depoimentos

Cada um demonstra um pilar em vez de elogiar. Elogio genérico não convence
ninguém e não diz nada sobre o produto.

| Nome           | Negócio         | Depoimento                                                                                                                             |
| -------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ana Ribeiro    | Livraria Aurora | Fechei o mês sem planilha pela primeira vez. O saldo não vem de um campo, vem das linhas, e eu aponto de onde saiu cada centavo.       |
| Marcos Vieira  | Padaria Lua     | Um cliente trocou de plano no dia 14 e perguntou quanto ia pagar. Respondi em dez segundos, com a conta na tela.                       |
| Júlia Nakamura | Studio Vega     | Adiantei três meses num clique e vi as renovações acontecendo. Aprovei o sistema antes de ter o primeiro cliente.                      |
| Rafael Duarte  | Bike Norte      | O gateway repetiu o webhook duas vezes numa madrugada. A segunda cobrança não entrou, e eu só soube disso lendo o log no dia seguinte. |
| Camila Torres  | Mercado Sul     | Meu cartão falhou e eu continuei com acesso. Descobri que era de propósito quando a cobrança passou dois dias depois.                  |
| Diego Salles   | Café Meridiano  | Pedi o extrato de um cliente para o contador. Mandei o razão inteiro. Ele não pediu mais nada.                                         |

Café Meridiano é o único que ainda não existe no seed. Ele entra junto com a
página, para que a promessa do link valha para os seis.

### Como o carrossel se comporta

- **Gira sozinho**, um depoimento a cada sete segundos, e **para no hover, no
  foco e no clique**. Carrossel que não para é armadilha para quem lê devagar.
- **Setas e marcadores** navegáveis por teclado, com o marcador ativo anunciado.
  Marcador que só existe como enfeite não serve.
- **Sem `aria-live`.** A troca automática não deve interromper leitor de tela;
  a região é marcada como grupo de carrossel e a navegação manual é que anuncia.
- **`prefers-reduced-motion` desliga a rotação automática** e a transição. Fica
  o primeiro depoimento com os controles.
- **Sem JavaScript**, a seção vira uma lista de seis, empilhada. Nenhum
  depoimento fica inacessível por causa de script que não carregou.
- **Em 375px** o carrossel mostra um por vez, sempre, com o gesto de arrastar
  funcionando junto com as setas.

O visual pesa aqui de propósito, porque é a única seção da página que não é
tabular: aspas em serifa grande para o texto, nome e negócio em monoespaçada
pequena embaixo, e a régua fina do resto do painel separando os dois.

## Navegação

Não há menu de topo com cinco itens. Há dois destinos, no fim da página:

- **Entrar no painel** para quem quer usar.
- **Ler o código** para quem quer conferir, apontando para o repositório e para
  as ADRs.

Quem já tem sessão vai direto ao painel, como hoje.

## Restrições

- **Texto curto é regra, não estilo.** Nenhuma célula passa de uma linha e meia.
  Se não couber, a ideia está errada, não o espaço.
- **A faixa interativa escreve em uma organização pública de demonstração**, com
  limite de taxa e sem autenticação. É superfície de abuso, e é por isso que
  esta página é da fase 08 e não de agora: ela depende do endurecimento que a
  fase 09 já prevê, e da rotina que recicla os dados da demonstração.
- **Sem dependência nova no cliente.** O razão animado é HTML e CSS. Uma
  biblioteca de animação numa página que defende simplicidade seria irônica.
- **Funciona em 375px.** As duas colunas viram uma, e o par débito/crédito passa
  a ser lido como par empilhado, com a régua entre eles.
- **Funciona sem JavaScript** para tudo que é leitura. Só a faixa interativa
  exige script, e ela some quando não há.
- **Respeita `prefers-reduced-motion`.** O lançamento aparece de uma vez para
  quem pediu menos movimento.

## O que esta página não é

Não tem preço, não tem logotipo de cliente e não tem comparativo com
concorrente.

Depoimento tem, e a primeira versão deste documento dizia que não teria. A
decisão mudou porque a seção acrescenta peso visual à página e porque dá para
tê-la sem mentir: os depoimentos são declaradamente fictícios e apontam para
negócios que existem na demonstração. O que continua valendo é a regra que
motivava a proibição, e ela é mais forte do que a lista: **a página não afirma
nada que quem lê não possa conferir**. Um depoimento assumidamente fictício
cumpre a regra. Um passado por verdadeiro a quebraria, e quebraria junto a
credibilidade de tudo que está acima dele nesta mesma página.
