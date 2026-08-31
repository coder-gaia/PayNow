# ADR-0015: relógio virtual por organização, resolvido por AsyncLocalStorage

- **Status:** Aceita
- **Data:** 2026-08-31
- **Fase:** 04
- **Substitui:** nenhuma
- **Substituída por:** nenhuma
- **Complementa:** [ADR-0009](0009-relogio-injetado.md)

## Contexto

A ADR-0009 tirou o relógio do sistema das mãos do domínio e o colocou atrás de
uma porta. Ela também deixou uma pergunta em aberto de propósito: `Clock.now()`
não recebe organização, e o comentário na interface prometia que a fase 04
resolveria isso trocando a instância, e não a assinatura.

Esta ADR paga essa promessa, e o motivo é o segundo pilar do projeto.

Cobrança recorrente é um domínio em que quase todo comportamento interessante
acontece na passagem do tempo: a renovação do ciclo, o fim do teste, a primeira
falha de pagamento, a recuperação, a expiração. Sem controle sobre o relógio,
verificar qualquer um deles exige esperar de verdade. O que se faz na prática é
não verificar, ou verificar contra um dublê que responde o que o teste mandou,
o que confirma o dublê e não o sistema.

O requisito, então, é que **a aplicação inteira** consiga enxergar um instante
falso para uma organização, sem que nenhum código de domínio saiba disso e sem
que nenhuma assinatura de método mude.

Três restrições moldam a solução:

1. O congelamento é **por organização**. Uma demonstração precisa poder viajar
   seis meses no futuro sem afetar ninguém.
2. `Clock.now()` é **síncrono**. Quem pergunta as horas não pode ter que
   esperar uma consulta ao banco.
3. O escopo precisa valer **também fora do request**: o ciclo de cobrança roda
   em worker na fase 05, e os testes agem em nome de uma organização sem que
   exista HTTP.

## Decisão

O instante é resolvido uma vez na borda e guardado em um escopo de
`AsyncLocalStorage`. Tudo que rodar dentro desse escopo, em qualquer
profundidade da pilha, enxerga o mesmo instante sem receber parâmetro.

```ts
interface ClockScope {
  organizationId: string;
  now: Date;
  virtual: boolean;
}
```

Um interceptor abre o escopo quando a rota tem `organizationId`. Fora dele, o
relógio cai no de parede, que é o correto para o probe de prontidão, para a
inicialização e para o seed: nenhum age em nome de uma organização.

O estado persistido é **congelamento explícito**, no espírito do test clock do
Stripe: uma linha em `organization_clocks` com o instante parado. Sem linha, é
relógio de parede. O tempo só anda por comando.

Duas consequências desse desenho merecem destaque, porque não são acidentes.

**O instante é congelado para o request inteiro, mesmo em relógio de parede.**
Um lançamento contábil cujas linhas nascem com milissegundos diferentes conta
duas histórias sobre quando aconteceu. Uma leitura de tempo por request elimina
a classe inteira desses defeitos.

**Congelamento em vez de deslocamento.** Um deslocamento somado ao relógio real
continua andando sozinho, e rodar a mesma sequência de comandos duas vezes
produziria históricos diferentes, porque o tempo real passou entre uma e outra.
Com congelamento, a mesma sequência produz sempre a mesma história. É essa
propriedade que torna a suíte adversarial da fase 07 possível.

## Consequências

### Positivas

- Um ano de ciclos de cobrança é verificado em milissegundos, contra o banco de
  verdade, sem nenhum dublê de relógio. O teste de renovação anual do
  `billing-cycle.e2e-spec.ts` é literalmente o comportamento de produção.
- Nenhuma assinatura de método mudou. O domínio continua pedindo as horas ao
  `Clock` injetado e recebendo a resposta certa.
- O grafo de injeção continua todo em escopo singleton.
- A demonstração ganha o recurso mais convincente que um sistema de cobrança
  pode ter em uma entrevista: arrastar o tempo e ver a contabilidade acontecer.

