/*
  Categorii de produse — pe o bază care merge deja.

  Cerut de clinică (4 oct. 2026): „Cremele astea trebuie să apară la vânzare.
  Te rog să-mi faci 2 categorii: 1. Produse colaboratori 2. Produse clienți”.
  Aceleași creme au două prețuri — unul pentru colaboratori, altul pentru
  clienți — deci fiecare stă în nomenclator o dată pe fiecare listă.

  Un singur lucru se adaugă: `articol.categorie`, text liber, NULL = fără
  categorie. Doar produsele au categorie (`articol_categorie_ck`). Coloana intră
  la SFÂRȘIT, ca în `01_schema.sql`: `SELECT * FROM articol` întoarce aceeași
  formă pe o bază nouă și pe una migrată. Nicio vedere nu citește `articol.*`,
  deci nu se reface nimic altceva.

  Rândurile existente nu se ating: toate rămân fără categorie, iar codul vechi
  al serverului merge mai departe peste coloana nouă (nu o cere, nu o scrie).

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Textul de mai
  jos este copiat de acolo. Dacă unul se schimbă, celălalt trebuie schimbat la
  fel.

  Se poate rula de câte ori vrei.
*/

BEGIN;

ALTER TABLE articol ADD COLUMN IF NOT EXISTS categorie text;

DO $$ BEGIN
  ALTER TABLE articol ADD CONSTRAINT articol_categorie_ck CHECK (
    categorie IS NULL OR (tip = 'produs' AND btrim(categorie) <> '')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
