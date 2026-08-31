-- Fundacao do banco: extensoes que o restante do schema assume existirem.
--
-- pgcrypto  gen_random_uuid(), usado como identificador padrao a partir da
--           fase 01. Escolhido em vez de uuid-ossp por ja vir com o PostgreSQL
--           e nao exigir pacote adicional na imagem.
-- citext    comparacao de texto sem diferenciar maiusculas, usada em email de
--           usuario para que a unicidade valha independentemente de digitacao.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
