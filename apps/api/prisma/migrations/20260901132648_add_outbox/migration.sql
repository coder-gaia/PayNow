-- Outbox transacional. Ver ADR-0006.
--
-- A mensagem e gravada na mesma transacao que mudou o estado, e entregue
-- depois. E isso que impede as duas falhas classicas de publicar evento a
-- partir de um banco: publicar antes do commit anuncia um fato que pode nao
-- acontecer, e publicar depois do commit perde o anuncio se o processo morrer
-- entre uma coisa e outra.
--
-- O indice unico sobre (organization_id, event_type, event_id) repete o
-- desenho do razao: a chave vem do fato de dominio e nunca de um aleatorio,
-- entao republicar o mesmo fato nao cria uma segunda mensagem.
--
-- Mensagem que esgota as tentativas fica como FAILED e nao some. Apagar o que
-- nao conseguiu ser entregue e apagar a unica evidencia de que alguem la fora
-- nao soube de algo que aconteceu aqui.

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_messages_status_next_attempt_at_idx" ON "outbox_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_organization_id_event_type_event_id_key" ON "outbox_messages"("organization_id", "event_type", "event_id");

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

