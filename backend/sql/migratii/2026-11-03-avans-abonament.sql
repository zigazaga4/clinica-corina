-- Încasarea unui abonament înainte de ședințe — avansul (2026-11-03).
--
-- „I-am pus unei paciente un abonament, 1.000 de lei, 4 ședințe. Ea n-a făcut
-- ședința, și vreau să pot să-i dau încasare. Dacă o programez și o închid, mi
-- se scade din abonament.” Până acum banii intrau doar pe o ședință onorată.
--
-- O coloană nouă pe `vanzare_linie`: `tratament_id`. O linie cu `tratament_id`
-- și fără `programare_id` este AVANS (bani luați pe abonament, încă neconsumați);
-- când o ședință a abonamentului devine onorată, linia i se atașează.
-- Nicio dată existentă nu se schimbă: coloana este NULL pe tot ce există acum.
--
-- Vederile: `v_vanzare_linie_detaliu` se reface (`vl.*` s-a lărgit, deci coloana
-- nouă ar intra la mijloc), celelalte două primesc coloane doar la coadă.
-- Se rulează ca rolul `clinica`, ca vederile să-i rămână lui.

BEGIN;

ALTER TABLE vanzare_linie
  ADD COLUMN IF NOT EXISTS tratament_id uuid REFERENCES tratament(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS vanzare_linie_tratament_idx
  ON vanzare_linie (tratament_id) WHERE tratament_id IS NOT NULL;

DROP VIEW IF EXISTS v_vanzare_linie_detaliu;
CREATE VIEW v_vanzare_linie_detaliu AS
SELECT
  vl.*,
  COALESCE(a.denumire, '—')     AS articol_denumire,
  COALESCE(a.tip, 'produs')     AS articol_tip,
  pr.incepe_la                  AS programare_incepe_la,
  pr.executant_id               AS executant_id,
  e.nume                        AS executant_nume
FROM vanzare_linie vl
LEFT JOIN articol    a  ON a.id  = vl.articol_id
LEFT JOIN programare pr ON pr.id = vl.programare_id
LEFT JOIN utilizator e  ON e.id  = pr.executant_id;

CREATE OR REPLACE VIEW v_programare_detaliu AS
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
  END                         AS sedinta_nr,
  (i.tratament_id IS NOT NULL) AS achitat_din_avans,
  COALESCE(av.avans, 0)       AS tratament_avans
FROM programare p
LEFT JOIN client      c  ON c.id  = p.client_id
LEFT JOIN articol     a  ON a.id  = p.articol_id
LEFT JOIN utilizator  e  ON e.id  = p.executant_id
LEFT JOIN punct_lucru pl ON pl.id = p.punct_lucru_id
LEFT JOIN tratament   t  ON t.id  = p.tratament_id
LEFT JOIN LATERAL (
  SELECT vl.vanzare_id, v.efectuat_la, vl.tratament_id
  FROM vanzare_linie vl
  JOIN vanzare v ON v.id = vl.vanzare_id
  WHERE vl.programare_id = p.id
  LIMIT 1
) i ON true
LEFT JOIN LATERAL (
  SELECT round(sum(vl.total_linie), 2) AS avans
  FROM vanzare_linie vl
  JOIN vanzare v ON v.id = vl.vanzare_id
  WHERE vl.tratament_id = p.tratament_id AND vl.programare_id IS NULL
    AND v.achitat_la IS NOT NULL
) av ON p.tratament_id IS NOT NULL;

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
  s.ultima_la,
  -- Cine face tratamentul: persoanele de pe ședințele neanulate (2026-10-01).
  e.executanti,
  COALESCE(av.avans, 0)                                   AS avans
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
) s ON true
LEFT JOIN LATERAL (
  SELECT round(sum(vl.total_linie), 2) AS avans
  FROM vanzare_linie vl
  JOIN vanzare v ON v.id = vl.vanzare_id
  WHERE vl.tratament_id = t.id AND vl.programare_id IS NULL
    AND v.achitat_la IS NOT NULL
) av ON true;

COMMIT;
