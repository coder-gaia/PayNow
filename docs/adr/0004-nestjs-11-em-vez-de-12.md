# ADR-0004: NestJS 11 em vez de 12, com gatilho de migracao

- **Status:** Aceita
- **Data:** 2026-08-30
- **Fase:** 00
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

O scaffold da fase 00 comecou no NestJS 12, que era a versao maior mais recente
na data desta decisao. Tres problemas independentes apareceram em sequencia, e
todos tem a mesma origem.

O NestJS 12 e distribuido **apenas como ESM**: o pacote declara
`"type": "module"` e nao publica build CommonJS.

1. **`@nestjs/terminus` nao suporta a versao 12.** A ultima versao publicada
   declara `peerDependencies` de `^10 || ^11`. O Terminus e a solucao idiomatica
   de health check no ecossistema.

2. **`nest build` quebra no Node 22.13.** O `@nestjs/cli` 12 carrega o
   `@angular-devkit/schematics` 22, que faz `require()` do pacote ESM `ora`
   dentro de um ciclo de modulos, e o processo morre com
   `ERR_REQUIRE_CYCLE_MODULE`.

3. **O Jest nao consegue carregar o framework.** O runtime do Jest intercepta o
   `require` e nao suporta `require(esm)` antes do Node 24.9. Todo teste que
   tocasse em `@nestjs/common`, inclusive o de um servico que so usa o decorador
   `@Injectable()`, falhava ao carregar a suite.

As saidas possiveis para o terceiro problema eram: habilitar o modo ESM
experimental do Jest, migrar para outro runner, ou converter a aplicacao inteira
para ESM. Nenhuma delas resolve os dois primeiros.

## Decisao

O Paynow fixa o NestJS na linha 11, que e CommonJS, esta em suporte e tem o
ecossistema alinhado.

A construcao continua sendo feita com `tsc` direto, e nao com `nest build`, o
que ja resolvia o problema 2 e remove uma arvore grande de dependencias do
caminho de build.

## Consequencias

### Positivas

- O ecossistema volta a funcionar: Terminus, Jest e as ferramentas de teste
  operam sem configuracao experimental.
- O projeto continua clonavel e executavel por qualquer pessoa com Node 22, que
  e o requisito declarado no README, sem flags de runtime.
- A superficie de dependencias diminui, porque `@nestjs/cli` e
  `@nestjs/schematics` sairam do grafo.

### Negativas

- O projeto fica uma versao maior atras do framework, e essa distancia cresce
  com o tempo.
- A migracao futura para ESM sera maior quanto mais tarde acontecer, porque
  todo import relativo passara a precisar de extensao explicita.
- Perde-se o acesso a recursos exclusivos da versao 12, nenhum dos quais o
  projeto usa hoje.

## Alternativas consideradas

### Manter a versao 12 e migrar a aplicacao inteira para ESM

Rejeitada por custo desproporcional nesta fase. Exigiria `"type": "module"`,
extensao explicita em todo import relativo, e o modo ESM do Jest, que continua
documentado como experimental. O valor do projeto esta no ledger, no relogio
virtual e na suite adversarial, e nao em ser cedo em uma migracao de modulos.

### Manter a versao 12 e trocar o Jest por outro runner

Rejeitada porque resolveria apenas o terceiro problema. O Terminus continuaria
incompativel e o `nest build` continuaria quebrado. Alem disso, o pacote
`@paynow/money` ja usa Jest, e ter dois runners no mesmo monorepo e pior do que
ficar uma versao atras.

### Manter a versao 12 confiando em `require(esm)` do Node

Rejeitada. Funciona em producao no Node 22.12 ou superior, mas nao dentro do
Jest, e amarraria o projeto a um detalhe de versao de runtime que nao esta sob
controle de quem clona o repositorio.

## Gatilho de revisao

Migrar para a versao 12 quando as tres condicoes forem verdadeiras ao mesmo
tempo:

1. `@nestjs/terminus` publicar suporte a versao 12, ou o projeto decidir seguir
   sem ele em definitivo.
2. O Jest suportar `require(esm)` na versao de Node que o projeto declara, ou o
   modo ESM deixar de ser experimental.
3. Existir uma janela em que converter os imports relativos para extensao
   explicita nao concorra com trabalho de dominio.

Enquanto isso, a distancia e monitorada a cada atualizacao de dependencias.
