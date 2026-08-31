# ADR-0004: NestJS 11 em vez de 12, com gatilho de migração

- **Status:** Aceita
- **Data:** 2026-08-30
- **Fase:** 00
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

O scaffold da fase 00 começou no NestJS 12, que era a versão maior mais recente
na data desta decisão. Três problemas independentes apareceram em sequência, e
todos têm a mesma origem.

O NestJS 12 é distribuído **apenas como ESM**: o pacote declara
`"type": "module"` e não publica build CommonJS.

1. **`@nestjs/terminus` não suporta a versão 12.** A última versão publicada
   declara `peerDependencies` de `^10 || ^11`. O Terminus é a solução idiomática
   de health check no ecossistema.

2. **`nest build` quebra no Node 22.13.** O `@nestjs/cli` 12 carrega o
   `@angular-devkit/schematics` 22, que faz `require()` do pacote ESM `ora`
   dentro de um ciclo de módulos, e o processo morre com
   `ERR_REQUIRE_CYCLE_MODULE`.

3. **O Jest não consegue carregar o framework.** O runtime do Jest intercepta o
   `require` e não suporta `require(esm)` antes do Node 24.9. Todo teste que
   tocasse em `@nestjs/common`, inclusive o de um serviço que só usa o decorador
   `@Injectable()`, falhava ao carregar a suíte.

As saídas possíveis para o terceiro problema eram: habilitar o modo ESM
experimental do Jest, migrar para outro runner, ou converter a aplicação inteira
para ESM. Nenhuma delas resolve os dois primeiros.

## Decisão

O Paynow fixa o NestJS na linha 11, que é CommonJS, está em suporte e tem o
ecossistema alinhado.

A construção continua sendo feita com `tsc` direto, e não com `nest build`, o
que já resolvia o problema 2 e remove uma árvore grande de dependências do
caminho de build.

A restrição vale para **todo pacote do ecossistema NestJS**, e não apenas para
o núcleo. Os pacotes satélite seguem a mesma numeração maior e também passaram
a ser ESM na 12: `@nestjs/jwt@12` derrubou a suíte de testes da fase 01
exatamente do mesmo jeito, e teve que ser fixado na linha 11. Ao adicionar
qualquer `@nestjs/*` novo, fixe `^11` explicitamente.

## Consequências

### Positivas

- O ecossistema volta a funcionar: Terminus, Jest e as ferramentas de teste
  operam sem configuração experimental.
- O projeto continua clonável e executável por qualquer pessoa com Node 22, que
  é o requisito declarado no README, sem flags de runtime.
- A superfície de dependências diminui, porque `@nestjs/cli` e
  `@nestjs/schematics` saíram do grafo.

### Negativas

- O projeto fica uma versão maior atrás do framework, e essa distância cresce
  com o tempo.
- A migração futura para ESM será maior quanto mais tarde acontecer, porque
  todo import relativo passará a precisar de extensão explícita.
- Perde-se o acesso a recursos exclusivos da versão 12, nenhum dos quais o
  projeto usa hoje.

## Alternativas consideradas

### Manter a versão 12 e migrar a aplicação inteira para ESM

Rejeitada por custo desproporcional nesta fase. Exigiria `"type": "module"`,
extensão explícita em todo import relativo, e o modo ESM do Jest, que continua
documentado como experimental. O valor do projeto está no ledger, no relógio
virtual e na suíte adversarial, e não em ser cedo em uma migração de módulos.

### Manter a versão 12 e trocar o Jest por outro runner

Rejeitada porque resolveria apenas o terceiro problema. O Terminus continuaria
incompatível e o `nest build` continuaria quebrado. Além disso, o pacote
`@paynow/money` já usa Jest, e ter dois runners no mesmo monorepo é pior do que
ficar uma versão atrás.

### Manter a versão 12 confiando em `require(esm)` do Node

Rejeitada. Funciona em produção no Node 22.12 ou superior, mas não dentro do
Jest, e amarraria o projeto a um detalhe de versão de runtime que não está sob
controle de quem clona o repositório.

## Gatilho de revisão

Migrar para a versão 12 quando as três condições forem verdadeiras ao mesmo
tempo:

1. `@nestjs/terminus` publicar suporte à versão 12, ou o projeto decidir seguir
   sem ele em definitivo.
2. O Jest suportar `require(esm)` na versão de Node que o projeto declara, ou o
   modo ESM deixar de ser experimental.
3. Existir uma janela em que converter os imports relativos para extensão
   explícita não concorra com trabalho de domínio.

Enquanto isso, a distância é monitorada a cada atualização de dependências.
