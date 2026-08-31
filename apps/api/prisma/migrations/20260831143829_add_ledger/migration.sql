-- CreateEnum
CREATE TYPE "account_kind" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'CONTRA_REVENUE');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "account_kind" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_organization_id_idx" ON "accounts"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_code_currency_key" ON "accounts"("organization_id", "code", "currency");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_occurred_at_idx" ON "journal_entries"("organization_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_event_type_event_id_key" ON "journal_entries"("organization_id", "event_type", "event_id");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariantes do ledger
--
-- As tres regras abaixo nao vivem no schema do Prisma porque ele nao as
-- expressa, e nao vivem apenas na camada de aplicacao porque uma regra
-- contabil que so vale no caminho feliz do codigo nao e uma garantia. Elas
-- valem para qualquer conexao, inclusive um psql aberto por engano.
-- ---------------------------------------------------------------------------

-- 1. Linha com valor zero nao movimenta nada e so polui o razao.
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_amount_not_zero" CHECK ("amount_minor" <> 0);

-- 2. Todo lancamento soma zero, por moeda.
--
-- A verificacao e adiada para o commit porque as linhas sao inseridas uma a
-- uma: no meio da transacao o lancamento esta legitimamente desbalanceado.
-- Agrupar por moeda em vez de somar tudo mantem a regra correta quando um
-- lancamento envolver mais de uma moeda, o que ainda nao acontece mas nao
-- custa nada suportar agora.
CREATE OR REPLACE FUNCTION ledger_assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  desbalanceadas text;
  total_linhas integer;
BEGIN
  SELECT count(*) INTO total_linhas FROM journal_lines WHERE entry_id = NEW.id;

  IF total_linhas < 2 THEN
    RAISE EXCEPTION
      'Lancamento % tem % linha(s). Partida dobrada exige ao menos duas.',
      NEW.id, total_linhas
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(format('%s: %s', currency, soma), ', ')
    INTO desbalanceadas
    FROM (
      SELECT currency, sum(amount_minor) AS soma
        FROM journal_lines
       WHERE entry_id = NEW.id
       GROUP BY currency
      HAVING sum(amount_minor) <> 0
    ) AS divergencias;

  IF desbalanceadas IS NOT NULL THEN
    RAISE EXCEPTION
      'Lancamento % nao soma zero (%). Debitos e creditos precisam se anular.',
      NEW.id, desbalanceadas
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_entry_balanced();

-- 3. O ledger e append-only.
--
-- Um trigger, e nao REVOKE, porque REVOKE nao alcanca o dono do banco e a
-- aplicacao conecta como dono em desenvolvimento. Separar a role da aplicacao
-- e endurecimento de producao, previsto para a fase 09, e soma a esta regra em
-- vez de substitui-la.
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'O ledger e append-only: % em % foi recusado. Corrija por lancamento de estorno.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$;

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();

CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
