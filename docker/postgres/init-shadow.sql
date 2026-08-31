-- Banco sombra usado pelo Prisma Migrate.
--
-- O Prisma precisa de um banco descartavel para replicar o historico de
-- migrations e calcular a diferenca ate o schema atual. Ele cria um sozinho
-- quando o usuario tem permissao, mas deixar o banco pronto torna o comando
-- `pnpm db:diff` previsivel e utilizavel em ambiente sem terminal interativo.
CREATE DATABASE paynow_shadow;
