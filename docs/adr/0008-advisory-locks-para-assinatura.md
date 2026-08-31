# ADR-0008: advisory locks para mutação de assinatura

- **Status:** Aceita
- **Data:** 2026-08-31
- **Fase:** 03
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Trocar o plano de uma assinatura não é uma escrita. É um ciclo de três passos:

1. ler o estado atual (plano vigente, início e fim do ciclo);
2. calcular o rateio **a partir do que foi lido**;
3. gravar o plano novo e o lançamento contábil correspondente.

Dois requests simultâneos no mesmo ciclo produzem um erro que não aparece em
lugar nenhum: ambos leem o plano antigo, ambos calculam o rateio sobre ele, e o
segundo grava por cima do primeiro. O resultado é uma assinatura no plano
certo e um razão com o crédito errado, sem nenhum erro registrado.

Lock de linha (`SELECT ... FOR UPDATE`) não resolve, porque só cobre a escrita.
Entre a leitura e o `UPDATE` existe o cálculo, e é exatamente aí que a corrida
acontece.

## Decisão

Toda mutação de assinatura roda sob **advisory lock transacional** do
PostgreSQL, tomado antes da leitura:

```sql
SELECT pg_advisory_xact_lock(<namespace>, hashtext(<subscriptionId>))
```

Três propriedades importam:

- **Transacional.** `pg_advisory_xact_lock` é liberado no fim da transação, com
  commit ou rollback, sem `unlock` explícito. Um lock que precisa ser devolvido
  à mão vaza no primeiro caminho de erro que alguém esquecer de tratar.
- **Por assinatura.** A chave é derivada do identificador, então duas
  assinaturas diferentes não se bloqueiam. O namespace constante evita colisão
  com locks de outra parte do sistema.
- **Cobre o ciclo inteiro.** Tomado antes da leitura, serializa leitura,
  cálculo e escrita.

Além do lock, as rotas de mutação aceitam **`expectedVersion`**. O lock protege
contra corrida dentro do servidor; a versão protege contra decisão tomada sobre
dado velho: quem leu a assinatura na tela, saiu para o café e voltou para
confirmar recebe 400 em vez de sobrescrever o que mudou nesse meio tempo.

## Consequências

### Positivas

- O rateio é sempre calculado sobre o estado que será efetivamente gravado.
- Nenhuma limpeza de lock: o banco devolve no fim da transação, aconteça o que
  acontecer.
- Concorrência entre clientes vira erro visível, e não sobrescrita silenciosa.
- O lock é barato: não cria linha, não escreve em disco, e some com a transação.

### Negativas

- `hashtext` produz um inteiro de 32 bits, então há chance remota de duas
  assinaturas compartilharem chave. O efeito de uma colisão é serialização
  desnecessária entre duas assinaturas, e não corrupção. É um custo aceitável.
- O lock é do PostgreSQL, então a solução não sobrevive a uma troca de banco.
  Dado que o ledger já depende de constraint diferida e de trigger, essa ponte
  já foi queimada de propósito na ADR-0005.
- Transação longa segurando lock aumenta contenção. Mitigado por manter a
  transação curta: nenhuma chamada de rede acontece dentro dela.

## Alternativas consideradas

### `SELECT ... FOR UPDATE` na linha da assinatura

Rejeitada por não cobrir o problema. Bloqueia a linha, mas a corrida está entre
a leitura e a escrita, e o `FOR UPDATE` só entra em cena na segunda.

Vale registrar que `FOR UPDATE` **na leitura** resolveria, e é a solução
clássica. Foi preterido porque o advisory lock deixa a intenção explícita no
código (a linha diz "serializando esta assinatura") e porque a mesma chave
serve para operações que não tocam a linha de assinatura, como o ciclo de
cobrança da fase 04.

### Serializar por chave em uma fila

Publicar a mutação em uma fila com chave de agrupamento, e processar uma por
vez. Rejeitada porque tornaria toda mutação assíncrona: quem troca de plano
deixaria de receber o rateio calculado na resposta e passaria a ter que
consultar depois. Piora a API para resolver um problema que o banco já resolve
de forma síncrona.

### Nível de isolamento serializável

`SERIALIZABLE` detectaria o conflito e abortaria uma das transações. Rejeitada
porque transfere o custo para o cliente na forma de erro de serialização, que
precisa de retry, e porque afeta toda transação do sistema para resolver um
caso específico.

### Apenas concorrência otimista, sem lock

Rejeitada como solução única. `expectedVersion` protege contra dado velho vindo
da tela, mas dois requests simultâneos que leram a mesma versão passariam os
dois. Otimista e lock resolvem problemas diferentes, e o sistema usa os dois.

## Gatilho de revisão

Reabrir se a contenção em uma única assinatura passar a ser mensurável, o que
significaria muitas mutações concorrentes no mesmo registro. O caminho seria
mover para o modelo de fila por chave, aceitando o custo de tornar a operação
assíncrona.
