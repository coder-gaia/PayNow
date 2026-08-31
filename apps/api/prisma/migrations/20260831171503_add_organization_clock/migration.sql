-- Relogio virtual por organizacao. Ver ADR-0015.
--
-- Uma linha aqui significa que aquela organizacao esta com o tempo congelado.
-- A ausencia de linha e o caso comum e significa relogio de parede, o que
-- torna o estado padrao o mais barato de representar: nada.
--
-- O instante congelado e guardado inteiro, e nao como deslocamento em relacao
-- ao relogio real. Deslocamento continua andando sozinho, e o objetivo aqui e
-- exatamente o contrario: o tempo so anda quando alguem manda andar, para que
-- a mesma sequencia de comandos produza a mesma historia toda vez.
--
-- started_at guarda quando o congelamento comecou, e serve so para a interface
-- poder dizer quanto tempo virtual ja foi percorrido.

-- CreateTable
CREATE TABLE "organization_clocks" (
    "organization_id" UUID NOT NULL,
    "frozen_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_clocks_pkey" PRIMARY KEY ("organization_id")
);

-- AddForeignKey
ALTER TABLE "organization_clocks" ADD CONSTRAINT "organization_clocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

