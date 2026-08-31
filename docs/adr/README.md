# Registros de decisão arquitetural

Uma ADR (Architecture Decision Record) documenta uma decisão relevante no
momento em que ela é tomada, com o contexto que existia na época.

## Regras

- ADRs são **numeradas e imutáveis**. Uma decisão revista não é editada: ganha
  uma ADR nova, que declara qual anterior ela substitui.
- Uma ADR é escrita **no momento da decisão**, não depois. Uma ADR escrita
  retroativamente documenta uma justificativa, não uma decisão.
- Toda ADR registra as **alternativas rejeitadas** e o motivo. A alternativa
  rejeitada costuma ser a informação mais útil do documento.
- Toda ADR tem um **gatilho de revisão**: a condição concreta que faria valer a
  pena reabrir a discussão.

## Status possíveis

| Status        | Significado                                                |
| ------------- | ---------------------------------------------------------- |
| `Proposta`    | Em discussão, ainda não vale                               |
| `Aceita`      | Vale, e o código deve refleti-la                           |
| `Substituída` | Foi trocada por outra ADR, que é referenciada no cabeçalho |
| `Descartada`  | Foi considerada e rejeitada sem substituição               |

## Índice

| ADR                                         | Título                                                        | Status |
| ------------------------------------------- | ------------------------------------------------------------- | ------ |
| [0001](0001-monolito-modular.md)            | Monólito modular em vez de microserviços                      | Aceita |
| [0002](0002-dinheiro-como-inteiro.md)       | Dinheiro como inteiro em unidade mínima                       | Aceita |
| [0003](0003-ledger-de-partidas-dobradas.md) | Ledger append-only de partidas dobradas como fonte da verdade | Aceita |
| [0004](0004-nestjs-11-em-vez-de-12.md)      | NestJS 11 em vez de 12, com gatilho de migração               | Aceita |
| [0009](0009-relogio-injetado.md)            | Relógio injetado em vez de acesso direto ao tempo             | Aceita |
| [0010](0010-autenticacao-propria.md)        | Autenticação própria em vez de provedor externo               | Aceita |

Os números abaixo estão reservados no plano do projeto. Cada ADR é escrita na
fase em que a decisão passa a valer, que nem sempre é a fase prevista: a
ADR-0009 saiu na fase 01 porque o módulo de identidade já precisava calcular
expiração de token, e isso exigiu a porta de relógio antes do previsto.

| Prevista | Título                                                     | Fase |
| -------- | ---------------------------------------------------------- | ---- |
| 0005     | Prisma para schema e tipos, SQL cru no núcleo transacional | 02   |
| 0006     | Outbox transacional em vez de publicação direta            | 05   |
| 0007     | Idempotency-Key no modelo do Stripe                        | 05   |
| 0008     | Advisory locks para mutação de assinatura                  | 03   |
| 0011     | Porta de gateway com implementação falsa e Stripe em teste | 05   |
| 0012     | Worker no mesmo processo, com flag e gatilho de extração   | 05   |
| 0013     | OpenTelemetry com Datadog como backend                     | 09   |
| 0014     | Escopo PCI-DSS SAQ-A por desenho                           | 05   |

Use [template.md](template.md) para criar uma nova.
