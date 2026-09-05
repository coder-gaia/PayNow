# Como colocar no ar

Este documento é operacional. O raciocínio das decisões de endurecimento está na
[ADR-0019](adr/0019-endurecimento-e-deploy.md).

## O que precisa existir

| Peça       | Por quê                                                               |
| ---------- | --------------------------------------------------------------------- |
| PostgreSQL | Fonte da verdade. Os invariantes do razão são triggers, não código.   |
| Redis      | Fila e cache. O health check falha sem ele, e é proposital.           |
| API        | A imagem do `Dockerfile`. Serve HTTP e, opcionalmente, roda o worker. |
| Painel     | Next.js, com a API como única fonte de dados.                         |

O worker **não é um artefato separado**. É a mesma imagem com
`WORKER_ENABLED=true`. Ver [ADR-0012](adr/0012-worker-no-mesmo-processo.md).

## Variáveis obrigatórias

```bash
DATABASE_URL=postgresql://usuario:senha@host:5432/paynow?schema=public
REDIS_URL=redis://host:6379
JWT_SECRET=<32 caracteres ou mais, aleatórios de verdade>
NODE_ENV=production
```

E as que só importam em produção:

```bash
# De onde o painel chama a API. Lista separada por vírgula.
# Vazia significa mesma origem. Nunca use `*`: com cookie de sessão, ele libera
# qualquer site a agir em nome de quem estiver logado.
CORS_ORIGINS=https://paynow.exemplo.com

# Requisições por minuto, por IP. O padrão é 120.
RATE_LIMIT_PER_MINUTE=120

# Um processo serve HTTP e roda o worker. Com mais de uma réplica, ligue em uma
# só: o ciclo de cobrança pega advisory lock, mas duas réplicas varrendo a fila
# é trabalho jogado fora.
WORKER_ENABLED=true

# O segredo com que o provedor assina o que manda. Com o gateway falso, é o
# mesmo dos dois lados.
INBOUND_WEBHOOK_SECRET=<aleatório>
```

## Subir

```bash
docker build -t paynow-api .
```

A imagem tem cerca de 470 MB e roda como usuário sem privilégio.

**Aplicar migrations é um passo separado, e tem de ser.** Um servidor que altera
o schema ao subir aplica a mesma migration N vezes quando há N réplicas, e as
que perderem a corrida sobem contra um schema pela metade:

```bash
docker run --rm -e DATABASE_URL=... paynow-api \
  npx prisma migrate deploy --schema prisma/schema.prisma
```

Depois:

```bash
docker run -d -p 3333:3333 --env-file .env.producao paynow-api
```

## Verificar que subiu

```bash
curl https://api.exemplo.com/health/ready
```

`ready` confere PostgreSQL e Redis e devolve a latência de cada um. É o endereço
certo para o balanceador: `live` só diz que o processo está vivo, o que continua
verdade enquanto ele não consegue falar com o banco.

## Onde hospedar

Qualquer lugar que rode um container e ofereça PostgreSQL e Redis. Railway,
Render, Fly.io e Koyeb servem, e todos têm plano gratuito suficiente para uma
demonstração.

O que **não** funciona é hospedagem serverless por função, e o motivo é o
worker: ele é um cron dentro do processo, e função que morre entre requisições
não tem processo para segurar cron. Nesse caso o worker vira um agendador
externo chamando as rotas.

## Depois do primeiro deploy

```bash
docker run --rm --env-file .env.producao paynow-api node dist/seed.js
```

O seed recusa rodar com `NODE_ENV=production` de propósito. Para popular a
demonstração em produção, rode-o com `NODE_ENV=development` **apontando para o
banco de demonstração**, nunca para um banco com dado de alguém.

## O que este deploy não tem

Dito aqui porque descobrir na hora errada é pior:

- **Sem observabilidade.** Não há tracing nem métrica exportada. A ADR-0013
  estava prevista para OpenTelemetry e não foi escrita.
- **Sem backup automatizado.** O provedor de banco cuida disso, e conferir que
  cuida é responsabilidade de quem opera.
- **Sem HTTPS próprio.** A aplicação serve HTTP e espera um proxy na frente.
  Toda plataforma citada acima faz isso.
- **Limite de taxa em memória.** Com mais de um processo, cada um conta o seu.
  Ver ADR-0019.
- **A organização de demonstração é pública e escrita por quem entrar.** O
  console de caos programa o provedor falso para o processo inteiro. É
  aceitável numa demonstração e não seria em outro lugar.
