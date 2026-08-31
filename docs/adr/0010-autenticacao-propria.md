# ADR-0010: autenticação própria em vez de provedor externo

- **Status:** Aceita
- **Data:** 2026-08-31
- **Fase:** 01
- **Substitui:** nenhuma
- **Substituída por:** nenhuma

## Contexto

O GitHub Student Pack dá acesso gratuito ao plano Pro do Clerk, que entrega
cadastro, login, rotação de sessão, MFA, recuperação de senha e organizações
com papéis. Adotá-lo removeria toda a fase 01 do cronograma.

O contra-argumento é que a fase 01 não existe para ter login. Ela existe porque
rotação de refresh token com detecção de reuso, hierarquia de papéis
multi-tenant e autenticação por chave de API são exatamente o tipo de problema
que o projeto se propõe a demonstrar entendendo, e não consumindo.

A decisão é contraintuitiva do ponto de vista de custo e prazo, e por isso
merece registro.

## Decisão

O Paynow implementa a própria autenticação.

Escolhas concretas:

- **Argon2id para senha**, com os parâmetros de primeira escolha do OWASP.
  Senha é segredo de entropia baixa e precisa de hash caro.
- **SHA-256 para chave de API e refresh token**, com comparação em tempo
  constante. São segredos aleatórios de 256 bits, então força bruta já é
  inviável por construção e um hash lento só somaria latência a cada request.
- **Refresh token com rotação e famílias.** Cada login abre uma família, cada
  uso consome o token e emite outro. Apresentar um token já consumido revoga a
  família inteira.
- **Papéis estritamente ordenados** (OWNER, ADMIN, MEMBER, READONLY), com
  autorização por comparação de nível. Com quatro papéis totalmente ordenados,
  uma matriz de permissões por recurso seria cerimônia sem ganho.
- **Autenticação obrigatória por padrão.** O guard é global e a exceção precisa
  ser declarada com `@Public()`. Esquecer de proteger uma rota é um erro
  silencioso; esquecer de liberar uma é um 401 no primeiro teste.
- **Sem senha em log, sem senha em resposta, sem distinção entre email
  inexistente e senha errada**, inclusive no tempo de resposta.

## Consequências

### Positivas

- O projeto demonstra o entendimento de um domínio de segurança que costuma ser
  terceirizado, com testes que provam o comportamento e não apenas o afirmam.
- Não há dependência de disponibilidade nem de política de preço de terceiro no
  caminho crítico de login.
- Os dados de identidade ficam no mesmo banco do resto, o que permite criar
  conta e organização na mesma transação.
- A demonstração pública roda sem cadastro em serviço externo.

### Negativas

- Superfície de segurança que passa a ser responsabilidade do projeto.
- Funcionalidades que o Clerk traria de graça ficam de fora ou custam trabalho:
  MFA, login social, recuperação de senha por email, detecção de dispositivo.
- Toda correção de vulnerabilidade em prática de autenticação vira trabalho
  próprio.
- Já custou um bug real: a ordem das verificações em `rotate` deixava a
  detecção de reuso inerte, porque a rotação marca o token como consumido e
  revogado ao mesmo tempo e a checagem de `revokedAt` vinha primeiro. Foi pego
  em teste manual antes do commit, e virou caso de teste.

## Alternativas consideradas

### Clerk, gratuito pelo Student Pack

Rejeitada pelo motivo central: entregaria pronto justamente o que o projeto
quer demonstrar. Continua sendo a escolha certa para um produto real com prazo,
e é assim que deve ser lida esta decisão.

### Auth.js, Lucia ou biblioteca equivalente

Rejeitada por ficar no pior meio-termo: ainda exigiria entender o modelo de
sessão para configurar corretamente, sem que o entendimento aparecesse no
código do repositório.

### Passport com estratégia JWT

Rejeitada por peso desproporcional. O `passport-jwt` resolve extração e
validação de token, que é a parte fácil, e não ajuda em nada na rotação com
detecção de reuso, que é a parte difícil. O guard próprio tem menos de cem
linhas e trata os dois tipos de credencial do sistema.

## Gatilho de revisão

Migrar para provedor externo se o projeto passar a ter usuários reais e o custo
de manter conformidade (MFA, recuperação de conta, auditoria de acesso) superar
o valor demonstrativo de manter a implementação própria.
