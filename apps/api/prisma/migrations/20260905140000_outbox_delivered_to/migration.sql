-- AlterTable
--
-- NOT NULL com default, e nao apenas TEXT[]: o relay le esta coluna por
-- $queryRaw, que devolve o NULL cru em vez do vazio que o Prisma assumiria.
-- As linhas que ja estao na fila precisam nascer com a lista vazia, e nao com
-- nulo, senao a primeira varredura depois do deploy quebra em cima delas.
ALTER TABLE "outbox_messages"
  ADD COLUMN "delivered_to" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
