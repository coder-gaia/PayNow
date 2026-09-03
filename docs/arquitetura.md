# A arquitetura do Paynow, explicada

Este documento responde quatro perguntas, em ordem: para quem o sistema serve,
que decisões estruturam ele, o que ele tem de diferente, e onde ele é frágil.

As ADRs em [docs/adr/](adr/) registram cada decisão no momento em que foi
tomada, com as alternativas rejeitadas. Aqui a conversa é outra: direta, sem
formalidade, e com os pontos de dúvida na frente em vez de escondidos.

Ele foi escrito depois de um levantamento em que oito leitores mapearam os
subsistemas e um cético tentou derrubar a afirmação mais forte de cada um.
**Todas as cinco afirmações que chegaram a ser julgadas voltaram como
exageradas**, e três apontavam defeitos reais, não escolha de palavras. Os três
foram corrigidos antes desta versão. O que sobrou aqui é o que resistiu.

---

## 1. Para quem isto serve

A resposta honesta começa por quem **não** deveria usar.

Se você vende um SaaS com três planos, cobra em cartão e quer estar cobrando na
semana que vem, use Stripe Billing. Não é falsa modéstia: é que o Stripe resolve
esse caso melhor do que qualquer coisa que se construa, e construir é uma
decisão cara que precisa de motivo.

Um sistema próprio de cobrança recorrente se justifica quando aparece pelo menos
uma destas quatro situações:

**A contabilidade precisa fechar com o financeiro, e não só parecer certa.**
Quem tem contador, auditoria ou investidor cedo descobre que "o painel do
gateway diz X" não é resposta para "quanto foi receita em março". Receita bruta,
devoluções, taxa retida e dinheiro ainda não liquidado são quatro números
diferentes, e a maioria dos sistemas guarda um só.

**A regra de cobrança não cabe no modelo do provedor.** Rateio calculado de um
jeito específico, plano híbrido, desconto que segue uma regra de negócio,
cobrança em nome de terceiro. Toda plataforma que intermedia dinheiro entre duas
partes cai aqui, porque o provedor não sabe que existem duas partes.

**Você é a plataforma, e não o lojista.** Marketplaces, plataformas de
prestadores, qualquer negócio que cobra em nome de outro e retém uma parte. É
exatamente o modelo deste projeto: o `merchant` é seu cliente, e o cliente dele é
quem paga.

**Trocar de provedor precisa ser possível.** Quem tem o domínio dentro de casa
troca de adquirente sem reescrever o produto.

### Quem usaria, concretamente

O usuário direto não é o assinante final. É **quem opera a cobrança**: a pessoa
de financeiro que abre o painel para entender por que a receita caiu, o suporte
que precisa responder "por que este cliente foi cortado", e o desenvolvedor que
integra pela API.

O painel foi desenhado para essas três pessoas, e é por isso que ele parece um
instrumento de leitura e não um site.

### O que este projeto honestamente é

Um projeto de portfólio, construído para ser lido por outro engenheiro. Não tem
usuário real, não processa dinheiro de verdade, e o gateway padrão é falso.

O que ele tem é o oposto do que um projeto de portfólio costuma ter: em vez de
muitas telas rasas, poucas decisões levadas até o fim, cada uma com a alternativa
rejeitada escrita e um teste que a defende.

---

## 2. As decisões que estruturam o sistema

### Monólito modular, com a fronteira aplicada pelo build

Quatro módulos: `identity`, `ledger`, `billing`, `platform`. A regra é que
**módulos de domínio não se importam entre si**, e ela não é convenção: é uma
regra de lint que quebra o build.

O que atravessa a fronteira é evento de domínio. Cobrança publica "fatura
emitida"; o razão transforma isso em lançamento. Nenhum dos dois conhece o outro.

O ponto que costuma gerar pergunta: **por que não microserviços?** Porque a
fronteira que importa é a de código, e essa dá para ter sem pagar rede,
observabilidade distribuída e transação distribuída. Quando um módulo precisar
escalar sozinho, a costura por onde extrair já está desenhada e já é respeitada.

E a pergunta melhor: **a regra é real ou decorativa?** É a que o projeto se faz
sozinho. `pnpm verify:architecture` escreve módulos-sonda que violam cada regra
de propósito, roda o lint e falha se a violação **não** for detectada. São quatro
sondas hoje. Isso existe porque a regra de fronteira já esteve inerte por duas
causas independentes, configurada e sem disparar, que é pior do que não existir:
dá a impressão de proteção.

### O razão é a fonte da verdade sobre dinheiro

Não existe campo de saldo. Nenhum. Todo saldo é a soma das linhas da conta,
recalculada a cada leitura.

Isso soa acadêmico até a primeira divergência. Um campo de saldo pode discordar
das transações que o formaram, e quando discorda não há como saber qual dos dois
está certo. Uma soma não pode discordar de nada.

