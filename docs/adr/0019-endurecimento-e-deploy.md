# ADR-0019: endurecimento mínimo e um artefato só, com as lacunas nomeadas

- **Status:** Aceita
- **Data:** 2026-09-05
- **Fase:** 09
- **Substitui:** nenhuma
- **Substituída por:** nenhuma
- **Complementa:** [ADR-0001](0001-monolito-modular.md), [ADR-0012](0012-worker-no-mesmo-processo.md), [ADR-0016](0016-webhooks-entrega-e-recebimento.md)

## Contexto

O projeto vai para o ar como demonstração pública. Isso muda o que precisa ser
verdade: até aqui o único acesso era de quem tinha o repositório na máquina.

O que a exposição pública cria de novo:

- **Login sem limite é força bruta esperando acontecer.** É a rota mais atacada
  de qualquer sistema, e não há segundo fator aqui.
- **O webhook de entrada é público por necessidade.** O provedor não faz login.
- **O painel e a API ficam em domínios diferentes.** Sem CORS explícito o painel
  não funciona; com CORS frouxo, qualquer site age em nome de quem está logado.

## Decisão

### Limite de taxa global por IP, em memória

Global, e não por rota. Proteção que precisa ser lembrada em cada rota nova é
proteção que uma hora alguém esquece, e o esquecimento não aparece em teste
nenhum.

Em memória, com a limitação dita em voz alta: **com mais de um processo, cada um
conta o seu**, e o limite efetivo é o número de processos vezes o valor
configurado. Contar em Redis resolveria, e o Redis já está no projeto. Não foi
feito porque a demonstração roda com um processo, e a complexidade não teria
requisito para servir.

### CORS por lista explícita, e nunca `*`

A lista vem do ambiente e é vazia por padrão, o que significa mesma origem. Com
credencial em cookie, um `*` libera qualquer site a agir em nome de quem estiver
logado, e é pior do que não ter CORS: dá a impressão de proteção.

### Cabeçalhos de segurança sem CSP

`helmet`, com `contentSecurityPolicy` desligado. A aplicação serve JSON e a
documentação do Swagger, que carrega os próprios scripts. Uma CSP montada às
pressas para caber no Swagger seria uma CSP que não protege nada e dá a
impressão contrária.

### Um artefato, e migrations em passo separado

A mesma imagem serve HTTP e roda o worker, e a diferença é uma variável. É a
ADR-0012 levada ao deploy.

As migrations **não** rodam no boot. Um servidor que altera o schema ao subir
aplica a mesma migration N vezes quando há N réplicas, e as que perderem a
corrida sobem contra um schema pela metade. É um passo do deploy, e falha
visível quando falha.

### `pnpm deploy` para montar a imagem de produção

O pnpm usa store virtual, e `node_modules/@prisma/client` é link simbólico para
dentro de `.pnpm`, que o `COPY` do Docker não resolve. `pnpm deploy` monta uma
árvore achatada e autocontida. Copiar `node_modules` inteiro também funcionaria,
e traria junto tudo que só serve para build.

O cliente do Prisma é gerado **dentro** da árvore achatada, e não antes: o
`deploy` monta do zero e não leva o que foi gerado na árvore de build.

## Consequências

Boas:

- A imagem roda como usuário sem privilégio, tem cerca de 470 MB e foi
  verificada de pé contra PostgreSQL e Redis de verdade, com o health check
  respondendo.
- O limite de taxa foi verificado com o container no ar: cinco passam, o resto
  toma 429.
- `CMD` em forma de lista, sem shell, então o processo recebe SIGTERM e o
  encerramento gracioso do Nest roda de fato.

Ruins, e assumidas:

- **Limite de taxa em memória.** Descrito acima.
- **Sem observabilidade.** Não há tracing nem métrica exportada. A ADR-0013
  estava reservada para OpenTelemetry desde a fase 00 e não foi escrita. Em
  produção de verdade isso é a primeira coisa que falta.
- **Sem teste de carga.** O roteiro previa um, e ele não existe. Não há número
  algum sobre quanto este sistema aguenta, e afirmar qualquer coisa a respeito
  seria invenção.
- **Sem runbook de incidente.** Existe o `docs/deploy.md`, que é como subir, e
  não o que fazer quando cair.
- **A demonstração é pública e escrita por quem entrar.** O console de caos
  programa o provedor falso para o processo inteiro, então quem estiver olhando
  pode fazer a cobrança de outro visitante falhar. É aceitável numa demonstração
  e não seria em outro lugar.
- **O segredo do endereço de webhook continua em claro no banco.** Nomeado na
  ADR-0016 como trabalho desta fase, e não foi feito.

## Alternativas consideradas

**Limite de taxa em Redis.** O correto para mais de um processo, e recusado
porque a demonstração tem um. Entra assim que houver a segunda réplica.

**Migrations no boot da aplicação.** Um passo a menos no deploy, ao custo de uma
corrida entre réplicas que só aparece quando há réplicas, que é exatamente
quando dói mais.

**Imagens separadas para API e worker.** Recusada pelo mesmo motivo da ADR-0012:
são o mesmo código com um interruptor, e dois artefatos criariam duas coisas
para versionar e manter em sincronia.

**Serverless por função.** Não funciona com o worker, que é um cron dentro do
processo. Ficaria dependendo de um agendador externo chamando rotas, o que é
outra arquitetura e não uma opção de deploy.

## Gatilho de revisão

Esta decisão deve ser reaberta quando:

- Houver a segunda réplica. Aí o limite de taxa em memória passa a mentir, e as
  migrations no deploy deixam de ser precaução teórica.
- O primeiro incidente acontecer sem observabilidade. É o momento em que a
  ADR-0013 deixa de ser dívida e vira urgência.
- A demonstração receber tráfego de verdade. O console de caos, público e global
  ao processo, deixa de ser aceitável.
