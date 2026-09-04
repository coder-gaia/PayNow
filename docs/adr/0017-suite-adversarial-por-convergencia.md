# ADR-0017: suíte adversarial que compara duas execuções, em vez de conferir um resultado esperado

- **Status:** Aceita
- **Data:** 2026-09-05
- **Fase:** 07
- **Substitui:** nenhuma
- **Substituída por:** nenhuma
- **Complementa:** [ADR-0011](0011-porta-de-gateway.md), [ADR-0015](0015-relogio-virtual-por-organizacao.md), [ADR-0016](0016-webhooks-entrega-e-recebimento.md)

## Contexto

As outras suítes deste repositório verificam casos que alguém pensou. Elas são
necessárias e não são suficientes: cobrança recorrente quebra em combinações que
ninguém sentou para imaginar, porque o provedor não responde, responde tarde,
responde duas vezes, e o tempo passa no meio disso.

O projeto prometeu uma terceira coisa desde o README: um harness que gera
cenários e afirma propriedades sobre todos eles. Esta ADR registra como ele
ficou e, principalmente, **o que ele consegue e não consegue afirmar**, porque
descobrir isso custou mais do que escrever o código.

## Decisão

### A afirmação é sobre duas execuções, e não sobre um resultado esperado

Um teste que compara o estado final contra um valor escrito à mão verifica o que
o autor do teste imaginou. Num cenário gerado, ninguém sabe qual é o valor
certo, e calculá-lo no teste seria reimplementar o sistema dentro do teste, com
os mesmos enganos.

Então a propriedade é relacional: **o mesmo roteiro, com o provedor contando os
mesmos desfechos nos mesmos pontos mas em ordem diferente e com repetições
diferentes, termina no mesmo lugar.** Nenhum dos dois lados precisa ser conhecido
de antemão. É a propriedade que a deduplicação e a idempotência existem para
dar, e a comparação a testa diretamente.

### O que a projeção compara, e o que ela deliberadamente ignora

Comparada: situação das assinaturas, faturas por situação, total pago, total
estornado, e o saldo de cada conta do razão.

Ignorada: contagem de tentativas, número de linhas de pagamento e horários.
Esses são função de **quando** o provedor resolveu falar, e não dos fatos. Uma
notificação que chega antes da retentativa evita a retentativa; a mesma chegando
depois encontra a cobrança já resolvida. Nos dois casos a fatura termina paga
pelo mesmo valor, que é a afirmação que vale a pena defender. Incluir a contagem
faria a suíte acusar comportamento correto, e um teste que acusa o correto é
pior do que nenhum teste.

### Ação irreversível tomada na ignorância não converge, e por isso o provedor não segura desfecho

Esta é a parte que mudou o desenho.

A primeira versão deixava o provedor segurar um desfecho para contar mais tarde,
o que parece o cúmulo da adversidade. Ela acusava divergência em cenários
corretos, e a razão tem valor próprio: a execução que fica sem saber que a
cobrança deu certo deixa a recuperação seguir o calendário. A assinatura cai para
`PAST_DUE`, depois `UNPAID`, e o ciclo a encerra. A notificação chegando depois
encontra a fatura paga e a assinatura morta, e **não há como ressuscitá-la**. As
renovações que a outra execução teve nunca aconteceram, e daí em diante tudo
diverge.

Isso não é defeito do sistema. É consequência de decidir com informação
incompleta, que é o que ele tem de fazer: esperar indefinidamente por um
provedor calado seria dar acesso de graça a quem talvez nunca pague. Mas quer
dizer que a propriedade afirmável é mais estreita do que "a ordem nunca
importa".

O que a suíte afirma, então: **entregue o mesmo conjunto de desfechos nos mesmos
pontos do roteiro, a ordem dentro de cada lote e a repetição não mudam nada.** As
duas execuções sabem as mesmas coisas nos mesmos momentos, e só discordam sobre
a sequência.

Fica registrado como propriedade do sistema, e não como limitação da suíte: uma
confirmação que chega depois da recuperação esgotada deixa o merchant com
dinheiro recebido e assinatura encerrada. Reativar automaticamente nesse caso é
decisão de produto, e está anotada como gatilho de revisão.

### As operações de negócio acontecem depois de um ponto de sincronia

Estorno, troca de plano e cancelamento agem sobre o que se sabe **naquele
instante**, e o que se sabe naquele instante depende legitimamente de quando o
provedor falou. Duas execuções que estornam pagamentos diferentes divergem por
terem feito coisas diferentes.

Então o roteiro tem duas fases: a adversarial, com cobranças, passagem de tempo e
entregas embaralhadas; e a de negócio, depois de o provedor ter contado tudo,
quando as duas execuções conhecem os mesmos fatos. Ali uma divergência volta a
ser defeito.

### O alvo de cada passo é identidade, e nunca posição

Um passo que dissesse "cobre a terceira fatura em aberto" miraria alvos
diferentes nas duas execuções, porque quantas faturas estão em aberto é
exatamente o que a ordem de entrega muda. Todo passo mira uma **assinatura**,
que é a mesma nas duas execuções sempre.

