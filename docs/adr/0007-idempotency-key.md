# ADR-0007: Idempotency-Key no modelo do Stripe

- **Status:** Aceita
- **Data:** 2026-09-01
- **Fase:** 05
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Um POST que cobra sai do cliente. A resposta se perde no caminho: o servidor
processou, o cliente não soube. Agora quem chamou tem duas opções, ambas
erradas. Repetir pode cobrar duas vezes. Não repetir pode deixar de cobrar.

Não existe solução do lado do cliente. Nenhum timeout, nenhum retry inteligente
e nenhuma heurística resolve, porque a informação que falta está do outro lado.
A única saída é o servidor reconhecer a repetição.

Isso não é hipotético em cobrança recorrente: retry automático é o
comportamento padrão de qualquer cliente HTTP sério, de todo balanceador e de
toda fila. Um sistema que cobra e não trata repetição vai cobrar em dobro, e a
única dúvida é quando.

## Decisão

O Paynow implementa `Idempotency-Key` no modelo do Stripe.

Quem chama escolhe uma chave e a envia no cabeçalho. A primeira chamada
executa, e a resposta é guardada por vinte e quatro horas. Uma repetição com a
mesma chave recebe aquela resposta de volta, com o cabeçalho
`Idempotent-Replay: true`, sem executar nada.

Quatro decisões dentro dessa:

**É opcional, e vale só para POST.** Sem o cabeçalho, nada muda. Forçar
idempotência em toda rota obrigaria todo cliente a gerar chave até para
operações que não movem dinheiro. `GET` já é idempotente por definição, e
`DELETE` repetido é inofensivo.

**A requisição é impressa em digital.** Método, caminho e corpo viram um hash
guardado junto com a chave. Reusar a mesma chave com um corpo diferente é o erro
mais comum de quem implementa idempotência do lado do cliente, e o defeito é
silencioso: sem a digital, a segunda chamada receberia a resposta da primeira e
quem chamou concluiria que cobrou o valor novo. Com ela, é 422.

**A corrida é resolvida pelo banco.** O índice único em (escopo, chave) não é
otimização, é o mecanismo. Duas chamadas com a mesma chave no mesmo
milissegundo: uma ganha o índice e executa, a outra descobre que há uma em
andamento e recebe 409. Ler antes de escrever perderia a corrida em silêncio.

**A chave é escopada por cliente.** Chave de API ou usuário, conforme a
credencial. Duas integrações podem escolher a mesma string sem colidir, e
ninguém lê resposta alheia adivinhando chave.

## Consequências

### Positivas

- Retry de rede deixa de ser perigoso, que é a condição para qualquer cliente
  sério poder repetir.
- O comportamento é o do Stripe, então quem já integrou com um gateway não
  precisa aprender nada novo.
- O interceptor não sabe qual rota está protegendo, e por isso protege todas as
  que vierem.

### Negativas

- Uma tabela que cresce e precisa de descarte. `expires_at` está lá e o índice
  também; a rotina que apaga entra com o endurecimento da fase 09. Até lá, a
  tabela cresce, e isso é dívida consciente.
- Duas escritas a mais por request que use o cabeçalho: a reserva e a
  conclusão.
- A resposta guardada é a de então. Se o recurso mudar depois, a repetição
  devolve o estado antigo. É o comportamento correto, e é o que o Stripe faz,
  mas surpreende quem espera leitura fresca de um POST.

### O que a falha faz, e por quê

Quando o handler lança, a reserva é **apagada**, e a repetição executa de novo.

Guardar a falha faria um erro transitório virar permanente para aquela chave, e
quem chamou só sairia disso inventando uma chave nova, que é exatamente o que a
idempotência existe para evitar.

Isso reabre, em tese, a janela de cobrança em dobro: o handler pode ter cobrado
antes de falhar. Quem fecha essa janela é a camada de baixo, onde a chave
enviada ao provedor deriva da fatura e da tentativa. **São duas defesas para
dois problemas diferentes**, e é por isso que ambas existem: esta protege o
efeito da rota inteira, aquela protege o dinheiro.

## Alternativas consideradas

### Deduplicar por conteúdo, sem chave

Guardar o hash do corpo e recusar requisições idênticas em uma janela de tempo.
Rejeitada porque confunde repetição com pedido legítimo: cobrar o mesmo cliente
o mesmo valor duas vezes no mesmo minuto pode ser exatamente o que se quer, e
só quem chama sabe. A chave existe justamente para que essa decisão seja de
quem chama.

### Guardar em Redis em vez de Postgres

Rejeitada. A garantia depende da chave e da resposta sobreviverem juntas, e o
Redis desta instalação não tem persistência configurada para valer como fonte
de verdade sobre dinheiro. Postgres já está no caminho da requisição e resolve
a corrida com o índice único, sem uma segunda tecnologia no caminho crítico.

### Idempotência obrigatória em todo POST

Rejeitada por transferir custo a quem não precisa dele. Também é o que o Stripe
faz, e o formato conhecido tem valor por si.

### Confiar só na idempotência do gateway

Rejeitada por proteger a coisa errada. A chave do gateway protege a cobrança;
ela não protege a criação de uma assinatura, de um cliente, nem de um preço. E
uma rota que faz três coisas antes de cobrar precisa que **todas** não
aconteçam duas vezes.

## Gatilho de revisão

Reabrir quando a tabela justificar particionamento por data, ou quando entrar a
primeira rota cujo processamento seja longo o bastante para que 409 de "em
andamento" deixe de ser aceitável. Nesse caso a resposta certa é `202` com um
endereço para consultar, e não esperar.
