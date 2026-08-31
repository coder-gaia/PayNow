-- Acentuacao das mensagens de erro do ledger.
--
-- As mensagens nasceram sem acento por uma convencao que nao deveria ter
-- alcancado texto lido por pessoas. A migration anterior ja foi aplicada e o
-- Prisma guarda o checksum dela, entao editar aquele arquivo quebraria o
-- historico. `CREATE OR REPLACE FUNCTION` substitui o corpo sem tocar nos
-- triggers que ja apontam para ela.

CREATE OR REPLACE FUNCTION ledger_assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  desbalanceadas text;
  total_linhas integer;
BEGIN
  SELECT count(*) INTO total_linhas FROM journal_lines WHERE entry_id = NEW.id;

  IF total_linhas < 2 THEN
    RAISE EXCEPTION
      'Lançamento % tem % linha(s). Partida dobrada exige ao menos duas.',
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
      'Lançamento % não soma zero (%). Débitos e créditos precisam se anular.',
      NEW.id, desbalanceadas
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'O ledger é append-only: % em % foi recusado. Corrija por lançamento de estorno.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$;
