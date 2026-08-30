# ADR-0001: monólito modular em vez de microserviços

- **Status:** Aceita
- **Data:** 2026-08-30
- **Fase:** 00
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

O desenho inicial do Paynow previa serviços separados para identidade, cobrança,
pagamentos, assinaturas e webhooks, atrás de um gateway de API.

As restrições reais no momento desta decisão são:

- uma pessoa mantendo o sistema, sem previsão de time;
- orçamento de infraestrutura de aproximadamente 13 USD por mês, vindo de
  crédito educacional;
- o núcleo do sistema é um ledger contábil cujos invariantes precisam ser
  garantidos dentro de uma transação de banco de dados.

A terceira restrição é a decisiva. Separar pagamentos, assinaturas e ledger em
serviços com bancos próprios significa que "atualizar o pagamento e lançar no
ledger" deixa de ser uma transação e passa a ser uma saga, com compensação
manual em caso de falha parcial. O invariante central do projeto, de que todo
lançamento soma zero e o saldo é derivado corretamente, se torna impossível de
garantir e difícil até de verificar.

## Decisão

O Paynow é um monólito modular: um único artefato de deploy, com módulos de
domínio isolados por fronteiras impostas por ferramenta, executável em dois
modos (API e worker) selecionados por variável de ambiente.

As fronteiras não dependem de disciplina. A regra `boundaries/element-types` no
ESLint quebra o build se um módulo de domínio importar outro diretamente.

A hierarquia de importação permitida é:

```
entrypoint  ->  config, platform, qualquer módulo de domínio
platform    ->  platform, config
domínio     ->  platform, config, ele mesmo
domínio     ->  outro domínio: PROIBIDO
```

Módulos de domínio se comunicam por eventos, que passam pelo outbox
transacional. Essa é a mesma costura que uma extração para serviço usaria.

## Consequências

### Positivas

- Invariantes do ledger garantidos dentro de uma transação, sem saga.
- Um pipeline, um deploy, um conjunto de logs, um trace por request.
- Cabe no orçamento disponível.
- A fronteira entre módulos é verificada a cada build, o que a torna mais
  confiável do que a fronteira de rede de um microserviço mal disciplinado.

### Negativas

- Escala vertical: todos os módulos compartilham o mesmo processo e o mesmo
  perfil de recursos.
- Uma falha grave em um módulo derruba o processo inteiro.
- A tentação de burlar a fronteira existe, e é contida apenas pela regra de lint.
- Um deploy publica todos os módulos ao mesmo tempo.

## Alternativas consideradas

### Microserviços por domínio

Rejeitada. Multiplicaria pipelines e custo de infraestrutura além do disponível,
exigiria sagas para consistência distribuída e, principalmente, espalharia o
estado financeiro entre bancos, tornando os invariantes do ledger impossíveis de
garantir transacionalmente. O ganho de microserviços é organizacional, e não há
organização aqui.

### Monólito sem fronteiras impostas

Rejeitada. Sem verificação automática, a fronteira entre módulos dura até a
primeira pressa. O custo de configurar a regra de lint é pequeno e único, e o
benefício é permanente.

### Modular monolith com bancos separados por módulo

Rejeitada. Teria o custo de coordenação dos microserviços sem o benefício de
deploy independente.

## Gatilho de revisão

Reabrir esta decisão quando qualquer uma destas condições se tornar verdadeira:

1. Um módulo passar a ter perfil de carga radicalmente diferente dos demais, a
   ponto de justificar escala independente.
2. Mais de uma pessoa passar a manter o sistema em tempo integral, criando
   contenção real de deploy.
3. Um requisito de isolamento de falha ou de conformidade exigir separação de
   processo.

Nenhuma dessas condições é previsível hoje. Quando alguma ocorrer, a extração é
viável porque a comunicação entre módulos já passa por eventos assíncronos.