Três invariantes vivem **no banco**, e não na aplicação:

- Todo lançamento soma zero, por constraint diferida que valida no commit.
- Linha com valor zero é recusada.
- `UPDATE` e `DELETE` em lançamento são recusados por trigger.

Estão no banco porque uma regra que só vale no caminho feliz do código não é
garantia, é convenção. Um script de correção de dados fura convenção.

**Onde isto é frágil:** o trigger de append-only impede limpeza de dados de
teste sem desativá-lo, o que já foi um incômodo real. E a auditoria completa lê
todas as linhas, o que deixa de escalar em algum volume; o gatilho de revisão
está escrito na ADR-0005.

### O tempo é injetado, e pode ser congelado

Nenhuma linha de domínio lê o relógio do sistema. Uma regra de lint quebra o
build, e uma sonda confere que ela dispara.

Cada organização tem o próprio relógio, que pode ser congelado e adiantado por
comando. O instante é resolvido uma vez na borda do request e carregado num
escopo de `AsyncLocalStorage`, então tudo que roda dentro dele enxerga a mesma
hora sem receber parâmetro. **Nenhuma assinatura de método mudou** para o
relógio virtual existir.

A pergunta técnica que isso provoca: **por que não um provider com escopo de
request do Nest?** Porque no Nest o escopo sobe: quem injeta um provider
request-scoped vira request-scoped também, em cascata. Como quase todo serviço
precisa saber que horas são, o grafo inteiro viraria request-scoped. Trocar o
modelo de instanciação da aplicação para resolver tempo é desproporcional.

**Congelado, não deslocado.** Um deslocamento somado ao relógio real continua
andando sozinho, e a mesma sequência de comandos produziria histórias
diferentes. Congelado, produz sempre a mesma. É essa propriedade que a fase 07
vai usar.

**Onde isto é frágil:** fora de um escopo, o relógio cai no de parede em
silêncio. A alternativa seria lançar, o que transformaria todo caminho novo sem
escopo em erro em produção.

### Dinheiro é inteiro

Nenhum ponto flutuante toca valor monetário. O tipo `Money` guarda unidade
mínima em `bigint`, e a divisão distribui o resto pelo método do maior resto, em
vez de arredondar cada parte.

O efeito prático: rateio de troca de plano credita e cobra em centavos exatos, e
a sobra vira crédito de alguém em vez de sumir.

### Idempotência em duas camadas

São dois problemas diferentes, e por isso duas defesas:

**No HTTP**, `Idempotency-Key` no modelo do Stripe. A corrida é resolvida pelo
índice único do banco, e não por ler antes de escrever, que perderia a corrida
em silêncio. A requisição é impressa em digital, então reusar a mesma chave com
outro corpo é 422 em vez de devolver calado a resposta errada.

**No gateway**, a chave da cobrança. E aqui está a regra mais sutil do projeto,
que eu errei e o levantamento pegou: ela tem **duas metades opostas**. Depois de
uma recusa conhecida, a tentativa seguinte precisa de chave nova, senão o
provedor devolve a recusa antiga para sempre. Depois de um desfecho
desconhecido, precisa da **mesma** chave, senão um provedor que capturou sem
conseguir responder captura de novo.

O que decide não é o número da tentativa: é o que se sabe sobre a anterior.

---

## 3. Os diferenciais

Quatro coisas que este projeto tem e a maioria não.

### O saldo é conferível, não afirmado

O painel mostra o balancete e os lançamentos lado a lado, com a soma fechando em
zero e a verificação de integridade recalculada a cada carregamento. Não é uma
tela que diz que está certo: é uma tela onde dá para conferir.

### Um ano de cobrança em milissegundos

O teste de renovação anual roda contra o Postgres de verdade, sem nenhum dublê
de relógio, e verifica doze renovações, o razão fechando e o valor a receber
exato. Roda em milissegundos.

**Uma ressalva honesta**, que o cético levantou: os 365 dias caem exatamente no
décimo segundo vencimento porque 2026 não é bissexto e a comparação é inclusiva.
Com uma âncora cujo ano seguinte tenha 29 de fevereiro, o mesmo avanço produz
onze renovações. O teste está correto para a âncora que usa, e a generalização
"365 dias sempre dão 12" seria falsa.

### As falhas são o que está testado

O caminho feliz é a parte fácil. O que está coberto é o resto: recusa
temporária, recusa definitiva, provedor sem resposta, cobrança repetida, estorno
concorrente, transação que falha depois de publicar.

O provedor sem resposta é o caso que separa um sistema de cobrança de um
formulário. Quem trata como falha cobra duas vezes; quem trata como sucesso
libera acesso sem dinheiro. Aqui não vira nem uma coisa nem outra: a tentativa
fica registrada como desconhecida, e é ela que é retomada com a mesma chave.

