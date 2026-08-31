# Plano de contas

Este documento é o contrato contábil do Paynow. Ele foi escrito e revisado
**antes** de qualquer código de pagamento, por um motivo prático: partidas
dobradas mal modeladas são piores do que não ter ledger nenhum, e corrigir o
plano de contas depois obriga a reescrever tudo que foi construído em cima dele.

Referência conceitual: ADR-0003.

## Princípios

1. **Todo lançamento soma zero.** A soma dos débitos é igual à soma dos créditos
   dentro de um mesmo lançamento. Não existe lançamento com uma perna só.
2. **Nenhuma linha é alterada ou removida.** A role da aplicação não tem
   permissão de `UPDATE` nem `DELETE` nas tabelas do ledger. Correção acontece
   por lançamento de estorno.
3. **Saldo é derivado.** Nunca existe uma coluna `balance`. O saldo de uma conta
   é a soma das suas linhas, opcionalmente acelerada por um snapshot periódico
   que é sempre reconferido contra a soma completa.
4. **Toda linha aponta para a causa.** Cada lançamento carrega o identificador do
   evento de domínio que o originou. Um lançamento sem causa rastreável é um bug.
5. **Valores em unidade mínima.** Sempre inteiro em centavos, nunca decimal de
   ponto flutuante. Ver ADR-0002.

## Convenção de sinal

O Paynow usa a convenção de sinal único: cada linha carrega um valor inteiro com
sinal, e a soma das linhas de um lançamento é obrigatoriamente zero.

- Valor **positivo** significa débito na conta.
- Valor **negativo** significa crédito na conta.

Isso substitui duas colunas (`debit` e `credit`) por uma, e transforma o
invariante "débitos igualam créditos" na verificação mais simples possível:
`SUM(amount_minor) = 0`.

Para leitura humana, a interface e os relatórios reapresentam o sinal como duas
colunas. A representação interna permanece única.

## As contas

A primeira versão usa seis contas. A restrição é deliberada: cada conta nova
multiplica os casos de teste do ledger, então nenhuma entra sem um caso de uso
concreto que já exista no sistema.

| Código                | Natureza       | Saldo normal | Representa                                                        |
| --------------------- | -------------- | ------------ | ----------------------------------------------------------------- |
| `customer:receivable` | Ativo          | Devedor      | O que o cliente deve ao merchant por faturas já emitidas          |
| `gateway:clearing`    | Ativo          | Devedor      | Dinheiro capturado pelo gateway e ainda não liquidado ao merchant |
| `merchant:revenue`    | Receita        | Credor       | Receita reconhecida do merchant                                   |
| `platform:fee`        | Receita        | Credor       | Taxa da plataforma sobre a transação                              |
| `customer:credit`     | Passivo        | Credor       | Crédito do cliente vindo de downgrade ou estorno parcial          |
| `merchant:refunds`    | Contra receita | Devedor      | Estornos concedidos, deduzidos da receita                         |

Contas são escopadas por organização. O identificador completo de uma conta é o
par `(organization_id, code)`.

## Lançamentos de referência

Os cenários abaixo são o contrato executável do ledger: cada um vira um teste na
fase 02, com os valores conferidos à mão antes do código existir.

### 1. Emissão de fatura

Fatura de R$ 100,00 emitida. O cliente passa a dever, e a receita ainda não foi
reconhecida porque o dinheiro não entrou.

| Conta                 | Valor (centavos) |
| --------------------- | ---------------- |
| `customer:receivable` | `+10000`         |
| `merchant:revenue`    | `-10000`         |
| **Soma**              | **`0`**          |

### 2. Pagamento confirmado, com taxa de plataforma de 3%

O dinheiro entra no gateway, a dívida do cliente é quitada, e a taxa é separada
da receita do merchant.

| Conta                 | Valor (centavos) |
| --------------------- | ---------------- |
| `gateway:clearing`    | `+10000`         |
| `customer:receivable` | `-10000`         |
| `merchant:revenue`    | `+300`           |
| `platform:fee`        | `-300`           |
| **Soma**              | **`0`**          |

A taxa é lançada como redução da receita do merchant no momento da captura, e
não na emissão, porque antes do pagamento não há taxa a cobrar.

### 3. Estorno parcial de R$ 40,00

| Conta              | Valor (centavos) |
| ------------------ | ---------------- |
| `merchant:refunds` | `+4000`          |
| `gateway:clearing` | `-4000`          |
| **Soma**           | **`0`**          |

O estorno não apaga o lançamento original. Ele é um lançamento novo, e o
histórico preserva os dois.

### 4. Crédito por downgrade

Downgrade no meio do ciclo gera saldo a favor do cliente. Devolver dinheiro é
decisão de política do plano, não consequência automática do cálculo, então o
padrão é registrar crédito.

| Conta              | Valor (centavos) |
| ------------------ | ---------------- |
| `merchant:revenue` | `+10000`         |
| `customer:credit`  | `-10000`         |
| **Soma**           | **`0`**          |

### 5. Uso de crédito em fatura seguinte

Fatura de R$ 300,00 com R$ 100,00 de crédito disponível.

| Conta                 | Valor (centavos) |
| --------------------- | ---------------- |
| `customer:receivable` | `+20000`         |
| `customer:credit`     | `+10000`         |
| `merchant:revenue`    | `-30000`         |
| **Soma**              | **`0`**          |

O crédito é consumido (débito no passivo) e o cliente só passa a dever a
diferença.

## Invariantes e onde são garantidos

| Invariante                            | Garantia                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| Todo lançamento soma zero             | Constraint `deferrable` no banco, validada no commit da transação |
| Nenhuma linha é alterada ou removida  | `REVOKE UPDATE, DELETE` na role da aplicação                      |
| Soma global de todas as linhas é zero | Job de reconciliação diário, com alerta se não executar           |
| Saldo derivado bate com o snapshot    | Snapshot reconferido contra a soma completa a cada execução       |
| Vale sob qualquer ordem de operações  | Testes de propriedade com sequências aleatórias de operações      |

## Como evoluir este documento

O plano de contas muda por ADR, nunca por commit solto. Adicionar uma conta
exige justificar o caso de uso, definir os lançamentos de referência que a
envolvem, e escrever os testes correspondentes antes da implementação.
