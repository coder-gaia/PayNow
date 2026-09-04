# ADR-0018: dinheiro que chega tarde reativa o que ainda não morreu, e nunca ressuscita o que morreu

- **Status:** Aceita
- **Data:** 2026-09-05
- **Fase:** 07
- **Substitui:** nenhuma
- **Substituída por:** nenhuma
- **Complementa:** [ADR-0016](0016-webhooks-entrega-e-recebimento.md), [ADR-0017](0017-suite-adversarial-por-convergencia.md)

## Contexto

A suíte adversarial da fase 07 encontrou uma situação sobre a qual não
conseguia afirmar nada, e a investigação revelou um defeito maior do que a
pergunta original.

O caso: uma cobrança não recebe resposta do provedor. O calendário de
recuperação corre inteiro e se esgota. A assinatura cai para `PAST_DUE`, depois
`UNPAID`. Só então o provedor aparece, dizendo que aquela cobrança tinha dado
certo.

A pergunta que ficou em aberto na ADR-0017 era se a assinatura deveria voltar a
valer sozinha. Ao escrever o teste para responder, apareceu o defeito: **não era
que nada acontecia. A transação inteira era desfeita.**

`UNPAID` só permitia ir para `CANCELED`. O código que acerta a assinatura depois
de um pagamento bem sucedido pedia `UNPAID -> ACTIVE`, a máquina de estados
recusava, e a exceção derrubava a transação que registrava o pagamento. O
resultado era o pior possível: o dinheiro tinha entrado no provedor, a fatura
continuava em aberto, a tentativa continuava pendente, e o provedor recebia erro
e reentregava para sempre um evento que nunca poderia dar certo.

## Decisão

A linha é entre uma assinatura que ainda está viva e uma que já morreu.

### `UNPAID` volta para `ACTIVE` quando o dinheiro entra

`UNPAID` significa "paramos de pedir", e não "recusamos o dinheiro". Quando o
pagamento entra, por confirmação tardia do provedor ou por uma cobrança manual
que deu certo, o motivo de a assinatura estar ali evaporou. Recusar seria jogar
fora um cliente que pagou, e ainda ficar com o dinheiro dele.

A transição foi acrescentada à máquina de estados. É a terceira seta de subida,
ao lado de `PAST_DUE -> ACTIVE`, e existe pelo mesmo motivo: um desenho que só
prevê a queda deixa receita na mesa.

### `CANCELED` continua final, e continua sendo o único estado final

A assimetria é deliberada. `UNPAID` é uma **situação**, e situações mudam quando
os fatos mudam. `CANCELED` é uma **decisão já comunicada**: o cliente foi
avisado de que acabou, possivelmente por ele mesmo ter pedido. Reativar sem ele
pedir significa cobrá-lo de novo no mês seguinte por algo que ele considera
encerrado, o que é pior do que o problema que resolveria.

Retomar é um ato explícito: `resume`, ou uma assinatura nova. Os dois passam por
alguém decidindo.

### Pagamento que cai em assinatura encerrada é registrado, e é barulhento

O dinheiro entrou de verdade. Apagá-lo do razão seria mentir sobre o caixa, e o
razão é a coisa que este sistema promete que não mente. Então o pagamento é
registrado, a fatura fica paga, e a assinatura fica como está.

O que não pode acontecer é isso passar em silêncio. É valor recebido por serviço
que não vai ser prestado, e alguém precisa estornar ou combinar outra coisa com
o cliente. Hoje o aviso é um log de erro nomeando a assinatura, a situação e o
que precisa ser feito, no mesmo desenho do aviso de cobrança sem desfecho
conhecido.

## Consequências

Boas:

- Um desfecho tardio deixa de derrubar a transação que registra o pagamento. O
  dinheiro passa a ser registrado sempre, que era a promessa desde a fase 02.
- O provedor para de reentregar para sempre um evento impossível.
- Uma assinatura que o cliente pagou tarde volta a valer sem ninguém intervir.
- A recuperação passa a cobrir o caso em que a confirmação chega depois do
  calendário, que é justamente quando ela é mais valiosa.

Ruins, e assumidas:

- **O aviso de pagamento órfão é um log, e não um evento.** Quem opera precisa
  estar olhando o log para descobrir. O lugar certo é um evento de domínio, que
  entraria no feed de webhooks e no painel, e isso é trabalho da fase 09. Até lá
  é dívida nomeada.
- **A reativação é silenciosa para o cliente.** A assinatura volta a valer e
  ninguém avisa. Um email de "sua assinatura foi reativada" é o complemento
  natural e não entrou.
- **A janela não tem limite.** Uma confirmação que chega seis meses depois
  reativa do mesmo jeito, e o período que a fatura cobria já passou inteiro. Um
  limite de tempo para aceitar desfecho tardio faz sentido e não foi escolhido,
  porque escolher o número sem dado de produção seria inventar.
- **A suíte adversarial continua sem poder segurar desfecho.** `UNPAID` agora
  converge, mas o ciclo encerra assinaturas `UNPAID` depois de um tempo, e
  `CANCELED` não volta. A propriedade da ADR-0017 fica como está.

## Alternativas consideradas

**Reativar também de `CANCELED`.** Resolveria o caso do dinheiro órfão de vez.
Recusada porque quebra a garantia de que estado final é final, que é a coisa que
torna a máquina de estados útil para raciocinar. E porque o cliente já foi
avisado do encerramento: reativar sem ele pedir é uma surpresa que chega na
forma de uma cobrança.

**Recusar o pagamento quando a assinatura está encerrada.** Tem a vantagem de
não criar dinheiro órfão. É impossível: o dinheiro já saiu da conta do cliente no
provedor, e recusar o registro não o traz de volta, só o esconde do razão.

**Estornar automaticamente o pagamento órfão.** Tentador, e recusado. Estorno é
decisão de negócio: o merchant pode querer devolver, pode querer creditar, pode
querer ligar para o cliente e reativar. Escolher por ele, sozinho, é o tipo de
automação que gera o incidente seguinte.

**Deixar `UNPAID` proibido e tratar o desfecho tardio como caso especial no
serviço de pagamentos.** Manteria a máquina de estados mais restrita, ao custo
de espalhar a regra: haveria um caminho que registra pagamento sem passar pela
máquina, e a máquina deixaria de ser a descrição do que pode acontecer.

## Gatilho de revisão

Esta decisão deve ser reaberta quando:

- Aparecer o primeiro pagamento órfão em produção. Aí o log vira evento, e a
  decisão sobre estorno automático deixa de ser hipotética.
- Houver dado sobre quanto tempo depois os desfechos tardios costumam chegar. É
  o que falta para escolher um limite de janela sem inventar o número.
- Alguém pedir reativação de assinatura cancelada. Não é impossível, mas exige
  um ato explícito e uma conversa com o cliente, e não uma transição automática.
