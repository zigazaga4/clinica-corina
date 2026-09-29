/*
  Vânzări neachitate — produse date acum, plătite mai târziu — pe o bază care
  merge deja.

  Cerut de clinică: „îi dau Mariei niște creme, nu plătește acum; vreau să bifez
  «neachitat» și, când plătește, să schimb în «achitat»”.

  Trei lucruri se schimbă:
    1. `vanzare.achitat_la`: când a plătit clientul; NULL = neachitată.
       Vânzările existente au fost toate plătite pe loc — atunci nu exista
       altă cale — deci primesc exact momentul lor, `efectuat_la`.
    2. `v_vanzare_detaliu` capătă `achitat`.
    3. `v_client_detaliu`: `de_incasat` adună și produsele neachitate.

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Textul de mai
  jos este copiat de acolo. Dacă unul se schimbă, celălalt trebuie schimbat la
  fel — altfel o bază nouă și una veche ajung să aibă forme diferite.

  `v_vanzare_detaliu` se ȘTERGE și se reface, nu se înlocuiește: coloana nouă
  din `vanzare` intră în `v.*` în mijlocul listei, iar CREATE OR REPLACE VIEW
  acceptă coloane noi doar la sfârșit.

  Se poate rula de câte ori vrei. Completarea de la pasul 1 se face O SINGURĂ
  DATĂ, în aceeași mișcare cu adăugarea coloanei: rulată a doua oară, ar fi
  trecut drept plătite exact vânzările pe care cineva le-a bifat între timp
  „neachitat”.
*/

BEGIN;

-- 1. vanzare.achitat_la -----------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'vanzare'
      AND column_name = 'achitat_la'
  ) THEN
    ALTER TABLE vanzare ADD COLUMN achitat_la timestamptz DEFAULT now();

    -- Fără declanșator: completarea nu este o corecție a bonurilor, iar
    -- `actualizat_la` mutat pe azi ar fi scris „ultima corecție azi” pe
    -- fiecare încasare din istoric.
    ALTER TABLE vanzare DISABLE TRIGGER vanzare_actualizat_la;
    UPDATE vanzare SET achitat_la = efectuat_la;
    ALTER TABLE vanzare ENABLE TRIGGER vanzare_actualizat_la;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vanzare_neachitata_idx ON vanzare (client_id) WHERE achitat_la IS NULL;

-- 2. v_vanzare_detaliu -------------------------------------------------------

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

-- 3. v_client_detaliu ----------------------------------------------------------

CREATE OR REPLACE VIEW v_client_detaliu AS
SELECT
  c.*,
  COALESCE(p.numar, 0)        AS numar_programari,
  COALESCE(v.numar, 0)        AS numar_vanzari,
  GREATEST(p.ultima_onorata, v.ultima_incasare) AS ultima_vizita,
  COALESCE(p.de_incasat, 0) + COALESCE(n.de_incasat, 0) AS de_incasat
FROM client c
LEFT JOIN LATERAL (
  SELECT
    count(*)                                             AS numar,
    max(pr.incepe_la) FILTER (WHERE pr.stare = 'onorat')  AS ultima_onorata,
    COALESCE(round(sum(pr.pret) FILTER (
      WHERE pr.stare = 'onorat'
        AND NOT EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = pr.id)
    ), 2), 0)                                            AS de_incasat
  FROM programare pr WHERE pr.client_id = c.id
) p ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS numar, max(vz.efectuat_la) AS ultima_incasare
  FROM vanzare vz WHERE vz.client_id = c.id
) v ON true
LEFT JOIN LATERAL (
  SELECT round(sum(vl.total_linie), 2) AS de_incasat
  FROM vanzare vz
  JOIN vanzare_linie vl ON vl.vanzare_id = vz.id
  WHERE vz.client_id = c.id AND vz.achitat_la IS NULL
) n ON true;

COMMIT;
