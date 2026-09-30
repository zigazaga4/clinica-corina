/*
  Statisticile — cheltuielile și parola separată a ecranului.

  Două tabele NOI și o vedere nouă; nimic din ce există nu se atinge. Nicio
  coloană adăugată, niciun rând scris: o bază cu date reale rămâne exact cum
  era, iar codul vechi al serverului nu observă nimic (nu citește tabelele
  acestea). De aceea migrația se poate rula ÎNAINTEA noului server.

  `parola_statistici` rămâne goală — parola o alege primul administrator care
  deschide ecranul „Statistici”.

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Textul de mai
  jos este copiat cuvânt cu cuvânt de acolo. Dacă unul se schimbă, celălalt
  trebuie schimbat la fel — altfel o bază nouă și una veche ajung să aibă
  forme diferite.

  Se poate rula de câte ori vrei: nu atinge nimic din ce există.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS cheltuiala (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data           date NOT NULL,
  categorie      text NOT NULL,
  descriere      text,
  suma           numeric(10,2) NOT NULL,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cheltuiala_categorie_ck CHECK (btrim(categorie) <> ''),
  CONSTRAINT cheltuiala_suma_ck CHECK (suma > 0)
);

CREATE INDEX IF NOT EXISTS cheltuiala_data_idx ON cheltuiala (data DESC);

DROP TRIGGER IF EXISTS cheltuiala_actualizat_la ON cheltuiala;
CREATE TRIGGER cheltuiala_actualizat_la BEFORE UPDATE ON cheltuiala
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();

CREATE TABLE IF NOT EXISTS parola_statistici (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  parola_hash    text NOT NULL,
  actualizat_de  uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  actualizat_la  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW v_cheltuiala_detaliu AS
SELECT
  ch.*,
  u.nume AS creat_de_nume
FROM cheltuiala ch
LEFT JOIN utilizator u ON u.id = ch.creat_de;

COMMIT;
