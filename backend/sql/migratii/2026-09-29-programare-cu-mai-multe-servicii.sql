/*
  Mai multe servicii într-o singură programare — pe o bază care merge deja.

  Cerut de clinică: „în aceeași programare, un serviciu și o ședință din
  abonament; sau mai multe servicii; sau mai multe ședințe din abonamente”.

  Un rând `programare` rămâne UN serviciu, cu prețul, tratamentul și plata lui.
  Rândurile cu același `vizita_id` sunt o singură programare în calendar: același
  client, aceeași persoană, același interval, aceeași stare.

  Trei lucruri se schimbă:
    1. `programare.vizita_id`: fiecare rând existent primește o vizită a lui —
       programările de până azi au, toate, câte un singur serviciu.
    2. `programare_fara_suprapunere`: serviciile aceleiași programări stau în
       același interval fără să se ciocnească între ele; cu ale altor
       programări se ciocnesc exact ca înainte.
    3. `v_programare_detaliu` capătă coloana, prin `p.*`.

  `01_schema.sql` rămâne schema întreagă, pentru o bază nouă. Textul de mai
  jos este copiat de acolo. Dacă unul se schimbă, celălalt trebuie schimbat la
  fel — altfel o bază nouă și una veche ajung să aibă forme diferite.

  `v_programare_detaliu` se ȘTERGE și se reface, nu se înlocuiește: pe o bază
  migrată, coloana nouă intră în `p.*` în mijlocul listei, iar CREATE OR
  REPLACE VIEW acceptă coloane noi doar la sfârșit.

  Compatibil cu serverul vechi: acela nu scrie coloana, deci fiecare rând al
  lui primește o vizită nouă — adică exact programarea cu un serviciu pe care
  o știa. Constrângerea nouă e mai îngăduitoare decât cea veche doar pentru
  rânduri din aceeași vizită, pe care serverul vechi nu le poate face.

  Se poate rula de câte ori vrei: coloana se adaugă o singură dată, iar
  constrângerea și vederea se refac identic.
*/

BEGIN;

-- 1. programare.vizita_id ---------------------------------------------------

-- Implicitul `gen_random_uuid()` este VOLATIL: PostgreSQL rescrie tabela și
-- dă fiecărui rând existent altă valoare — o vizită a lui. Nu e nevoie de
-- UPDATE separat și nici de declanșatorul `actualizat_la` oprit: rândurile nu
-- trec prin UPDATE, deci „ultima modificare” a programărilor rămâne neatinsă.
ALTER TABLE programare ADD COLUMN IF NOT EXISTS vizita_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS programare_vizita_idx ON programare (vizita_id);

-- 2. programare_fara_suprapunere --------------------------------------------

ALTER TABLE programare DROP CONSTRAINT IF EXISTS programare_fara_suprapunere;
ALTER TABLE programare ADD CONSTRAINT programare_fara_suprapunere EXCLUDE USING gist (
  executant_id WITH =,
  tstzrange(incepe_la, se_termina_la) WITH &&,
  vizita_id WITH <>
) WHERE (stare <> 'anulat');

-- 3. v_programare_detaliu ----------------------------------------------------

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

COMMIT;
