# ADR-0012: worker no mesmo processo, com flag e gatilho de extração

- **Status:** Aceita
- **Data:** 2026-09-01
- **Fase:** 05
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

O ciclo de cobrança precisa acontecer sem que ninguém peça. Uma assinatura
renova no dia certo, uma cobrança recusada é tentada de novo uma hora depois, e
nada disso pode depender de alguém abrir o painel.

Isso exige um processo que acorde sozinho. A pergunta é onde ele mora.

A resposta reflexa é "em um serviço separado", e ela tem bons motivos: o
trabalho de fundo não deve competir por CPU com requests, uma varredura pesada
não deve derrubar a API, e as duas coisas escalam por razões diferentes. Todos
verdadeiros, e nenhum deles vale hoje.

O que vale hoje: o sistema tem um punhado de organizações, o ciclo já é
testado, e a única coisa que falta é quem o chame. Um processo separado agora
significa um segundo artefato para construir, publicar, monitorar e depurar, com
um segundo conjunto de variáveis de ambiente e uma segunda chance de as duas
versões divergirem em produção.

## Decisão

O worker roda **no mesmo processo da API**, ligado por `WORKER_ENABLED`.

Ele é um agendador que acorda a cada minuto, encontra as organizações com
trabalho vencido, e chama o mesmo `BillingCycleService` que a rota do painel
chama. Ele não contém regra nenhuma: é só quem bate na porta.

Três detalhes carregam decisão:

**Organizações com o relógio congelado ficam de fora.** O tempo delas só anda
por comando, e uma varredura de fundo cobrando no meio de uma demonstração
destruiria a propriedade que a ADR-0015 existe para garantir: a mesma sequência
de comandos produz a mesma história.

**Há trava de reentrada.** Uma varredura mais lenta que o intervalo do cron
encontraria a seguinte já rodando. Os advisory locks impediriam a corrupção,
mas o trabalho seria feito duas vezes.

**O erro de uma organização não interrompe as outras.** Cada uma é um cliente
diferente, e uma falhar não é motivo para as demais ficarem sem cobrança.

## Consequências

### Positivas

- Um artefato para construir, publicar e observar.
- O worker e a API compartilham as mesmas conexões e a mesma configuração, o
  que elimina a classe de bug em que os dois discordam sobre o ambiente.
- A extração para processo próprio não muda uma linha de regra de negócio. O
  `BillingCycleService` já é independente de quem o chama, e é isso que torna a
  decisão barata de reverter.
- `WORKER_ENABLED` já permite rodar hoje uma instância só de API e outra só de
  worker, com o mesmo binário, se a necessidade aparecer antes da extração.

### Negativas

- Trabalho de fundo e requests competem pelo mesmo pool de conexões e pelo
  mesmo event loop. Uma varredura grande aumenta a latência das rotas.
- Escalar a API horizontalmente multiplica também os agendadores. A trava de
  reentrada é por processo, então duas instâncias fazem a varredura ao mesmo
  tempo. Não corrompe, porque os advisory locks por assinatura e por fatura
  seguram, mas desperdiça, e o log fica confuso.
- O agendador é `cron` em memória, então ele perde a noção de tempo se o
  processo cair. Nada se perde de fato, porque o que está pendente continua no
  banco, mas a próxima execução é a próxima virada de minuto e não a que estava
  agendada.

## Alternativas consideradas

### Processo separado desde já

Rejeitada por custo desproporcional ao problema. Todos os argumentos a favor
são reais e nenhum deles se aplica na escala atual. O gatilho de revisão abaixo
diz exatamente quando eles passam a valer.

### Fila com BullMQ em vez de varredura

A escolha idiomática, e provavelmente a certa mais adiante. Rejeitada por
enquanto porque fila resolve um problema que a varredura ainda não tem: retry
com backoff, concorrência controlada, dead letter, e visibilidade de trabalho em
voo. Hoje o "trabalho pendente" já está declarado no banco, em
`invoices.next_attempt_at` e `subscriptions.current_period_end`, e uma consulta
o encontra. Uma fila seria uma segunda fonte da verdade sobre o que falta fazer,
e duas fontes divergem.

O quadro muda na fase 06. Entrega de webhook não tem estado natural no banco de
domínio, precisa de backoff por destino e de dead letter, e é aí que a fila
passa a pagar o próprio custo. O Redis já está de pé para isso.

### Agendar no banco, com `pg_cron`

Rejeitada por mover lógica de aplicação para dentro do banco, onde ela fica
invisível para o build, para os testes e para a revisão de código. É o mesmo
raciocínio da ADR-0005 ao contrário: invariante contábil desce para o banco
porque precisa valer para toda conexão; agendamento de aplicação não tem esse
requisito e paga o custo de sumir do repositório.

## Gatilho de revisão

Extrair para processo próprio quando qualquer uma for verdadeira:

1. A varredura passar a impactar a latência das rotas de forma mensurável.
2. Ser necessário escalar API e trabalho de fundo em proporções diferentes.
3. Existir mais de uma instância de API em produção, momento em que a
   duplicação de varredura deixa de ser desperdício aceitável.

Quando isso acontecer, a mudança é um `main.ts` que sobe só o agendador e um
`WORKER_ENABLED=false` na instância de API. Nenhuma regra de negócio se move.
