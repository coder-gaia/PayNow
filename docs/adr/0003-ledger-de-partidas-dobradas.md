# ADR-0003: ledger append-only de partidas dobradas como fonte da verdade

- **Status:** Aceita
- **Data:** 2026-08-30
- **Fase:** 00
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Existe um caminho fácil para representar dinheiro em uma aplicação:

```sql
UPDATE customer SET balance = balance - 10000 WHERE id = $1;
```

Ele tem três problemas, em ordem crescente de gravidade.

**Concorrência.** A operação real quase nunca é um `UPDATE` puro: é ler o saldo,
decidir se a operação é válida, e escrever o novo valor. Dois requests
simultâneos nesse ciclo produzem escrita perdida.

**Auditoria.** Depois do `UPDATE`, o valor anterior não existe mais. Não há como
responder por que o saldo é esse.

**Correção.** Corrigir um erro significa sobrescrever o valor errado, apagando a
evidência de que o erro aconteceu. Em um sistema financeiro isso é inaceitável:
a trilha do erro é tão importante quanto a correção.

O Paynow se propõe explicitamente a provar que o saldo está correto. Uma coluna
mutável não é passível de prova.

## Decisão

A fonte da verdade financeira do Paynow é um livro contábil de partidas dobradas
com escrita exclusivamente por acréscimo.

- Toda movimentação financeira gera um **lançamento** com duas ou mais **linhas**.
- Cada linha carrega um inteiro com sinal: positivo é débito, negativo é crédito.
- **A soma das linhas de um lançamento é obrigatoriamente zero**, garantido por
  constraint `deferrable` no banco.
- **Nenhuma linha é alterada ou removida.** A role da aplicação sofre
  `REVOKE UPDATE, DELETE` nas tabelas do ledger. Correção acontece por lançamento
  de estorno.
- **O saldo nunca é armazenado.** Ele é derivado por soma sobre as linhas, com
  snapshot periódico por conta apenas como aceleração de leitura, sempre
  reconferido contra a soma completa.
- Todo lançamento aponta para o evento de domínio que o originou.

O plano de contas e os lançamentos de referência estão em
[docs/plano-de-contas.md](../plano-de-contas.md).

## Consequências

### Positivas

- Auditabilidade completa: existe resposta para "por que o saldo é esse".
- Concorrência deixa de causar escrita perdida, porque escritas concorrentes são
  inserções independentes e ambas sobrevivem.
- O invariante de soma zero é verificável a qualquer momento, sobre o banco
  inteiro, por uma única consulta.
- Habilita testes de propriedade: gerar sequências aleatórias de operações e
  afirmar que os invariantes continuam válidos.
- Erro se corrige preservando a evidência.
- Torna possível a funcionalidade de fatura explicável, em que cada linha de
  cobrança abre a trilha até os lançamentos que a produziram.

### Negativas

- Leitura de saldo é mais cara. Mitigado por snapshot, que por sua vez introduz
  a necessidade de reconciliação.
- Escrita é mais verbosa: nenhuma movimentação é uma linha de código.
- A tabela de linhas cresce de forma monotônica e nunca encolhe, o que exige
  estratégia de particionamento no longo prazo.
- Exige que quem mexe no sistema entenda o básico de partidas dobradas.
- Um plano de contas mal desenhado é caro de corrigir, o que obriga a escrevê-lo
  antes do código.

## Alternativas consideradas

### Coluna de saldo mutável

Rejeitada pelos três motivos do contexto. É o padrão que o projeto existe para
não repetir.

### Tabela de transações sem partidas dobradas

Uma lista de movimentações com valor e tipo, sem contrapartida obrigatória.
Rejeitada porque resolve auditoria mas não oferece invariante verificável: nada
garante que o dinheiro que saiu de um lugar chegou em outro. Partidas dobradas
transformam a consistência em propriedade estrutural, e não em disciplina.

### Event sourcing completo do domínio

Rejeitada por escopo. O ledger já é event sourcing aplicado onde ele
efetivamente paga o próprio custo, que é o dinheiro. Estender a técnica a
assinaturas e catálogo multiplicaria a complexidade sem benefício proporcional.

## Gatilho de revisão

Reabrir esta decisão se o volume de linhas tornar a reconciliação completa
inviável dentro da janela de execução diária. A resposta esperada não é abandonar
o ledger, mas introduzir fechamento de período, que congela saldos até uma data e
reduz o intervalo que precisa ser somado.
