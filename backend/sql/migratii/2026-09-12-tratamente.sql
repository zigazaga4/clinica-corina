/*
  Tratamentele — un serviciu făcut în mai multe ședințe — pe o bază care merge
  deja.

  Trei lucruri se adaugă:
    1. `articol.numar_sedinte`: în câte veniri se face serviciul (implicit 1).
    2. tabela `tratament`: ce s-a convenit cu clientul — câte ședințe, cât în
       total — plus `programare.tratament_id`, legătura fiecărei ședințe cu el.
    3. vederile: `v_programare_detaliu` capătă „ședința 3 din 8”, iar
       `v_tratament_detaliu` numără totul din programări.

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Textul de mai
  jos este copiat de acolo. Dacă unul se schimbă, celălalt trebuie schimbat la
  fel — altfel o bază nouă și una veche ajung să aibă forme diferite.

  `v_programare_detaliu` se ȘTERGE și se reface, nu se înlocuiește: coloana
  nouă din `programare` intră în `p.*` în mijlocul listei, iar
  CREATE OR REPLACE VIEW acceptă coloane noi doar la sfârșit.

  Se poate rula de câte ori vrei: nu atinge datele existente.
*/

BEGIN;

-- 1. articol.numar_sedinte -------------------------------------------------

ALTER TABLE articol ADD COLUMN IF NOT EXISTS numar_sedinte integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE articol ADD CONSTRAINT articol_sedinte_ck CHECK (
    numar_sedinte >= 1 AND (tip = 'serviciu' OR numar_sedinte = 1)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. tratament + programare.tratament_id -----------------------------------

CREATE TABLE IF NOT EXISTS tratament (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  articol_id     uuid NOT NULL,
  articol_tip    tip_articol NOT NULL DEFAULT 'serviciu'
                 CHECK (articol_tip = 'serviciu'),
  numar_sedinte  integer NOT NULL CHECK (numar_sedinte >= 1),
  pret_total     numeric(10,2) NOT NULL CHECK (pret_total >= 0),
  nota           text,
  incheiat_la    timestamptz,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tratament_articol_fk
    FOREIGN KEY (articol_id, articol_tip) REFERENCES articol (id, tip)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS tratament_in_curs_uk
  ON tratament (client_id, articol_id) WHERE incheiat_la IS NULL;
CREATE INDEX IF NOT EXISTS tratament_client_idx
  ON tratament (client_id, creat_la DESC);

DROP TRIGGER IF EXISTS tratament_actualizat_la ON tratament;
CREATE TRIGGER tratament_actualizat_la BEFORE UPDATE ON tratament
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();

ALTER TABLE programare
  ADD COLUMN IF NOT EXISTS tratament_id uuid REFERENCES tratament(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS programare_tratament_idx
  ON programare (tratament_id, incepe_la) WHERE tratament_id IS NOT NULL;

-- 3. vederile ---------------------------------------------------------------

DROP VIEW IF EXISTS v_programare_detaliu;

CREATE VIEW v_programare_detaliu AS
SELECT
  p.*,
  COALESCE(c.nume, '—')       AS client_nume,
  c.telefon                   AS client_telefon,
  COALESCE(a.denumire, '—')   AS articol_denumire,
  a.durata_minute             AS articol_durata_minute,
  COALESCE(e.nume, '—')       AS executant_nume,
  COALESCE(pl.denumire, '—')  AS punct_lucru_denumire,
  (i.vanzare_id IS NOT NULL)  AS achitat,
  i.vanzare_id                AS vanzare_id,
  i.efectuat_la               AS achitat_la,
  t.numar_sedinte             AS tratament_numar_sedinte,
  CASE
    WHEN p.tratament_id IS NULL OR p.stare NOT IN ('programat', 'onorat') THEN NULL
    ELSE (
      SELECT count(*)::integer FROM programare q
      WHERE q.tratament_id = p.tratament_id
        AND q.stare IN ('programat', 'onorat')
        AND (q.incepe_la, q.id) <= (p.incepe_la, p.id)
    )
  END                         AS sedinta_nr
FROM programare p
LEFT JOIN client      c  ON c.id  = p.client_id
LEFT JOIN articol     a  ON a.id  = p.articol_id
LEFT JOIN utilizator  e  ON e.id  = p.executant_id
LEFT JOIN punct_lucru pl ON pl.id = p.punct_lucru_id
LEFT JOIN tratament   t  ON t.id  = p.tratament_id
LEFT JOIN LATERAL (
  SELECT vl.vanzare_id, v.efectuat_la
  FROM vanzare_linie vl
  JOIN vanzare v ON v.id = vl.vanzare_id
  WHERE vl.programare_id = p.id
  LIMIT 1
) i ON true;

CREATE OR REPLACE VIEW v_tratament_detaliu AS
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
  s.ultima_la
FROM tratament t
LEFT JOIN client  c ON c.id = t.client_id
LEFT JOIN articol a ON a.id = t.articol_id
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
