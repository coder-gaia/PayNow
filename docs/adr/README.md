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

| ADR                                                | Título                                                        | Status |
| -------------------------------------------------- | ------------------------------------------------------------- | ------ |
| [0001](0001-monolito-modular.md)                   | Monólito modular em vez de microserviços                      | Aceita |
| [0002](0002-dinheiro-como-inteiro.md)              | Dinheiro como inteiro em unidade mínima                       | Aceita |
| [0003](0003-ledger-de-partidas-dobradas.md)        | Ledger append-only de partidas dobradas como fonte da verdade | Aceita |
| [0004](0004-nestjs-11-em-vez-de-12.md)             | NestJS 11 em vez de 12, com gatilho de migração               | Aceita |
| [0005](0005-prisma-e-sql-cru.md)                   | Prisma para schema e tipos, SQL cru no núcleo do ledger       | Aceita |
| [0008](0008-advisory-locks-para-assinatura.md)     | Advisory locks para mutação de assinatura                     | Aceita |
| [0006](0006-outbox-transacional.md)                | Outbox transacional ao lado da entrega em transação           | Aceita |
| [0007](0007-idempotency-key.md)                    | Idempotency-Key no modelo do Stripe                           | Aceita |
| [0009](0009-relogio-injetado.md)                   | Relógio injetado em vez de acesso direto ao tempo             | Aceita |
| [0010](0010-autenticacao-propria.md)               | Autenticação própria em vez de provedor externo               | Aceita |
| [0011](0011-porta-de-gateway.md)                   | Porta de gateway com implementação falsa como padrão          | Aceita |
| [0012](0012-worker-no-mesmo-processo.md)           | Worker no mesmo processo, com flag e gatilho de extração      | Aceita |
| [0014](0014-escopo-pci-saq-a.md)                   | Escopo PCI-DSS SAQ-A por desenho                              | Aceita |
| [0015](0015-relogio-virtual-por-organizacao.md)    | Relógio virtual por organização, via AsyncLocalStorage        | Aceita |
| [0016](0016-webhooks-entrega-e-recebimento.md)     | Webhooks: entrega separada do consumo, entrada deduplicada    | Aceita |
| [0017](0017-suite-adversarial-por-convergencia.md) | Suíte adversarial que compara duas execuções                  | Aceita |
| [0018](0018-recuperacao-tardia.md)                 | Dinheiro tardio reativa o que não morreu, e nunca ressuscita  | Aceita |
| [0019](0019-endurecimento-e-deploy.md)             | Endurecimento mínimo e um artefato só                         | Aceita |

Os números abaixo estão reservados no plano do projeto. Cada ADR é escrita na
fase em que a decisão passa a valer, que nem sempre é a fase prevista: a
ADR-0009 saiu na fase 01 porque o módulo de identidade já precisava calcular
expiração de token, e isso exigiu a porta de relógio antes do previsto.

| Prevista | Título                                          | Fase |
| -------- | ----------------------------------------------- | ---- |
| 0006     | Outbox transacional em vez de publicação direta | 05   |
| 0007     | Idempotency-Key no modelo do Stripe             | 05   |
| 0013     | OpenTelemetry com Datadog como backend          | 09   |

Use [template.md](template.md) para criar uma nova.
