-- Idempotencia de requisicao. Ver ADR-0007.
--
-- O indice unico em (scope, key) nao e otimizacao: e o mecanismo. Duas
-- requisicoes com a mesma chave chegando no mesmo milissegundo sao resolvidas
-- pelo banco, e nao por leitura seguida de escrita na aplicacao, que perderia
-- a corrida em silencio.
--
-- request_hash existe para pegar o erro mais comum de quem usa idempotencia
-- errado: reaproveitar a mesma chave para um pedido diferente. Sem ele, a
-- segunda chamada receberia calada a resposta da primeira, e o cliente
-- concluiria que cobrou o valor novo quando cobrou o antigo.
--
-- expires_at guarda o descarte. Resposta guardada para sempre e um vazamento
-- lento, e vinte e quatro horas cobrem qualquer retry de rede honesto.

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