### As decisões estão escritas, com o que foi rejeitado

Quatorze ADRs. Cada uma tem contexto, decisão, consequências negativas,
alternativas rejeitadas com o motivo, e um gatilho de revisão. A alternativa
rejeitada costuma ser a informação mais útil.

---

## 4. Como as partes principais foram construídas

**Um lançamento contábil nasce de um evento.** Cobrança publica o fato dentro da
transação que o produziu; a política contábil transforma em linhas; o banco
recusa se não somar zero. Como o handler roda **dentro** da transação, uma falha
no razão desfaz a mudança que a originou. Existe teste que provoca isso de
propósito.

**A troca de plano roda sob advisory lock.** O ciclo é ler, calcular o rateio a
partir do que leu, e escrever. Lock de linha cobriria só a escrita, e dois
requests simultâneos calculariam sobre o mesmo estado velho.

**Uma cobrança tem três tempos.** Reserva a tentativa e commita; chama o
provedor **fora** de qualquer transação; grava o resultado. Transação aberta
durante chamada de rede segura conexão do pool pelo tempo que o outro lado
quiser, e provedor lento vira banco indisponível.

**O outbox convive com a entrega em transação, e não a substitui.** Uniformizar
tudo numa fila pareceria mais limpo e rebaixaria a garantia do razão de atômica
para eventual. São garantias diferentes para problemas diferentes: handler
síncrono para o que precisa ser atômico, outbox para o que sai do processo.

**O painel é um BFF.** O navegador nunca fala com a API. Os tokens ficam em
cookie `httpOnly`, e a renovação acontece no middleware.

---

## 5. Onde este sistema é fraco

A parte que um documento honesto precisa ter.

**A idempotência do gateway falso nunca é exercitada.** O índice único e o
advisory lock garantem que uma chave nunca é construída duas vezes, então o
mapa de replay do gateway é inalcançável pelos testes. A suíte prova que cobrar
uma fatura paga é inócuo; não prova replay de chave.

**A revogação de família de refresh token não é atômica.** A rotação roda fora
de transação, então em duas requisições simultâneas a perdedora pode revogar a
família antes de a vencedora inserir o token novo, deixando um token vivo numa
família dada como revogada. Nenhum teste cobre esse caminho.

**`httpOnly` não é testado.** A única asserção de cookie confere que eles ficam
vazios depois do logout. Remover `httpOnly` manteria a suíte verde.

**Nenhuma regra de arquitetura cobre `apps/web`.** As garantias sobre token são
convenção mantida por revisão, não mecanismo.

**Não há descarte.** Registros de idempotência, mensagens entregues do outbox e
contas de teste crescem sem limite. Está previsto para a fase 09 e é dívida
consciente.

**O worker duplica trabalho com mais de uma instância.** A trava de reentrada é
por processo. Não corrompe, porque os advisory locks seguram, mas desperdiça.

**Não existe integração real com provedor nenhum.** Passar contra o gateway
falso prova o comportamento do Paynow diante de cada desfecho, e não que o
Stripe produza aqueles desfechos.

---

## 6. As perguntas difíceis

O que eu esperaria ouvir de um engenheiro sênior, com a resposta curta.

**"Por que o razão precisa ser append-only se você tem backup?"** Backup responde
"como estava ontem". Append-only responde "o que aconteceu e em que ordem", que
é outra pergunta e é a que auditoria faz.

**"Contra o que exatamente o advisory lock protege?"** Contra duas mutações da
mesma assinatura calcularem rateio sobre o mesmo estado e gravarem uma por cima
da outra. Lock de linha não cobre, porque a corrida está entre a leitura e a
escrita.

**"O que acontece se o worker rodar em duas instâncias?"** Os dois varrem e os
advisory locks serializam por assinatura e por fatura. Não corrompe, desperdiça.

**"Como você sabe que a regra de lint está ligada?"** Porque uma ferramenta
escreve violações de propósito e falha se elas passarem. Ela existe porque a
regra já esteve inerte.

**"O que quebra primeiro em escala?"** A verificação do razão, que lê todas as
linhas. Depois a tabela de idempotência, sem descarte.

**"Onde o sistema pode perder dinheiro hoje?"** No provedor sem resposta, se ele
tiver capturado. O sistema registra a incerteza e retoma com a mesma chave, mas
a reconciliação contra o provedor não existe.

---

## Fases

Concluídas: fundação, identidade, razão, catálogo e assinaturas, relógio virtual
e ciclo, pagamentos.

Faltam: webhooks, suíte adversarial, painel e demonstração, endurecimento.

O roadmap com o critério de pronto de cada fase está no
[README](../README.md#roadmap).
