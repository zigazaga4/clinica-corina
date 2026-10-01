/*
  Programul de lucru personalizat: zilele lucrate alese una câte una.

  Cerut de clinică (2026-10-01), după pare / impare. `zile` primește valoarea
  'personalizat', iar numerele zilelor stau în `zile_alese` (1–31). O listă
  goală = luna întreagă liberă.

  Se poate rula de câte ori vrei. Se rulează cu rolul `clinica`.
*/

BEGIN;

ALTER TABLE program_lucru ADD COLUMN IF NOT EXISTS zile_alese smallint[];

ALTER TABLE program_lucru DROP CONSTRAINT IF EXISTS program_lucru_zile_ck;
ALTER TABLE program_lucru ADD CONSTRAINT program_lucru_zile_ck
  CHECK (zile IN ('pare', 'impare', 'personalizat'));

ALTER TABLE program_lucru DROP CONSTRAINT IF EXISTS program_lucru_alese_ck;
ALTER TABLE program_lucru ADD CONSTRAINT program_lucru_alese_ck CHECK (
  (zile = 'personalizat') = (zile_alese IS NOT NULL)
  AND (zile_alese IS NULL OR (1 <= ALL (zile_alese) AND 31 >= ALL (zile_alese)))
);

COMMIT;
