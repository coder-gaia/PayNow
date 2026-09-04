# ADR-0016: webhooks, com a entrega separada do consumo e duas defesas contra reentrega

- **Status:** Aceita
- **Data:** 2026-09-04
- **Fase:** 06
- **Substitui:** nenhuma
- **Substituída por:** nenhuma
- **Complementa:** [ADR-0006](0006-outbox-transacional.md), [ADR-0011](0011-porta-de-gateway.md)

## Contexto

Um SaaS de cobrança que não avisa ninguém é um banco de dados caro. O merchant
precisa saber que a fatura foi paga para liberar o acesso, e precisa saber que a
recuperação falhou para ligar para o cliente. Esse aviso é o webhook de saída.

Na direção contrária existe um problema mais incômodo, e ele é o motivo real de
esta fase existir. A ADR-0011 descreve a cobrança em três tempos, e o terceiro
tempo tem um caso sem saída boa: a chamada ao provedor que morre sem resposta. O
dinheiro pode ter saído, pode não ter, e o sistema não tem como saber. Hoje a
tentativa fica `PENDING` e o log diz, com essas palavras, que alguém precisa
conciliar contra o painel do provedor à mão.

O webhook de entrada é o que resolve isso: o provedor nos procura para contar o
desfecho. Só que aceitar uma requisição que muda o estado do dinheiro, vinda de
quem não fez login, e que pode chegar repetida, tem três perguntas próprias.

1. Como saber que quem bate na porta é mesmo o provedor.
2. O que fazer quando o mesmo evento chega duas vezes.
3. Como um módulo que fala HTTP conversa com o módulo que entende de fatura, se
   as fronteiras proíbem um domínio importar outro.

## Decisão

### O consumidor do outbox não faz chamada de rede

O outbox entrega uma mensagem a todos os consumidores registrados, e se qualquer
um falhar a mensagem inteira volta para a fila. Com dois endereços assinando o
mesmo evento, um deles fora do ar faria o outro receber de novo a cada
retentativa.

Por isso o consumidor de webhooks **só cria linhas**. Uma linha de entrega por
endereço interessado, que é escrita local e não falha por motivo transitório. A
chamada HTTP fica numa varredura separada, com retentativa por entrega. O índice
único sobre (endereço, evento) fecha o desenho: o consumidor pode ser
reexecutado à vontade, porque criar a mesma entrega duas vezes é recusado pelo
banco.

### A assinatura cobre o instante, e não só o corpo

Formato `t=<unix>,v1=<hex>`, HMAC-SHA256 sobre `${t}.${corpo}`, como o Stripe
faz. Assinar só o corpo deixaria uma entrega legítima capturada valer para
sempre: quem a interceptasse poderia reenviá-la em qualquer momento futuro e ela
seria aceita. Com o instante dentro da assinatura, ele não pode ser trocado, e
uma janela de tolerância recusa o que é velho demais.

A comparação é em tempo constante. Comparar com igualdade simples vaza, pelo
tempo da resposta, quantos bytes conferiram.

### Duas defesas contra reentrega na entrada, porque nenhuma basta sozinha

A primeira é um índice único sobre (provedor, id externo). O mesmo evento
entregue duas vezes é recusado pelo banco antes de qualquer efeito.

Ela não basta. O recibo é gravado numa transação, e o efeito é aplicado em
seguida, em outra. Se o processo morrer entre as duas, o recibo existe e o
efeito não. A reentrega do provedor bate no índice, é reconhecida como duplicata
e descartada, e o desfecho da cobrança se perde em silêncio: o pior desfecho
possível, porque ninguém fica sabendo.

A segunda defesa é a checagem de estado no lado que aplica: só uma cobrança
ainda `PENDING` aceita desfecho. Ela cobre o buraco acima, porque um recibo que
ficou por aplicar pode ser reprocessado sem risco de aplicar duas vezes. E cobre
um caso que o índice nunca cobriria: dois eventos **diferentes** falando da
mesma cobrança, que é o que acontece quando o provedor reemite um evento com id
novo.

### O recibo é gravado antes do efeito, e não junto com ele

A alternativa óbvia é uma transação só: gravar o recibo e aplicar o efeito
juntos. Ela dá exatamente uma aplicação por evento, que é uma garantia melhor, e
por isso merece ser dito por que não foi escolhida.

Quando o processamento falha por motivo permanente, a transação volta atrás e
leva o recibo junto. O provedor insiste, nós falhamos de novo, e não fica rastro
nenhum de nada disso ter acontecido. Depurar vira uma discussão sem árbitro: o
provedor mostra que enviou, e nós não temos o que mostrar.

Gravar antes troca uma garantia mais forte por uma propriedade que vale mais
aqui: **tudo que chegou está registrado**, inclusive o que falhou. A garantia
perdida é reconstruída pela checagem de estado.

### A entrada chega à cobrança por uma porta em `platform`

As fronteiras de módulo proíbem um domínio importar outro. O módulo de webhooks
não pode importar cobrança, e a proibição está certa: ele não deve saber o que é
uma fatura, e o de cobrança não deve saber o que é uma requisição assinada.

O que os dois compartilham é um contrato, `GatewayNotification`, que vive em
`platform`. Cobrança registra quem sabe aplicá-lo; webhooks o encontra pela
porta. É o mesmo desenho da ADR-0011 para o gateway, e da ADR-0006 para o
outbox: quando a fronteira incomoda, quase sempre é porque a dependência estava
na direção errada.

