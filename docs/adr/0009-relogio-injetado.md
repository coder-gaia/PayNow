# ADR-0009: relógio injetado em vez de acesso direto ao tempo

- **Status:** Aceita
- **Data:** 2026-08-31
- **Fase:** 01
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

Um motor de cobrança recorrente é, no fundo, uma máquina que reage à passagem do
tempo. Trial que termina, ciclo que fecha, fatura que vence, tentativa de
cobrança que reagenda para daqui a dois dias.

Se o tempo vier de `new Date()` espalhado pelo código, três coisas ficam
impossíveis:

1. **Testar o ciclo de cobrança.** Verificar que doze meses de assinatura geram
   doze faturas com as datas certas exigiria esperar um ano, ou encher o código
   de parâmetros de data opcionais que só existem para o teste.
2. **Demonstrar o sistema.** Um visitante da demonstração pública não vai
   esperar trinta dias para ver uma cobrança acontecer.
3. **Rodar a suíte adversarial.** Reproduzir uma falha exige que a mesma seed
   produza a mesma sequência de eventos, e tempo real não é reprodutível.

O terceiro pilar do projeto depende diretamente do segundo, e o segundo depende
deste.

## Decisão

Nenhuma linha de módulo de domínio lê o relógio do sistema. O tempo vem de uma
porta `Clock` injetada, cuja única implementação autorizada vive no módulo
`platform`.

A regra é aplicada por lint, e não por convenção: `no-restricted-globals` e
`no-restricted-syntax` marcam `new Date()`, `Date.now()` e o uso do global
`Date` como erro em `apps/api/src/modules/*`, com o módulo `platform` excluído.
Que a regra realmente dispara é verificado por `pnpm verify:architecture`, que
roda no CI.

A assinatura é `now(): Date`, sem receber organização. Na fase 04 o relógio
virtual é resolvido por organização no escopo do request: muda a instância
injetada, não a assinatura. Isso evita reescrever todo ponto de chamada quando
o test clock entrar.

O módulo `platform` fica fora da regra por dois motivos legítimos: ele abriga a
implementação do relógio, e alguns usos ali são hora de parede de verdade e não
tempo de domínio, como o carimbo de observação do probe de prontidão.

## Consequências

### Positivas

- Um ano de assinatura simulado em milissegundos nos testes.
- A linha do tempo arrastável do painel passa a ser possível, e ela é a
  demonstração que torna o projeto compreensível em dois minutos.
- A suíte adversarial ganha determinismo, que é requisito e não detalhe.
- Datas de domínio deixam de depender do fuso e do relógio da máquina que roda
  o processo.

### Negativas

- Toda classe que precisa de tempo ganha uma dependência a mais no construtor.
- É uma regra que exige disciplina permanente: uma única chamada direta
  esquecida em um caminho quente reintroduz o acoplamento com o tempo real.
  Por isso ela é lint, e não recomendação.
- Timestamps de auditoria gerados pelo banco (`DEFAULT now()`) continuam vindo
  do relógio do servidor. Isso é deliberado: eles registram quando a linha foi
  escrita, que é um fato de infraestrutura, e não quando o evento de negócio
  aconteceu.

## Alternativas consideradas

### Passar a data como parâmetro opcional nos métodos

Rejeitada. Polui a assinatura de todo método de domínio com um parâmetro que só
existe para o teste, e nada impede que alguém esqueça de passá-lo e caia no
padrão que lê o relógio real.

### Congelar o tempo nos testes com utilitário do runner

Ferramentas como `jest.useFakeTimers` resolvem o teste unitário, mas não
resolvem a demonstração nem a suíte adversarial, que rodam em processo real.
Além disso, congelar o tempo globalmente afeta bibliotecas que dependem dele,
como o cliente do banco e o do Redis, e produz travamentos difíceis de
diagnosticar.

### Confiar apenas em revisão de código

Rejeitada pelo mesmo motivo da ADR-0001: uma fronteira que depende de disciplina
dura até a primeira pressa.

## Gatilho de revisão

Reabrir se aparecer um caso legítimo de tempo de domínio dentro de um módulo que
não possa receber o relógio por injeção. Até hoje não existe nenhum, e a
resposta esperada seria mover o cálculo para onde a injeção é possível, e não
afrouxar a regra.
