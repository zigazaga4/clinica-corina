/*
  Culoarea fiecărui serviciu în calendar.

  Cerut de clinica Corinei Burcut (2026-11-09): „mai multe culori atribuite
  procedurilor — albastru, galben, verde — ca să le diferențiez ușor”.

  `culoare` = #rrggbb, cu litere mici. NULL = serviciul nu are culoare proprie
  (programarea rămâne în culoarea persoanei). Doar serviciile au culoare:
  produsele nu apar în calendar.

  Se poate rula de câte ori vrei. Se rulează cu rolul clinicii.
*/

BEGIN;

ALTER TABLE articol ADD COLUMN IF NOT EXISTS culoare text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'articol_culoare_ck') THEN
    ALTER TABLE articol ADD CONSTRAINT articol_culoare_ck CHECK (
      culoare IS NULL OR (tip = 'serviciu' AND culoare ~ '^#[0-9a-f]{6}$')
    );
  END IF;
END $$;

COMMIT;