Custou uma tarde de divergências que pareciam defeito e eram do harness.

### O segundo invariante: o razão fecha em todo passo

Depois de cada passo, e não só no fim. Um razão que fecha apenas quando ninguém
está olhando não fecha. São 800 pontos de verificação numa execução padrão.

### Toda execução tem semente, e a semente sai no log

Uma suíte que sorteia sem semente produz anedota: quando falha no CI ninguém
reproduz, e o que acontece na prática é reexecutar até passar. Com semente, a
mensagem de falha traz o roteiro inteiro e o número para repetir.

### O gateway falso é idempotente também no timeout

Descoberto pela suíte. A mesma chave de idempotência é a **mesma cobrança**, e
ela tem um desfecho só. O dublê inventava um desfecho novo a cada tentativa,
então o provedor passava a contar que a mesma cobrança deu certo e deu errado, e
a ordem de chegada decidia qual vencia. A convergência quebrava por infidelidade
do dublê, não por defeito do sistema.

## Consequências

Boas:

- A suíte redescobriu sozinha o defeito de cobrança em dobro no timeout, que na
  fase 05 foi encontrado à mão. Reintroduzi-lo derruba a suíte no primeiro
  cenário.
- Remover a deduplicação de entrada junto com a checagem de estado derruba as
  duas propriedades, inclusive o invariante do razão.
- Cada falha vem com roteiro e semente.

Ruins, e assumidas:

- **São dezenas de cenários por build, não milhares.** Cada cenário roda duas
  vezes contra um Postgres de verdade, e o padrão de 40 leva cerca de 90
  segundos. Mil cenários levariam mais de meia hora, que não é tempo de build. A
  varredura profunda existe por variável de ambiente e depende de alguém rodá-la.
  O README dizia "milhares por build" desde a fase 00, e a frase foi corrigida.
- **Remover só a deduplicação de entrada não derruba a suíte.** Há três guardas
  sobrepostas contra dupla aplicação: o índice único do recibo, a checagem de
  estado da cobrança, e o índice único do razão sobre o evento de origem.
  Qualquer uma sozinha aguenta esta carga, então a suíte não distingue qual está
  trabalhando. É defesa em profundidade funcionando, e ao mesmo tempo é um ponto
  cego: uma guarda pode apodrecer sem ninguém notar.
- **A adversidade é dirigida, e não realista.** O gateway é pesado no caso
  difícil de propósito: com distribuição realista, a maioria dos cenários termina
  na primeira cobrança e o resto do roteiro roda em vazio. A primeira versão
  fazia isso, e passava com três defesas desligadas.
- **Só um processo, e nenhuma concorrência de verdade.** A suíte embaralha
  ordem, não paraleliza. Corrida entre duas requisições sobre a mesma fatura é
  coberta por advisory lock e por teste dedicado, e não por aqui.
- **A comparação é de duas execuções, e não de todas as ordens possíveis.** Duas
  amostras do espaço de ordenações, não o espaço.

## Alternativas consideradas

**Conferir contra um estado esperado calculado no teste.** Exigiria um modelo do
sistema dentro do teste. Um modelo simples demais discorda do sistema no caso
correto; um modelo fiel é o sistema de novo, com os mesmos enganos, e concordaria
com ele exatamente onde os dois estão errados.

**Usar uma biblioteca de teste de propriedade, como fast-check.** Daria
encolhimento de contraexemplo de graça, que é a parte cara de escrever à mão.
Recusada porque o gerador aqui precisa produzir roteiros com estrutura, com
fases e com alvos por identidade, e o encolhimento teria de entender essa
estrutura para não gerar roteiro inválido. O ganho ficaria pequeno perto do
acoplamento. Entra na conversa de novo se a suíte passar a achar falhas em
roteiros longos demais para ler.

**Rodar contra um banco em memória para ganhar velocidade.** O invariante mais
importante do sistema é imposto por trigger de constraint adiada no PostgreSQL.
Trocar o banco tiraria do ar exatamente o que a suíte existe para exercitar.

**Deixar a suíte junto da ponta a ponta.** Ela leva minutos e as outras levam
segundos. E a falha significa outra coisa: uma suíte ponta a ponta vermelha
aponta um caso conhecido que quebrou, esta aponta um caso que ninguém tinha
pensado. São investigações diferentes, e ficam em jobs separados.

## Gatilho de revisão

Esta decisão deve ser reaberta quando:

- A suíte passar duas versões seguidas sem achar nada em nenhuma mudança de
  cobrança. Isso é sinal de que o gerador parou de alcançar código novo, e não
  de que o sistema ficou perfeito.
- Alguém pedir reativação automática de assinatura encerrada quando a
  confirmação chega tarde. Isso muda a propriedade afirmável, e a fase de
  entrega volta a poder segurar desfecho.
- Aparecer a primeira falha cujo roteiro seja longo demais para ler. Aí o
  encolhimento de contraexemplo deixa de ser luxo.
- O tempo do job passar de cinco minutos. O número de cenários é a variável mais
  fácil de aumentar sem perceber.