### Negativas

- Uma consulta a mais por request que tenha `organizationId` na rota. É chave
  primária, uma linha, e na maioria esmagadora dos casos a linha não existe.
- `AsyncLocalStorage` é mais difícil de seguir do que um parâmetro. Quem lê
  `clock.now()` não vê de onde o instante veio, e é preciso conhecer o
  interceptor para entender.
- O escopo se perde em qualquer fronteira que quebre a cadeia assíncrona. Com
  RxJS o erro é clássico: assinar `next.handle()` fora do `run` deixa o handler
  rodando sem escopo. O interceptor usa `switchMap` de dentro do `run`
  exatamente por isso.
- Fora de escopo o relógio cai no de parede em silêncio. A alternativa seria
  lançar, o que transformaria todo caminho novo sem escopo em erro em produção.
  O risco oposto, de uma leitura escapar sem ninguém notar, é coberto pelo
  teste que congela o relógio e confere que o ciclo inteiro respondeu à data
  falsa.
- Um relógio virtual é uma arma apontada para os dados. A fase 09 restringe o
  recurso por ambiente; hoje ele exige papel ADMIN e vale só para a
  organização de quem chamou.

## Alternativas consideradas

### Provedor com escopo de request do Nest

`{ provide: CLOCK, useClass: OrganizationClock, scope: Scope.REQUEST }` é a
solução idiomática do framework e resolveria o problema.

Rejeitada pelo custo de contaminação. No Nest, o escopo sobe: todo provedor que
injeta um provedor com escopo de request passa a ter escopo de request também,
e o mesmo vale para quem injeta esse. Como praticamente todo serviço do sistema
precisa saber que horas são, o grafo inteiro viraria escopo de request, com uma
instância nova de cada serviço a cada chamada. Trocar o modelo de instanciação
da aplicação inteira para resolver tempo é desproporcional.

### Passar `organizationId` para `now()`

`clock.now(organizationId)` é explícito e não tem mágica nenhuma.

Rejeitada, e a ADR-0009 já havia rejeitado. O identificador teria que ser
carregado por toda função que em algum momento precisa de tempo, incluindo as
que não têm nada a ver com organização, só para repassá-lo adiante. É o
problema do parâmetro que atravessa camadas para ser usado no fim, e ele
apareceria em dezenas de assinaturas.

Pior: a assinatura ficaria assíncrona, porque resolver o relógio consulta o
banco. `await clock.now()` em todo lugar que precisa de uma data é um preço
alto por uma propriedade que o escopo entrega de graça.

### Um relógio global, não por organização

Uma variável de processo com o instante congelado seria trivial.

Rejeitada porque quebra o isolamento entre organizações, que é a coisa que um
SaaS não pode quebrar. Um congelamento afetaria toda a base ao mesmo tempo, o
que impede a demonstração de existir junto com qualquer outro uso e transforma
o recurso em algo que só pode rodar em ambiente separado.

### Ambiente separado para a demonstração

Subir uma instância dedicada com o tempo controlado, e deixar a produção
intocada.

Rejeitada por dobrar a infraestrutura para resolver o que o escopo por
organização já resolve, e por afastar a demonstração do sistema real. Uma
demonstração que roda em outro binário deixa de ser evidência de que o sistema
funciona.

### Bibliotecas de viagem no tempo, como `@sinonjs/fake-timers`

Substituem `Date` globalmente no processo.

Rejeitadas por serem ferramenta de teste, e não de produção. Elas alteram o
processo inteiro, o que é inaceitável em um servidor que atende várias
organizações, e o objetivo aqui é justamente que a demonstração use o mesmo
caminho de código que a produção.

## Gatilho de revisão

Reabrir se a consulta do relógio aparecer no perfil de latência, momento em que
entra um cache de curta duração por organização, com invalidação no comando de
avanço. Reabrir também quando o worker da fase 05 entrar, para confirmar que
abrir o escopo por job é suficiente e que nenhum caminho de fila escapa dele.
