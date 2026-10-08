/*
  Reducerea la abonamente — pe o bază care merge deja.

  Cerut de clinică (8 oct. 2026, mesaj vocal): „eu de obicei mai fac 50%
  reducere la toate abonamentele și vreau să-mi apară un total de plată pe care
  să-l pun eu … vreau să-mi apară total abonament și total cât am încasa de la
  el. Și vreau cumva să mi se calculeze și reducerea respectivă.”

  Un singur lucru se adaugă: `tratament.pret_lista`, prețul de listă al
  abonamentului la deschidere. `pret_total` rămâne ce s-a convenit (după
  reducere); reducerea = 1 − pret_total / pret_lista. Rândurile existente nu se
  ating: rămân cu NULL („deschis înainte de reducere”), iar codul vechi al
  serverului merge mai departe peste coloana nouă (nu o cere, nu o scrie).

  Coloana intră la SFÂRȘIT, ca în `01_schema.sql`. Vederea `v_tratament_detaliu`
  citește `t.*`, care se fixează la crearea vederii: fără refacere, coloana nu
  ar apărea în ea. Coloana nouă iese la mijlocul vederii (după `t.*`), deci
  CREATE OR REPLACE nu poate — vederea se șterge și se face la loc, în aceeași
  tranzacție. Nicio altă vedere nu depinde de ea. Textul vederii este copiat
  din `01_schema.sql`; dacă unul se schimbă, celălalt trebuie schimbat la fel.

  Se poate rula de câte ori vrei. Rulează ca proprietarul vederii (`clinica`).
*/

BEGIN;

ALTER TABLE tratament ADD COLUMN IF NOT EXISTS pret_lista numeric(10,2);

DO $$ BEGIN
  ALTER TABLE tratament ADD CONSTRAINT tratament_pret_lista_ck
    CHECK (pret_lista IS NULL OR pret_lista >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP VIEW IF EXISTS v_tratament_detaliu;

CREATE VIEW v_tratament_detaliu AS
SELECT
  t.*,
  COALESCE(c.nume, '—')                                   AS client_nume,
  c.telefon                                               AS client_telefon,
  COALESCE(a.denumire, '—')                               AS articol_denumire,
  a.durata_minute                                         AS articol_durata_minute,
  COALESCE(s.programate, 0)::integer                      AS sedinte_programate,
  COALESCE(s.onorate, 0)::integer                         AS sedinte_onorate,
  GREATEST(t.numar_sedinte - COALESCE(s.programate, 0) - COALESCE(s.onorate, 0), 0)::integer
                                                          AS sedinte_ramase,
  COALESCE(s.alocat, 0)                                   AS alocat,
  COALESCE(s.incasat, 0)                                  AS incasat,
  COALESCE(s.de_incasat, 0)                               AS de_incasat,
  CASE
    WHEN t.numar_sedinte - COALESCE(s.programate, 0) - COALESCE(s.onorate, 0) <= 0 THEN 0
    ELSE GREATEST(round(
      (t.pret_total - COALESCE(s.alocat, 0))
        / (t.numar_sedinte - COALESCE(s.programate, 0) - COALESCE(s.onorate, 0)),
      2), 0)
  END                                                     AS pret_urmatoarea,
  s.urmatoarea_la,
  s.ultima_la,
  -- Cine face tratamentul: persoanele de pe ședințele neanulate (2026-10-01).
  e.executanti
FROM tratament t
LEFT JOIN client  c ON c.id = t.client_id
LEFT JOIN articol a ON a.id = t.articol_id
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT u.nume, ', ' ORDER BY u.nume) AS executanti
  FROM programare p JOIN utilizator u ON u.id = p.executant_id
  WHERE p.tratament_id = t.id AND p.stare <> 'anulat'
) e ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE p.stare = 'programat')                       AS programate,
    count(*) FILTER (WHERE p.stare = 'onorat')                          AS onorate,
    round(sum(p.pret) FILTER (WHERE p.stare IN ('programat', 'onorat')), 2) AS alocat,
    round(sum(p.pret) FILTER (
      WHERE p.stare = 'onorat'
        AND EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id)
    ), 2)                                                               AS incasat,
    round(sum(p.pret) FILTER (
      WHERE p.stare = 'onorat'
        AND NOT EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id)
    ), 2)                                                               AS de_incasat,
    min(p.incepe_la) FILTER (WHERE p.stare = 'programat')               AS urmatoarea_la,
    max(p.incepe_la) FILTER (WHERE p.stare = 'onorat')                  AS ultima_la
  FROM programare p WHERE p.tratament_id = t.id
) s ON true;

COMMIT;
