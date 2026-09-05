# Imagem da API.
#
# Multi-estagio por dois motivos. O primeiro e tamanho: as dependencias de build
# (TypeScript, Prisma CLI, os tipos) nao precisam existir em producao. O segundo
# e superficie: quanto menos coisa executavel na imagem final, menos coisa para
# alguem usar se entrar nela.
#
# O worker e a API sao a mesma imagem, e a diferenca e a variavel
# WORKER_ENABLED. Ver ADR-0012 para o motivo de nao serem dois artefatos.

# ---------------------------------------------------------------------------
# Estagio 1: dependencias
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

RUN corepack enable

WORKDIR /app

# Só os manifestos primeiro. Assim a camada de instalacao so e refeita quando
# uma dependencia muda, e nao a cada linha de codigo alterada.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/money/package.json packages/money/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Estagio 2: build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/money/node_modules ./packages/money/node_modules

COPY . .

# O cliente do Prisma e gerado a partir do schema, e precisa existir antes do
# tsc: o codigo importa tipos que so existem depois desta linha.
RUN pnpm --filter @paynow/api exec prisma generate

RUN pnpm --filter @paynow/money build
RUN pnpm --filter @paynow/api build

# `pnpm deploy` monta uma pasta autocontida, com o node_modules achatado.
#
# Sem isto o estagio de producao nao funciona: o pnpm usa um store virtual e
# `node_modules/@prisma/client` e um link simbolico para dentro de `.pnpm`, que
# o `COPY` do Docker nao resolve. Copiar `node_modules` inteiro tambem
# funcionaria, e traria junto tudo que so serve para build.
RUN pnpm --filter @paynow/api deploy --prod --legacy /prod/api

# O cliente do Prisma e gerado dentro do node_modules achatado, e nao antes: o
# `deploy` monta a arvore do zero e nao leva o que foi gerado na de build.
WORKDIR /prod/api
RUN npx --yes prisma@6.19.3 generate --schema prisma/schema.prisma

# ---------------------------------------------------------------------------
# Estagio 3: producao
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build --chown=node:node /prod/api ./

# Usuario sem privilegio. A imagem do Node ja traz o `node`, entao nao ha
# usuario novo para criar.
USER node

EXPOSE 3333

# Sem shell: `CMD` em forma de lista faz o processo ser PID 1 de verdade, e
# receber SIGTERM. Com shell, o sinal para no shell e o encerramento gracioso
# do Nest nunca roda.
CMD ["node", "dist/main.js"]
