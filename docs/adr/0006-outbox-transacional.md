# ADR-0006: outbox transacional ao lado da entrega em transação

- **Status:** Aceita
- **Data:** 2026-09-01
- **Fase:** 05
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Um pagamento é confirmado. Três coisas precisam acontecer: a fatura é quitada,
o razão registra a entrada, e o cliente recebe um recibo.

As duas primeiras são escritas no mesmo banco e resolvem-se com uma transação.
A terceira sai do processo, e é aí que aparece um problema que não tem
meio-termo.

- **Enviar antes do commit**: a transação pode falhar depois, e o cliente
  recebeu recibo de uma cobrança que não existe. Não há como retirar o aviso.
- **Enviar depois do commit**: o processo pode morrer entre uma coisa e outra.
  A cobrança aconteceu e ninguém nunca saberá. Não há como descobrir depois,
  porque nada registrou que o aviso devia ter saído.

Não é possível ter as duas coisas: banco e servidor de email não participam da
mesma transação. Qualquer tentativa de coordenar os dois esbarra em commit em
duas fases, que exige suporte dos dois lados e não existe aqui.

O sistema já tinha um barramento de eventos, e ele resolve outro problema. Os
handlers rodam **dentro** da transação de quem publicou, o que dá atomicidade:
se o lançamento contábil falha, a mudança na assinatura volta atrás, e existe
um teste que prova isso. Essa garantia é a mais forte do sistema e não pode ser
perdida.

## Decisão

Entram **dois caminhos de entrega**, com garantias diferentes, decididos na
mesma transação.

- **`DomainEventHandler`** roda dentro da transação. Falhou, tudo volta atrás.
  É o que o razão usa.
- **`OutboxConsumer`** roda depois do commit, e pode ser tentado várias vezes.
  É o que serve para efeito que sai do processo: email hoje, webhook na fase 06.

Um `publish` faz as duas coisas: chama os handlers síncronos **e** grava a
mensagem no outbox, tudo na transação de quem publicou. O commit que salva a
mudança salva também a intenção de contar, e as duas passam a ser um fato só.

A parte que merece ênfase, porque é onde muita implementação erra: **o outbox
não substitui a entrega em transação**. É tentador uniformizar tudo em uma fila
e chamar de desacoplamento. Isso rebaixaria a garantia do razão de "atômico"
para "eventualmente", e o razão é a única coisa do sistema que não pode ficar
eventualmente correta. As duas mecânicas existem porque resolvem problemas
diferentes.

Detalhes que carregam decisão:

**Mensagem sem consumidor não é gravada.** Guardar tudo daria um log de
eventos, que é outra coisa e teria outro desenho. Aqui a linha existe porque
alguém precisa recebê-la.

**A chave vem do fato de domínio.** O índice único sobre organização, tipo e
evento repete o desenho do razão: republicar o mesmo fato não cria segunda
mensagem.

**Entrega é pelo menos uma vez.** Quem consome tem de aguentar receber duas
vezes. Exatamente uma vez não existe sem transação distribuída, e prometer isso
seria mentira.

**O que esgota as tentativas fica como `FAILED` e não some.** Apagar o que não
conseguiu ser entregue é apagar a única evidência de que alguém lá fora não
soube de algo que aconteceu aqui.

## Consequências

### Positivas

- Recibo por email deixa de ser um efeito colateral perigoso e passa a ser um
  fato durável, com retentativa e histórico de erro.
- A entrega falhando não afeta a cobrança. Servidor de email fora do ar não
  impede ninguém de pagar.
- A fase 06 ganha metade do trabalho pronto: webhook é outro `OutboxConsumer`.
- A fila é inspecionável em SQL. "O que não chegou a ninguém" é uma consulta.

### Negativas

- Latência. O recibo sai na próxima varredura, e não no instante do pagamento.
  Para email é irrelevante; para algo que precise ser imediato, não serve.
- Uma tabela que cresce. Mensagens entregues precisam de descarte, que entra
  com o endurecimento da fase 09.
- Duas mecânicas de evento no mesmo sistema é uma complexidade real, e quem lê
  o código precisa saber qual usar. É o custo de as garantias serem mesmo
  diferentes, e o comentário em `outbox.ts` existe para não deixar dúvida.
- O relay é sequencial e roda no mesmo processo. Um consumidor lento atrasa a
  fila inteira.

## Alternativas consideradas

### Publicar direto no Redis depois do commit

O caminho mais curto, e o que perde mensagem. A janela entre o commit e a
publicação é pequena e não é zero, e "pequena" não é uma propriedade que se
possa afirmar sobre dinheiro. Rejeitada.

### Substituir a entrega em transação pelo outbox

Rejeitada, e é a alternativa mais perigosa porque parece mais limpa. Uniformizar
tudo em uma fila rebaixaria a atomicidade entre a mudança de estado e o
lançamento contábil, que é a garantia central do projeto. O teste que prova que
uma falha no razão desfaz a mudança na assinatura deixaria de passar, e o certo
seria apagá-lo, não consertá-lo.

### Change Data Capture, lendo o WAL do PostgreSQL

Debezium ou equivalente, transformando alteração de tabela em evento. Rejeitada
por peso desproporcional: exige um serviço a mais, configuração de replicação, e
acopla o formato do evento ao formato da tabela. O outbox entrega a mesma
garantia com uma tabela e uma consulta.

### Commit em duas fases entre banco e broker

Rejeitada por indisponibilidade prática. Exige suporte dos dois lados,
transforma qualquer falha de coordenação em transação pendurada, e é
notoriamente difícil de operar. O outbox existe justamente porque esta
alternativa não se paga.

## Gatilho de revisão

Reabrir quando qualquer uma acontecer:

1. O relay virar gargalo, momento em que ele passa a alimentar uma fila com
   trabalhadores paralelos em vez de entregar em série.
2. Existir consumidor que precise de entrega em menos de um segundo, quando
   entra notificação por `LISTEN/NOTIFY` para acordar o relay em vez de esperar
   a varredura.
3. A tabela crescer a ponto de precisar de particionamento por data.
