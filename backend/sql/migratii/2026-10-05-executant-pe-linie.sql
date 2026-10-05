-- Cine a făcut ședința plătită de fiecare linie de vânzare (2026-10-05).
--
-- „De exemplu Adriana este onorată în soft și făcută de Anda. Eu vreau să-mi
-- apară Anda ca să pot calcula salariul ei.” Lista încasărilor arăta doar
-- operatorul — cine a introdus plata —, nu cine a lucrat.
--
-- Doar coloane noi la coada vederii: CREATE OR REPLACE le primește fără DROP.
-- Se rulează ca rolul `clinica`, ca vederea să-i rămână lui.

BEGIN;

CREATE OR REPLACE VIEW v_vanzare_linie_detaliu AS
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

COMMIT;
