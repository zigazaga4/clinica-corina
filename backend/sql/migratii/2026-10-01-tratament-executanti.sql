-- 2026-10-01 — tratamentul spune cine îl face (`executanti`).
--
-- Numele persoanelor de pe ședințele neanulate, distincte, în ordine alfabetică.
-- Coloana nouă stă la COADA vederii, deci CREATE OR REPLACE o poate adăuga.
-- Idempotentă. Rulează ca rolul `clinica` (proprietarul vederii).

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
