# ADR-0002: dinheiro como inteiro em unidade mínima

- **Status:** Aceita
- **Data:** 2026-08-30
- **Fase:** 00
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

O Paynow calcula rateio proporcional, taxa percentual, estorno parcial e divisão
de valores entre contas. Todas essas operações produzem sobras de arredondamento,
e sobras que somem viram diferença contábil.

JavaScript agrava o problema. O tipo `number` é ponto flutuante de 64 bits, e o
exemplo canônico já basta para descartá-lo:

```js
0.1 + 0.2; // 0.30000000000000004
```

Bibliotecas de decimal arbitrário resolvem a precisão, mas não resolvem o
problema mais perigoso: nada impede somar um valor em reais com um valor em
dólares, porque para o tipo os dois são apenas números.

## Decisão

Todo valor monetário no Paynow é um **inteiro na unidade mínima da moeda**,
armazenado como `int8` no PostgreSQL e manipulado como `bigint` no TypeScript,
sempre encapsulado no value object `Money` do pacote `@paynow/money`.

O `Money` carrega a moeda junto com o valor e **recusa qualquer operação entre
moedas diferentes**, lançando `CurrencyMismatchError`. Não existe conversão
implícita.

A quantidade de casas decimais vem da tabela ISO 4217 e não é assumida como 2:
BRL e USD têm expoente 2, JPY tem expoente 0.

O modo de arredondamento padrão é **half-even** (arredondamento bancário), que
não enviesa somas grandes na mesma direção como o half-up faz. O modo é
explícito na assinatura das operações que arredondam.

Para divisão de um valor entre partes, o `Money` expõe `allocate`, que distribui
o resto de forma determinística garantindo que a soma das partes seja
exatamente igual ao valor original. Isso elimina arredondamento em rateio, em vez
de apenas escolher um modo para ele.

## Consequências

### Positivas

- Impossível perder centavo por representação.
- Impossível somar moedas diferentes sem erro em tempo de execução.
- A regra de arredondamento existe em um lugar só, e é testável isoladamente.
- `allocate` garante conservação do total por construção, e não por convenção.

### Negativas

- `bigint` não é serializável em JSON nativamente, o que exige um interceptor de
  serialização na borda da API.
- Prisma mapeia `BigInt` de forma que exige atenção nas consultas cruas.
- Toda entrada externa precisa ser convertida na borda, e nunca depois.
- Desenvolvedores acostumados a `number` precisam de disciplina no começo.

## Alternativas consideradas

### `number` com duas casas decimais

Rejeitada. Perde precisão de forma silenciosa e cumulativa, que é o pior tipo de
perda: não quebra o teste, quebra o fechamento contábil três meses depois.

### `decimal.js` ou `big.js`

Rejeitada como representação primária. Resolve precisão, mas não impede mistura
de moedas e introduz uma dependência no caminho mais quente do sistema. O tipo
inteiro é mais simples, mais rápido e mais fácil de armazenar.

### `numeric(20, 8)` no PostgreSQL

Rejeitada. Convida a armazenar frações de centavo que nunca poderão ser cobradas,
adiando a decisão de arredondamento para o momento errado, que é o da leitura.

## Gatilho de revisão

Reabrir esta decisão se o sistema passar a precisar de moedas com mais de quatro
casas decimais, ou de valores fracionários de unidade mínima, como acontece em
cobrança por uso com preço unitário muito baixo.
