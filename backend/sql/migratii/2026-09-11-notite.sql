/*
  Notițele din calendar — adăugarea tabelei pe o bază care merge deja.

  „Irina e în concediu”, „vine furnizorul la 15:00”: însemnări care ocupă un
  loc în calendar fără să fie programări. Nu au client, serviciu sau preț,
  deci nu încap în `programare`, unde toate acelea sunt obligatorii.

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Textul de mai
  jos este copiat cuvânt cu cuvânt de acolo. Dacă unul se schimbă, celălalt
  trebuie schimbat la fel — altfel o bază nouă și una veche ajung să aibă
  forme diferite.

  Se poate rula de câte ori vrei: nu atinge nimic din ce există.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS notita (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titlu          text NOT NULL CHECK (btrim(titlu) <> ''),
  detalii        text,
  executant_id   uuid REFERENCES utilizator(id) ON DELETE RESTRICT,
  incepe_la      timestamptz NOT NULL,
  se_termina_la  timestamptz NOT NULL,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notita_interval_ck CHECK (se_termina_la > incepe_la)
);

CREATE INDEX IF NOT EXISTS notita_calendar_idx
  ON notita (incepe_la, executant_id);

DROP TRIGGER IF EXISTS notita_actualizat_la ON notita;
CREATE TRIGGER notita_actualizat_la BEFORE UPDATE ON notita
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();

CREATE OR REPLACE VIEW v_notita_detaliu AS
SELECT
  n.*,
  e.nume AS executant_nume,
  u.nume AS creat_de_nume
FROM notita n
LEFT JOIN utilizator e ON e.id = n.executant_id
LEFT JOIN utilizator u ON u.id = n.creat_de;

COMMIT;
