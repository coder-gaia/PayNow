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

Não tem preço, não tem depoimento, não tem logotipo de cliente, não tem
comparativo com concorrente. O Paynow é um projeto de portfólio e fingir que é
uma empresa seria a mesma mentira que a página se propõe a não contar.
