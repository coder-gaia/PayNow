# Por que o Paynow existe

Este documento foi escrito antes da primeira linha de código de domínio, e é
deliberadamente o primeiro arquivo do repositório. Ele existe para responder à
pergunta que qualquer pessoa deveria fazer ao encontrar mais um sistema de
pagamentos: por que construir isso?

## O problema

Cobrança recorrente é um dos poucos domínios em que um bug não é um incômodo de
interface. É dinheiro errado na conta de alguém, com rastro contábil e
consequência legal.

É também um domínio em que quase todo sistema de aprendizado para na superfície.
O padrão que se repete é sempre o mesmo:

- uma tabela de assinaturas com uma coluna `status` preenchida com texto livre;
- uma coluna `balance` atualizada por `UPDATE`;
- um endpoint de webhook que confia que o gateway nunca vai entregar o mesmo
  evento duas vezes.

Isso funciona na demonstração e quebra no primeiro dia de uso real, porque o
mundo real entrega o mesmo evento três vezes, fora de ordem, três dias depois.

## As perguntas que o Paynow se propõe a responder

O projeto foi desenhado em volta dos cenários em que sistemas de cobrança
realmente falham:

1. O gateway entrega o mesmo webhook três vezes, fora de ordem e com atraso.
   O efeito no sistema precisa ser exatamente um.
2. O request de cobrança dá timeout, mas a cobrança foi efetivada do outro lado.
   Repetir cegamente cobraria o cliente duas vezes.
3. Dois requests alteram a mesma assinatura no mesmo milissegundo. Um deles não
   pode sumir em silêncio.
4. O cliente faz upgrade no dia 12 de um ciclo de 30 dias. O rateio precisa
   fechar até o centavo, e a sobra precisa ir para algum lugar explícito.
5. E a pergunta que resume todas as outras: **como você prova que o saldo está
   certo?**

## A resposta que organiza o sistema inteiro

A resposta à última pergunta é a decisão da qual todo o resto decorre:

> O saldo não é armazenado. Ele é derivado de um livro contábil imutável de
> partidas dobradas.

Nenhuma linha do ledger é alterada ou removida depois de escrita. Um erro não é
corrigido com `UPDATE`, é corrigido com um lançamento de estorno, que preserva a
evidência do erro. O saldo de qualquer conta, em qualquer momento do passado, é
uma soma sobre linhas imutáveis.

Isso é mais caro para ler e mais trabalhoso para escrever. Em troca, entrega
algo que a coluna mutável nunca entrega: a capacidade de responder _por que_ o
saldo é esse, e de provar que ele está correto.

Tudo que vem depois no sistema (idempotência, outbox transacional, advisory
locks, retry com backoff, reconciliação) existe para manter essa derivação
sempre correta, sob qualquer ordem de chegada de eventos.

## O que torna este projeto diferente

A tese não é ter mais funcionalidades. É poder afirmar, com prova reproduzível
por qualquer pessoa que clone o repositório, que o motor está correto. Três
mecanismos sustentam essa afirmação:

### 1. Ledger verificável

Toda movimentação vira lançamento balanceado em contas nomeadas. Os invariantes
não são convenção de código, são garantidos por constraint no banco e
verificados por testes de propriedade que geram milhares de sequências
aleatórias de operações.

### 2. Relógio virtual

Nenhuma linha do domínio chama `new Date()`. O tempo é injetado, e cada
organização tem o seu próprio relógio. Isso permite simular doze meses de ciclo
de cobrança em milissegundos nos testes, e arrastar uma linha do tempo na
interface para ver trial, rateio, falha e cobrança de recuperação acontecerem ao
vivo.

Sem isso, demonstrar um sistema de cobrança exigiria esperar trinta dias.

### 3. Suíte adversarial

Um gateway falso programável, capaz de falhar, dar timeout, duplicar webhooks e
entregá-los fora de ordem, combinado com um harness determinístico que embaralha
milhares de cenários por build e afirma duas coisas: o estado final converge
independentemente da ordem, e o ledger nunca desbalanceia em nenhum passo
intermediário.

Roda no CI. Toda falha é reproduzível por uma seed.

## O que o Paynow não é

Não é um adquirente nem um provedor de serviços de pagamento. O sistema **nunca
recebe, transmite ou armazena dado de cartão**. Ele orquestra gateways por trás
de uma porta única, com duas implementações: um gateway falso programável e o
Stripe em modo de teste.

Essa restrição mantém o escopo PCI-DSS em SAQ-A por desenho, e é uma decisão
arquitetural imposta desde o início, registrada na ADR-013.

## Escopo declaradamente fora da primeira versão

Cada item abaixo foi cortado por multiplicar a superfície do projeto sem
aprofundar a tese:

- conversão multi-moeda (o ledger nasce com moeda por linha, mas câmbio fica de
  fora);
- impostos, nota fiscal e obrigações fiscais;
- marketplace, split de pagamento e saldo de subconta;
- ciclo completo de chargeback e disputa;
- cobrança por uso.

O projeto ganha mais provando três coisas difíceis do que tocando em quinze
fáceis.