A cobrança é identificada pela **chave de idempotência**, e não por um id nosso.
É a única coisa que o provedor sabe sobre nós, porque foi o que mandamos a ele.

### A rota de entrada não recebe o id da organização

Ela vive em `/inbound-webhooks/:provider`, e não dentro de `/organizations/:id`.
O provedor não conhece as nossas organizações. Pedir esse id na URL seria pedir
um dado que ele não tem, e aceitar o que viesse seria deixar quem chama escolher
qual organização afetar. A organização é **descoberta** a partir da cobrança.

### O calendário de reentrega é diferente do de recuperação de cobrança

Dez segundos, trinta, dois minutos, dez, trinta, duas horas, seis, um dia. Oito
tentativas ao longo de pouco mais de um dia.

O calendário de dunning cresce em horas porque a causa é humana e o cliente
precisa de tempo para reparar no problema. Aqui a causa é um servidor, e servidor
volta em segundos ou fica fora por horas, sem meio termo útil. Por isso o começo
é agressivo, para cobrir um deploy passando, e o fim é longo, para cobrir alguém
precisando acordar.

`2xx` encerra. `410 Gone` encerra sem sucesso: o endereço disse que não existe
mais, e insistir é desperdício dos dois lados. Todo o resto merece retentativa,
inclusive `4xx`, que costuma indicar bug de quem recebe e costuma ser corrigido
com um deploy.

## Consequências

Boas:

- Um endereço fora do ar não faz os outros receberem duas vezes, e isso é
  verificado por teste contra um servidor HTTP de verdade.
- Toda tentativa fica registrada com código de resposta, duração e erro. É o que
  transforma "não recebi" de discussão em pergunta com resposta.
- A cobrança sem desfecho conhecido deixa de exigir conciliação manual.
- O segredo é rotacionável, e a rotação invalida o anterior no mesmo instante.

Ruins, e assumidas:

- **O segredo do endereço é guardado em claro.** Assinar exige o valor, e não o
  hash, diferente da chave de API, que só precisa ser comparada. Quem ler o
  banco consegue forjar entregas nossas. Cifrar em repouso é trabalho da fase 09.
- **A defesa contra SSRF é uma lista de endereços internos, e listas vazam.** Um
  nome público que resolve para endereço interno passa. Cobrir isso exige
  resolver o nome antes de conectar e recusar o endereço resolvido, e ainda
  proteger contra a resolução mudar entre a checagem e a conexão.
- **Não há jitter no calendário.** Com muitos endereços caindo ao mesmo tempo,
  um calendário fixo faz todos voltarem no mesmo instante e pode derrubar de novo
  o serviço que estava se recuperando.
- **A varredura de entrega é sequencial.** Uma entrega lenta atrasa as
  seguintes do lote. Com poucos endereços não aparece; com muitos, aparece.
- **A ordem de entrega não é garantida.** Um endereço pode receber
  `payment.succeeded` antes de `invoice.issued` se a primeira tentativa da
  segunda falhar. Quem integra precisa tratar cada evento por si, e o envelope
  carrega `occurredAt` para isso.
- **A retomada de recibos pendentes roda a cada minuto, e não na hora.** Um
  evento cujo efeito ficou pela metade espera até um minuto para ser retomado.
  Reduzir isso é baixar o intervalo do worker, e o custo é varredura em vazio.

## Alternativas consideradas

**Entregar dentro do consumidor do outbox.** Menos peças, e foi a primeira
versão. Cai no problema da reentrega cruzada descrito acima, que é observável
com dois endereços e um deles fora do ar. Foi trocado antes de existir teste, e
depois o teste foi escrito para provar que a troca era necessária.

**Uma transação só na entrada.** Discutida acima. Garantia melhor, rastro pior,
e o rastro vale mais num sistema cujo argumento central é ser auditável.

**Fila dedicada, com BullMQ, em vez de tabela e varredura.** O Redis já está no
projeto. Daria retentativa, backoff e concorrência de graça. Foi recusado pelo
mesmo motivo da ADR-0012: o histórico de entregas é dado de produto, que o
merchant consulta, e não estado efêmero de fila. Ele teria que existir em tabela
de qualquer forma, e aí a fila viraria uma segunda fonte de verdade sobre a
mesma coisa.

**Assinar com par de chaves em vez de segredo compartilhado.** Melhor: quem lê o
nosso banco não conseguiria forjar entregas. Recusado por custo de integração,
porque HMAC com segredo é o que a maioria dos integradores já sabe conferir, e
porque é o que Stripe, GitHub e Shopify fazem. Fica anotado como o caminho se o
armazenamento em claro incomodar antes da fase 09.

**Deduplicar a entrada só pela checagem de estado, sem tabela de recibos.**
Funcionaria para o efeito, e é a defesa que faz o trabalho pesado. Sem a tabela
não haveria como responder "vocês nos mandaram isso?", que é a pergunta que
aparece quando algo dá errado.

## Gatilho de revisão

Esta decisão deve ser reaberta quando:

- Um endereço passar a receber volume em que a varredura sequencial atrase as
  entregas dos outros. O sinal é `lastDurationMs` alto com fila crescendo.
- Aparecer o primeiro incidente de muitos endereços caindo juntos. Aí o jitter
  deixa de ser precaução teórica.
- Entrar um provedor de pagamento de verdade. O formato de entrada dele muda o
  tradutor, e o esquema de assinatura dele pode não ser este.
- Alguém pedir ordenação por assinatura de evento. Isso não se acrescenta
  depois sem mudar o desenho da varredura.
