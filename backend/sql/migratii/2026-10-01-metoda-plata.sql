/*
  Metoda de plată pe încasare: numerar sau card.

  Cerut de clinică (2026-10-01): la orice încasare — programare onorată,
  produs, ședințe încasate de pe fișă — se alege „numerar” sau „card”, iar în
  Statistici se vede cât a intrat pe fiecare și se poate schimba.

  `vanzare.metoda_plata` refolosește enumerarea `metoda_plata`, care există de
  la început pentru plățile abonamentelor. NULL = nespecificată: vânzările
  neachitate (încă neplătite) și încasările vechi, pentru care nu se știe.

  `v_vanzare_detaliu` se ȘTERGE și se reface: `v.*` capătă coloana nouă înainte
  de cele calculate, iar CREATE OR REPLACE VIEW acceptă coloane noi doar la
  sfârșit. Nicio altă vedere nu depinde de ea.

  Se poate rula de câte ori vrei. Se rulează cu rolul `clinica`.
*/

BEGIN;

ALTER TABLE vanzare ADD COLUMN IF NOT EXISTS metoda_plata metoda_plata;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vanzare_metoda_ck') THEN
    ALTER TABLE vanzare ADD CONSTRAINT vanzare_metoda_ck
      CHECK (achitat_la IS NOT NULL OR metoda_plata IS NULL);
  END IF;
END $$;

DROP VIEW IF EXISTS v_vanzare_detaliu;

CREATE VIEW v_vanzare_detaliu AS
SELECT
  v.*,
  COALESCE(c.nume, '—')       AS client_nume,
  COALESCE(pl.denumire, '—')  AS punct_lucru_denumire,
  COALESCE(o.nume, '—')       AS operator_nume,
  (v.achitat_la IS NOT NULL)  AS achitat
FROM vanzare v
LEFT JOIN client      c  ON c.id  = v.client_id
LEFT JOIN punct_lucru pl ON pl.id = v.punct_lucru_id
LEFT JOIN utilizator  o  ON o.id  = v.operator_id;

COMMIT;
