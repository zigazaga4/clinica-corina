/*
  Acordurile GDPR — adăugarea tabelei pe o bază care merge deja.

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Fișierul acesta
  există fiindcă baza de pe server are date reale: schema întreagă s-ar fi
  putut rula (totul e `IF NOT EXISTS`), dar ar fi însemnat șase sute de linii
  trecute peste o bază de producție ca să adauge una singură. Aici se vede, în
  treizeci de rânduri, exact ce se schimbă.

  Se poate rula de câte ori vrei: nu atinge nimic din ce există.

  Textul de mai jos este copiat cuvânt cu cuvânt din `01_schema.sql`. Dacă unul
  se schimbă, celălalt trebuie schimbat la fel — altfel o bază nouă și una
  veche ajung să aibă forme diferite.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS consimtamant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  programare_id  uuid REFERENCES programare(id) ON DELETE SET NULL,
  versiune       text NOT NULL CHECK (btrim(versiune) <> ''),
  document       bytea NOT NULL,
  marime         integer NOT NULL CHECK (marime > 0),
  amprenta       text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{64}$'),
  date_semnatar  jsonb NOT NULL,
  dispozitiv     text,
  semnat_la      timestamptz NOT NULL DEFAULT now(),
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS consimtamant_client_idx
  ON consimtamant (client_id, semnat_la DESC);

CREATE INDEX IF NOT EXISTS consimtamant_programare_idx
  ON consimtamant (programare_id) WHERE programare_id IS NOT NULL;

CREATE OR REPLACE VIEW v_consimtamant_detaliu AS
SELECT
  c.id,
  c.client_id,
  c.programare_id,
  c.versiune,
  c.marime,
  c.amprenta,
  c.date_semnatar,
  c.dispozitiv,
  c.semnat_la,
  c.creat_de,
  cl.nume AS client_nume,
  u.nume  AS creat_de_nume
FROM consimtamant c
JOIN client cl ON cl.id = c.client_id
LEFT JOIN utilizator u ON u.id = c.creat_de;

COMMIT;
