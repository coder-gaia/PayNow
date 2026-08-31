# ADR-0005: Prisma para schema e tipos, SQL cru no núcleo do ledger

- **Status:** Aceita
- **Data:** 2026-08-31
- **Fase:** 02
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

A ADR-0003 estabeleceu que a fonte da verdade financeira é um livro de partidas
dobradas com escrita exclusivamente por acréscimo, e que três invariantes
precisam valer sempre:

1. todo lançamento soma zero, por moeda;
2. nenhuma linha é alterada ou removida;
3. o mesmo evento de domínio não produz dois lançamentos.

O Prisma resolve muito bem o que é modelagem, tipagem e migração. Nenhum dos
três invariantes acima, porém, é expressável no schema dele:

- soma zero é uma condição sobre um conjunto de linhas, e não sobre uma linha,
  então não cabe em `CHECK`;
- append-only exige recusar `UPDATE` e `DELETE`, o que é comportamento do banco
  e não do cliente;
- unicidade do evento o Prisma até expressa, e ela está no schema.

A pergunta é onde colocar o que o Prisma não expressa: na camada de aplicação
ou no banco.

## Decisão

O Prisma continua dono do schema, das migrations e dos tipos. As regras que ele
não expressa vão para **SQL escrito à mão dentro da migration**, e não para a
camada de aplicação:

- **Constraint trigger diferida** em `journal_entries`, executada no commit, que
  recusa lançamento com menos de duas linhas ou cuja soma por moeda não seja
  zero. Diferida porque as linhas são inseridas uma a uma e, no meio da
  transação, o lançamento está legitimamente desbalanceado.
- **Trigger `BEFORE UPDATE OR DELETE`** em `journal_entries` e `journal_lines`
  que lança exceção. Trigger, e não `REVOKE`, porque `REVOKE` não alcança o dono
  do banco e a aplicação conecta como dono em desenvolvimento.
- **`CHECK (amount_minor <> 0)`**, porque linha de valor zero não movimenta nada.

As consultas de saldo e a auditoria usam `$queryRaw` com SQL escrito à mão. Não
é falta de suporte do Prisma: é que agregação com `GROUP BY ... HAVING` e cast
explícito de `bigint` fica mais legível e mais previsível escrita direto do que
montada pelo construtor de consultas.

O `LedgerService` também valida antes de enviar ao banco. Isso é redundância
deliberada, e a hierarquia é clara: a validação da aplicação existe para
produzir mensagem útil, o banco existe para garantir.

## Consequências

### Positivas

- Os invariantes valem para qualquer conexão, inclusive um `psql` aberto por
  engano, um script de migração de dados ou um bug futuro no serviço.
- A garantia não depende de todo caminho de escrita lembrar de chamar a
  validação certa, que é exatamente o tipo de disciplina que falha sob pressa.
- Mensagens de erro do banco dizem qual lançamento e quanto sobrou, o que torna
  a violação diagnosticável sem abrir o código.
- Consultas de agregação ficam legíveis e com o tipo de retorno sob controle.

### Negativas

- A migration passa a conter SQL que o Prisma não gerou e não sabe reverter
  automaticamente. Recriar o banco do zero funciona; um `migrate diff` sobre
  esse trecho não.
- `$queryRaw` não é tipado pelo schema: o tipo de retorno é declarado à mão e
  pode divergir da consulta sem que o compilador perceba. Mitigado por testes de
  integração que rodam contra o banco real.
- Quem for mexer no ledger precisa saber ler PL/pgSQL, e não apenas Prisma.
- O trigger de append-only impede limpeza de dados de teste sem desativá-lo,
  o que já aconteceu durante o desenvolvimento e é um incômodo real.

## Alternativas consideradas

### Validar apenas na camada de aplicação

Rejeitada. Uma regra contábil que só vale no caminho feliz do código não é
garantia, é convenção. Bastaria um script de correção de dados, uma migração
futura ou um segundo serviço para furá-la, e o furo só apareceria no fechamento.

### Trocar o Prisma por um construtor de consultas como Kysely ou Drizzle

Rejeitada por desproporção. O Prisma cobre bem noventa por cento do sistema, e
o que ele não cobre é justamente o que se quer escrever em SQL explícito de
qualquer forma. Trocar a ferramenta inteira para melhorar dez por cento do
código custaria reescrever o módulo de identidade sem ganho correspondente.

### `REVOKE UPDATE, DELETE` em vez de trigger

Rejeitada como solução única, aceita como complemento. `REVOKE` não afeta o dono
do banco, e a aplicação conecta como dono em desenvolvimento, então a proteção
seria inexistente justamente onde o erro é mais provável. Separar a role da
aplicação entra no endurecimento da fase 09 e **soma** a esta decisão.

## Gatilho de revisão

Reabrir se o volume de linhas tornar a auditoria completa inviável dentro da
janela de execução, momento em que entram fechamento de período e saldos
congelados por data, ou se o Prisma passar a expressar constraints de conjunto
no schema.
