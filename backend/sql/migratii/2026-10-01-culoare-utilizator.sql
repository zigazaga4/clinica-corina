/*
  Culoarea fiecărei persoane în calendar, aleasă de ea.

  Cerut de clinică (2026-10-01): „un selector de culoare pentru fiecare
  utilizator, să-și aleagă singur culoarea”. Până acum culorile veneau dintr-o
  paletă fixă, împărțită după data creării contului.

  `culoare` = #rrggbb, cu litere mici. NULL = culoarea automată de până acum.

  Se poate rula de câte ori vrei. Se rulează cu rolul `clinica`.
*/

BEGIN;

ALTER TABLE utilizator ADD COLUMN IF NOT EXISTS culoare text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utilizator_culoare_ck') THEN
    ALTER TABLE utilizator ADD CONSTRAINT utilizator_culoare_ck CHECK (culoare ~ '^#[0-9a-f]{6}$');
  END IF;
END $$;

COMMIT;
