-- Faturas e pagamentos.
--
-- A fatura existe para que pagamento tenha objeto. Antes dela o razao
-- registrava um valor a receber que nao pertencia a nada: dava para ver que o
-- cliente devia, mas nao o que devia, desde quando, nem quantas vezes a
-- cobranca ja tinha sido tentada.
--
-- Cada tentativa de cobranca e uma linha em payments, e nenhuma e sobrescrita.
-- O historico de tentativas e o que responde "por que este cliente foi
-- cortado", e atualizar a tentativa anterior apagaria exatamente a resposta.
--
-- O indice unico em (invoice_id, attempt) e a rede embaixo da numeracao de
-- tentativas, e o de (organization_id, number) e a rede embaixo da numeracao
-- de faturas, que e serializada por advisory lock no InvoicesService. Se algum
-- caminho futuro esquecer o lock, o banco recusa em vez de duplicar calado.
--
-- customers.payment_method_token guarda uma referencia opaca do provedor, e
-- nunca numero de cartao. Ver ADR-0014: e isto que mantem o escopo PCI em
-- SAQ-A.

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "payment_method_brand" TEXT,
ADD COLUMN     "payment_method_last4" VARCHAR(4),
ADD COLUMN     "payment_method_token" TEXT;

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "subscription_id" UUID,
    "number" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "gateway" TEXT NOT NULL,
    "gateway_ref" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "retriable" BOOLEAN,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_organization_id_status_idx" ON "invoices"("organization_id", "status");

-- CreateIndex
CREATE INDEX "invoices_next_attempt_at_idx" ON "invoices"("next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_number_key" ON "invoices"("organization_id", "number");

-- CreateIndex
CREATE INDEX "payments_organization_id_status_idx" ON "payments"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoice_id_attempt_key" ON "payments"("invoice_id", "attempt");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

