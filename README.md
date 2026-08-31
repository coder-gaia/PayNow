# Paynow

[![CI](https://github.com/coder-gaia/PayNow/actions/workflows/ci.yml/badge.svg)](https://github.com/coder-gaia/PayNow/actions/workflows/ci.yml)
[![Interface](https://github.com/coder-gaia/PayNow/actions/workflows/ui.yml/badge.svg)](https://github.com/coder-gaia/PayNow/actions/workflows/ui.yml)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-14654A.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.13-14654A.svg)](.nvmrc)

Motor de cobrança recorrente cuja corretude é **verificável**, e não apenas
afirmada. Saldo não é um campo, é uma consequência.

> Este é um projeto de engenharia, não um produto comercial. Ele existe para
> levar um domínio difícil até onde ele fica realmente difícil, e para provar,
> com teste reproduzível, que o resultado está correto.

## Sumário

- [O problema](#o-problema)
- [Os três pilares](#os-três-pilares)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Como rodar](#como-rodar)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Scripts](#scripts)
- [Documentação](#documentação)
- [Roadmap](#roadmap)
- [Licença](#licença)

## O problema

Cobrança recorrente é um dos poucos domínios em que um bug não é um incômodo de
interface: é dinheiro errado na conta de alguém, com rastro contábil e
consequência legal.

O Paynow foi desenhado em volta dos cenários em que sistemas de cobrança
realmente falham:

- o gateway entrega o mesmo webhook três vezes, fora de ordem, com três dias de
  atraso, e o efeito precisa ser exatamente um;
- o request de cobrança dá timeout, mas a cobrança foi efetivada do outro lado;
- dois requests alteram a mesma assinatura no mesmo milissegundo;
- o cliente faz upgrade no dia 12 de um ciclo de 30 dias e o rateio precisa
  fechar até o centavo;
- e a pergunta que resume todas as outras: **como provar que o saldo está certo?**

A resposta a essa última pergunta é a decisão da qual todo o resto do sistema
decorre: o saldo não é armazenado, é derivado de um livro contábil imutável de
partidas dobradas. O raciocínio completo está em [docs/why.md](docs/why.md).

## Os três pilares

### 1. Ledger verificável

Toda movimentação vira lançamento balanceado em contas nomeadas, com escrita
exclusivamente por acréscimo. A soma das linhas de um lançamento é sempre zero,
garantido por constraint no banco. A role da aplicação não tem permissão de
`UPDATE` nem `DELETE` no ledger: correção acontece por lançamento de estorno,
preservando a evidência do erro.

Os invariantes não vivem no código da aplicação, e sim no banco, porque uma
regra contábil que só vale no caminho feliz do código não é garantia:

| Invariante                               | Onde é garantido                                  |
| ---------------------------------------- | ------------------------------------------------- |
| Todo lançamento soma zero, por moeda     | Constraint trigger diferida, verificada no commit |
| Nenhuma linha é alterada ou removida     | Trigger que recusa `UPDATE` e `DELETE`            |
| Linha de valor zero é recusada           | `CHECK (amount_minor <> 0)`                       |
| O mesmo evento não vira dois lançamentos | Índice único sobre `(organização, tipo, evento)`  |

`pnpm ledger:verify` recalcula tudo a partir das linhas, sem confiar em nenhum
valor derivado gravado, e sai com código diferente de zero se algo não fechar.

Ver [ADR-0003](docs/adr/0003-ledger-de-partidas-dobradas.md),
[ADR-0005](docs/adr/0005-prisma-e-sql-cru.md) e o
[plano de contas](docs/plano-de-contas.md).

### 2. Relógio virtual

Nenhuma linha do domínio chama `new Date()`, e uma regra de lint quebra o build
se alguém tentar. O tempo é injetado, e cada organização tem o seu próprio
relógio, que pode ser congelado e adiantado por comando.

O instante é resolvido uma vez na borda do request e guardado em um escopo de
`AsyncLocalStorage`. Todo código chamado dentro dele enxerga a mesma hora sem
receber parâmetro, então o relógio virtual entrou sem que nenhuma assinatura de
método mudasse. A [ADR-0015](docs/adr/0015-relogio-virtual-por-organizacao.md)
registra por que não foi um provedor com escopo de request do Nest.

O tempo é **congelado**, e não deslocado. Um deslocamento somado ao relógio real
continua andando sozinho, e a mesma sequência de comandos produziria históricos
diferentes. Congelado, ela produz sempre a mesma história, que é o que torna a
suíte adversarial da fase 07 possível.

O efeito prático: um ano de ciclos de cobrança é verificado em milissegundos,
contra o banco de verdade e sem nenhum dublê de relógio, e o painel adianta
três meses em um clique para mostrar as renovações acontecendo e as faturas
chegando ao razão. Sem isso, demonstrar um sistema de cobrança exigiria esperar
trinta dias.

### O painel

O painel é um BFF: o navegador nunca fala direto com a API. Os tokens ficam em
cookie `httpOnly`, e não em `localStorage`, porque qualquer script injetado na
página lê `localStorage` e um refresh token roubado vale por trinta dias. O
servidor do Next é o único que vê os tokens, e a renovação acontece no
middleware, antes de qualquer página renderizar.

Ele nasceu na fase 01 e cresce junto com o backend, em vez de aparecer inteiro
no fim. Hoje mostra contas, organização, membros, chaves de API, o explorador do
razão, a carteira de assinaturas com troca de plano rateada e a linha do tempo
que adianta o relógio e liquida o que vencer.

### 3. Suíte adversarial

Um gateway falso programável que falha, dá timeout, duplica webhooks e os entrega
fora de ordem, combinado com um harness determinístico que embaralha milhares de
cenários por build e afirma duas coisas: o estado final converge
independentemente da ordem de chegada, e o ledger nunca desbalanceia em nenhum
passo intermediário.

Roda no CI. Toda falha é reproduzível por uma seed.

## Arquitetura

Um único artefato de deploy, com módulos de domínio isolados por fronteiras
impostas por lint, executável em dois modos selecionados por variável de
ambiente. O raciocínio, incluindo por que não são microserviços, está na
[ADR-0001](docs/adr/0001-monolito-modular.md).

```mermaid
flowchart LR
    subgraph clientes[" "]
        painel["Painel<br/>Next.js"]
        merchant["API do merchant<br/>chave sk_"]
    end

    subgraph api["apps/api  ·  uma imagem, dois modos"]
        direction TB
        identity["identity"]
        catalog["catalog"]
        subs["subscriptions"]
        pay["payments"]
        ledger["ledger"]
        hooks["webhooks"]
        worker["modo worker<br/>outbox · dunning · reconciliação"]
    end

    subgraph dados[" "]
        pg[("PostgreSQL")]
        redis[("Redis + BullMQ")]
    end

    subgraph gateways["porta PaymentGateway"]
        fake["FakeGateway<br/>falhas programáveis"]
        stripe["StripeGateway<br/>modo de teste"]
    end

    painel --> api
    merchant --> api
    api --> pg
    api --> redis
    api --> gateways
    hooks -- "webhook assinado HMAC" --> destino["endpoint do merchant"]
```

A regra `boundaries/element-types` no ESLint impede que um módulo de domínio
importe outro. A comunicação entre eles acontece por eventos, que passam pelo
outbox transacional. Essa é a mesma costura que uma extração para serviço
independente usaria.

```
entrypoint  ->  config, platform, qualquer módulo de domínio
platform    ->  platform, config
domínio     ->  platform, config, ele mesmo
domínio     ->  outro domínio: o build quebra
```

## Stack

| Camada          | Escolha                                         |
| --------------- | ----------------------------------------------- |
| Runtime         | Node 22, TypeScript 5.9                         |
| API             | NestJS 11, OpenAPI via Swagger                  |
| Persistência    | PostgreSQL 16, Prisma                           |
| Fila e cache    | Redis, BullMQ                                   |
| Testes          | Jest, Supertest, Testcontainers, fast-check, k6 |
| Frontend        | Next.js, TanStack Query, Tailwind               |
| Observabilidade | OpenTelemetry, Sentry, Datadog, Honeybadger     |
| Infraestrutura  | Docker, GitHub Actions, Heroku                  |

## Como rodar

### Pré-requisitos

- Node 22.13 ou superior
- pnpm 11
- Docker e Docker Compose

### Passo a passo

```bash
git clone https://github.com/coder-gaia/PayNow.git
cd PayNow

cp .env.example .env
pnpm install

# sobe PostgreSQL, Redis e Mailpit
pnpm infra:up

# aplica as migrations
pnpm db:deploy

# popula dados de demonstracao
pnpm db:seed

# sobe a API e o painel juntos
pnpm dev
```

### Dados de demonstração

`pnpm db:seed` cria uma organização com quatro contas, uma por papel, uma
chave de API de teste, o razão de referência do plano de contas e uma carteira
de assinaturas. É idempotente: rodar de novo não duplica nada.

| Papel      | Email                        | Para que serve                                         |
| ---------- | ---------------------------- | ------------------------------------------------------ |
| `OWNER`    | `ana@livraria-aurora.test`   | Vê tudo, promove e remove qualquer pessoa              |
| `ADMIN`    | `bruno@livraria-aurora.test` | Administra membros e chaves, não mexe em quem é OWNER  |
| `MEMBER`   | `carla@livraria-aurora.test` | Opera o dia a dia, não administra                      |
| `READONLY` | `davi@livraria-aurora.test`  | Só consulta, útil para conferir as restrições de papel |

A senha é `paynow-demo-2026` para todas. A chave de API de teste é
`sk_test_paynowdemo0000000000000000000000000000`.

A carteira de demonstração traz três planos e quatro assinaturas, cada uma em um
estado diferente, para que a máquina de estados apareça na tela em vez de virar
uma lista de linhas iguais:

| Cliente     | Plano      | Estado     | Por que este estado                              |
| ----------- | ---------- | ---------- | ------------------------------------------------ |
| Padaria Lua | Pro        | `ACTIVE`   | O caso comum: assinatura em dia                  |
| Studio Vega | Enterprise | `ACTIVE`   | Serve para exercitar a troca de plano com rateio |
| Bike Norte  | Pro        | `TRIALING` | Em período de teste, ainda sem fatura no razão   |
| Mercado Sul | Básico     | `PAST_DUE` | Cobrança falhou, mas o acesso continua valendo   |

```bash
# entra como a dona da conta
curl -s localhost:3333/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ana@livraria-aurora.test","password":"paynow-demo-2026"}'

# consulta o contexto da chave de API
curl -s localhost:3333/v1/merchant/me \
  -H 'authorization: Bearer sk_test_paynowdemo0000000000000000000000000000'
```

Esses dados só existem em banco local recriável e não valem nada fora dele. O
seed recusa rodar com `NODE_ENV=production`.

As suítes ponta a ponta criam contas e organizações descartáveis a cada
execução, e não as apagam. Isso é proposital: um teste que limpa o banco no fim
esconde o estado que causou a falha. Para voltar ao ponto de partida, use
`pnpm db:reset`, que recria o schema e roda o seed.

Depois disso:

| Endereço                                | O que é                           |
| --------------------------------------- | --------------------------------- |
| http://localhost:3000                   | Painel                            |
| http://localhost:3333/docs              | Documentação OpenAPI              |
| http://localhost:3333/docs/openapi.json | Contrato OpenAPI em JSON          |
| http://localhost:3333/health/live       | Liveness probe                    |
| http://localhost:3333/health/ready      | Readiness, verifica banco e Redis |
| http://localhost:8025                   | Mailpit, caixa de entrada local   |

O PostgreSQL do compose é publicado em **5433**, e não na 5432. A porta padrão
costuma já estar ocupada por uma instalação nativa, e quando isso acontece a
aplicação conecta silenciosamente no banco errado em vez de falhar. O Redis fica
na 6379 normalmente.

Todas as variáveis de ambiente vivem em um único `.env` na raiz do repositório,
que serve a aplicação, o Prisma CLI e os testes.

### Codespaces

O repositório traz um dev container. Abrir no GitHub Codespaces já entrega
Node, pnpm, Docker e os serviços de apoio configurados, sem instalar nada
localmente.

## Estrutura do repositório

```
paynow/
├── apps/
│   ├── api/                  # NestJS: HTTP e worker no mesmo artefato
│   │   └── src/
│   │       ├── config/       # validação de ambiente
│   │       └── modules/
│   │           ├── platform/ # relógio, outbox, idempotência, telemetria
│   │           └── ...       # módulos de domínio
│   └── web/                  # Next.js: painel, cresce a cada fase
│       └── src/
│           ├── app/          # rotas, Server Components e Server Actions
│           ├── components/   # kit visual compartilhado
│           ├── lib/          # cliente da API e ciclo de sessão
│           └── middleware.ts # renovação de token antes de cada request
├── packages/
│   └── money/                # value object monetário em unidade mínima
├── tools/                    # harness de caos e testes de carga
└── docs/
    ├── adr/                  # decisões arquiteturais, numeradas e imutáveis
    ├── pagina-inicial.md     # desenho da porta de entrada
    ├── plano-de-contas.md    # contrato contábil do ledger
    └── why.md                # motivação do projeto
```

## Scripts

| Comando            | O que faz                                             |
| ------------------ | ----------------------------------------------------- |
| `pnpm dev`         | Sobe a aplicação em modo desenvolvimento              |
| `pnpm build`       | Compila todos os pacotes                              |
| `pnpm lint`        | ESLint, incluindo as regras de fronteira e de relógio |
| `pnpm typecheck`   | Verificação de tipos sem emitir                       |
| `pnpm test`        | Testes unitários e de integração                      |
| `pnpm test:cov`    | Testes com relatório de cobertura                     |
| `pnpm format`      | Formata o repositório com Prettier                    |
| `pnpm infra:up`    | Sobe PostgreSQL, Redis e Mailpit                      |
| `pnpm infra:down`  | Derruba os serviços de apoio                          |
| `pnpm infra:reset` | Derruba, apaga os volumes e sobe de novo              |
| `pnpm db:migrate`  | Cria e aplica migration em desenvolvimento            |
| `pnpm db:deploy`   | Aplica migrations pendentes                           |
| `pnpm db:studio`   | Abre o Prisma Studio                                  |
| `pnpm db:seed`     | Popula o banco local com os dados de demonstração     |

## Página inicial

A porta de entrada do projeto é um lançamento contábil: coluna de débito com o
que quebra em um sistema de cobrança, coluna de crédito com o que o Paynow faz
a respeito, e a soma fechando em zero no rodapé. A forma da página é a ideia
central do produto.

Uma página que **afirma** ser confiável contradiz a tese, que é a de que
corretude se verifica. Por isso, abaixo do lançamento, três botões agem contra
a API de verdade e mostram as linhas nascendo: emitir uma fatura, trocar de
plano no meio do ciclo, adiantar três meses.

O desenho está em [docs/pagina-inicial.md](docs/pagina-inicial.md) e a
implementação é da fase 08, porque depende de uma organização pública de
demonstração com limite de taxa.

## Documentação

| Documento                                          | Conteúdo                                              |
| -------------------------------------------------- | ----------------------------------------------------- |
| [docs/why.md](docs/why.md)                         | Por que o projeto existe e qual problema ele ataca    |
| [docs/plano-de-contas.md](docs/plano-de-contas.md) | Contrato contábil, contas e lançamentos de referência |
| [docs/pagina-inicial.md](docs/pagina-inicial.md)   | Desenho da porta de entrada, em forma de razão        |
| [docs/adr/](docs/adr/)                             | Decisões arquiteturais, numeradas e imutáveis         |

## Roadmap

Cada fase tem um critério de pronto verificável, e não opinativo.

- [x] **00 Fundação.** Monorepo, dev container, health checks, primeira
      migration, CI.
- [x] **01 Identidade.** Usuários, organizações, JWT com rotação de refresh e
      detecção de reuso, RBAC, chaves de API.
- [x] **02 Ledger.** Contas, lançamentos, invariantes no banco, saldo derivado,
      auditoria, testes de propriedade.
- [x] **03 Catálogo e assinaturas.** Produtos, preços, planos, máquina de
      estados, trial, rateio proporcional.
- [x] **04 Relógio e ciclo de cobrança.** Relógio virtual, agendamento, avanço
      determinístico do tempo.
- [ ] **05 Pagamentos.** Porta de gateway, idempotência, outbox, retry, dunning,
      estorno.
- [ ] **06 Webhooks.** Entrada com deduplicação, saída com HMAC, retry e replay.
- [ ] **07 Suíte adversarial.** Harness determinístico integrado ao CI.
- [ ] **08 Painel e demonstração.** Página inicial em forma de razão, métricas,
      console de caos, fatura explicável.
- [ ] **09 Endurecimento e lançamento.** Limite de taxa, modelo de ameaças,
      teste de carga, runbooks, deploy.

## Licença

Distribuído sob a Licença MIT. Veja [LICENSE](LICENSE) para o texto completo.

```
MIT License

Copyright (c) 2026 Alexandre Gaia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
