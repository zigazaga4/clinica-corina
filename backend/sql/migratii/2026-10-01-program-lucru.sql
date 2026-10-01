/*
  Programul de lucru: zile pare sau impare, pe persoană și pe lună.

  Cerut de clinică (2026-10-01): din Programări se alege luna, persoana și
  dacă lucrează în zilele pare sau impare; calendarul arată apoi zilele în
  care lucrează și pe cele libere.

  Textul de mai jos este copiat din `01_schema.sql`. Se poate rula de câte
  ori vrei. Se rulează cu rolul `clinica`, ca tabela să-i aparțină.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS program_lucru (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilizator_id  uuid NOT NULL REFERENCES utilizator(id) ON DELETE CASCADE,
  luna           date NOT NULL,
  zile           text NOT NULL,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT program_lucru_luna_ck CHECK (extract(day FROM luna) = 1),
  CONSTRAINT program_lucru_zile_ck CHECK (zile IN ('pare', 'impare')),
  CONSTRAINT program_lucru_uk UNIQUE (utilizator_id, luna)
);

DROP TRIGGER IF EXISTS program_lucru_actualizat_la ON program_lucru;
CREATE TRIGGER program_lucru_actualizat_la BEFORE UPDATE ON program_lucru
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();

COMMIT;
