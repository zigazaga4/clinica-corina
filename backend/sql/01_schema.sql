-- ===========================================================================
--  Schema bazei de date — CTR-2026-011, ZIAN BUILDING S.R.L.
--
--  §3 Tabele și Structura Datelor, §8 Constrângeri.
--
--  Numele tabelelor și ale coloanelor sunt identice cu cele din tipurile
--  TypeScript ale interfeței (`src/domain/types.ts` în aplicație). Nu există
--  strat de mapare între cele două: ce scrie aici, aceea citește ecranul.
--  Orice redenumire se face în ambele locuri simultan.
--
--  Rulare:
--      createdb clinica
--      psql -d clinica -f sql/01_schema.sql
--      npm run seed          # date de pornire, cu parole hash-uite Argon2id
--
--  Scriptul este idempotent: îl poți rula peste o bază existentă fără să pierzi
--  date. Ce există rămâne; ce lipsește se creează.
-- ===========================================================================

BEGIN;

-- btree_gist: fără el, EXCLUDE nu poate combina `executant_id WITH =` (btree)
-- și `tstzrange WITH &&` (gist) în aceeași constrângere.
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pg_trgm: căutarea parțială după nume din lista de clienți.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- unaccent: „Ștefănescu” trebuie găsit și scriind „Stefanescu”.
CREATE EXTENSION IF NOT EXISTS unaccent;


-- ---------------------------------------------------------------------------
-- §5 Tipuri enumerate
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE rol_utilizator AS ENUM ('administrator', 'utilizator');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stare_programare AS ENUM ('programat', 'onorat', 'anulat', 'neprezentat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tip_articol AS ENUM ('serviciu', 'produs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE actiune_jurnal AS ENUM
    ('creare', 'modificare', 'stergere', 'arhivare', 'autentificare');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Abonamentele nu au ecran în aplicație; tipurile rămân pentru rutele
-- /abonamente, scrise separat.
DO $$ BEGIN
  CREATE TYPE stare_abonament AS ENUM ('activ', 'epuizat', 'anulat', 'expirat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE metoda_plata AS ENUM ('numerar', 'card', 'transfer', 'online');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- Trigger comun: `actualizat_la` nu se scrie niciodată din aplicație
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_actualizat_la() RETURNS trigger AS $$
BEGIN
  NEW.actualizat_la := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- utilizator — conturile personalului
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS utilizator (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nume                  text NOT NULL CHECK (btrim(nume) <> ''),
  email                 text NOT NULL CHECK (btrim(email) <> ''),
  -- Argon2id. Coloana nu părăsește niciodată serverul: fiecare SELECT care
  -- ajunge într-un răspuns o enumeră explicit pe celelalte.
  parola_hash           text NOT NULL,
  rol                   rol_utilizator NOT NULL DEFAULT 'utilizator',
  -- Conturile plecate se dezactivează, nu se șterg: altfel s-ar pierde cine a
  -- făcut ce, iar jurnalul ar rămâne cu rânduri fără autor.
  activ                 boolean NOT NULL DEFAULT true,
  ultima_autentificare  timestamptz,
  creat_la              timestamptz NOT NULL DEFAULT now(),
  actualizat_la         timestamptz NOT NULL DEFAULT now()
);

-- Pe `lower(email)`, nu pe `email`: două conturi care diferă doar prin
-- majuscule sunt același om și ar face autentificarea ambiguă.
CREATE UNIQUE INDEX IF NOT EXISTS utilizator_email_uk ON utilizator (lower(email));

-- Numele este și el o cheie de autentificare: în aplicație se intră cu „Irina”,
-- nu cu o adresă (v. `routes/auth.ts`, POST /login). Două conturi cu același
-- nume ar face întrebarea „cine e Irina?” ambiguă, iar cine s-ar fi conectat
-- ar fi depins de ordinea rândurilor din tabelă.
CREATE UNIQUE INDEX IF NOT EXISTS utilizator_nume_uk ON utilizator (lower(btrim(nume)));

DROP TRIGGER IF EXISTS utilizator_actualizat_la ON utilizator;
CREATE TRIGGER utilizator_actualizat_la BEFORE UPDATE ON utilizator
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- punct_lucru — locațiile clinicii
--
-- Clinica are una singură și interfața nu o cere nicăieri: serverul completează
-- punctul implicit. Tabela rămâne pentru că §3 o prevede și pentru ziua în care
-- se deschide al doilea punct — atunci se reafișează selectorul, fără migrare.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS punct_lucru (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denumire       text NOT NULL UNIQUE CHECK (btrim(denumire) <> ''),
  adresa         text,
  telefon        text,
  activ          boolean NOT NULL DEFAULT true,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS punct_lucru_actualizat_la ON punct_lucru;
CREATE TRIGGER punct_lucru_actualizat_la BEFORE UPDATE ON punct_lucru
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- articol — nomenclator unic de servicii ȘI produse
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS articol (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tip            tip_articol NOT NULL,
  denumire       text NOT NULL CHECK (btrim(denumire) <> ''),
  durata_minute  integer,
  -- Preț de referință. Prețul efectiv se COPIAZĂ pe programare și pe linia de
  -- vânzare: o scumpire de mâine nu are voie să rescrie ce s-a încasat ieri.
  pret_lista     numeric(10,2) NOT NULL CHECK (pret_lista >= 0),
  activ          boolean NOT NULL DEFAULT true,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT articol_durata_ck CHECK (
    (tip = 'serviciu' AND durata_minute IS NOT NULL AND durata_minute > 0)
    OR
    (tip = 'produs'   AND durata_minute IS NULL)
  ),

  -- Ținta cheii străine compuse din `programare`. Redundantă ca unicitate
  -- (`id` este deja PK), dar PostgreSQL cere un index unic exact pe perechea
  -- referită.
  CONSTRAINT articol_id_tip_uk UNIQUE (id, tip)
);

CREATE INDEX IF NOT EXISTS articol_denumire_trgm
  ON articol USING gin (denumire gin_trgm_ops);

DROP TRIGGER IF EXISTS articol_actualizat_la ON articol;
CREATE TRIGGER articol_actualizat_la BEFORE UPDATE ON articol
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- client — fișa de client
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Un singur câmp de nume, ca în formular. Numele întreg se scrie așa cum îl
  -- spune omul; despărțit în două coloane, jumătate din fișe ar avea „Maria
  -- Elena” într-una și nimic în cealaltă.
  nume           text NOT NULL CHECK (btrim(nume) <> ''),
  telefon        text,
  email          text,
  adresa         text,
  data_nasterii  date,
  -- Ștergere logică. NULL = activ.
  arhivat_la     timestamptz,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_nume_trgm ON client USING gin (nume gin_trgm_ops);
CREATE INDEX IF NOT EXISTS client_telefon_idx ON client (telefon);
-- Lista implicită arată doar fișele active; indexul parțial o servește direct.
CREATE INDEX IF NOT EXISTS client_activi_idx ON client (nume) WHERE arhivat_la IS NULL;

DROP TRIGGER IF EXISTS client_actualizat_la ON client;
CREATE TRIGGER client_actualizat_la BEFORE UPDATE ON client
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- nota_client — note libere pe fișă. Nu se modifică: corecția e o notă nouă.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nota_client (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  autor_id   uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  text       text NOT NULL CHECK (btrim(text) <> ''),
  creat_la   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nota_client_fisa_idx ON nota_client (client_id, creat_la DESC);


-- ---------------------------------------------------------------------------
-- programare — o ședință în calendar
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS programare (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  articol_id      uuid NOT NULL,
  -- Fixat pe 'serviciu' și legat prin cheie compusă de `articol (id, tip)`:
  -- baza însăși refuză programarea unei creme.
  articol_tip     tip_articol NOT NULL DEFAULT 'serviciu'
                  CHECK (articol_tip = 'serviciu'),
  executant_id    uuid NOT NULL REFERENCES utilizator(id) ON DELETE RESTRICT,
  punct_lucru_id  uuid NOT NULL REFERENCES punct_lucru(id) ON DELETE RESTRICT,
  incepe_la       timestamptz NOT NULL,
  se_termina_la   timestamptz NOT NULL,
  stare           stare_programare NOT NULL DEFAULT 'programat',

  -- Cât costă ȘEDINȚA ACEASTA, nu prețul din nomenclator (§ „prețul reținut”).
  -- Se completează la creare din ultimul preț al aceluiași client pentru
  -- același serviciu și rămâne apoi neatins.
  pret            numeric(10,2) NOT NULL CHECK (pret >= 0),

  nota            text,
  creat_de        uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la        timestamptz NOT NULL DEFAULT now(),
  actualizat_la   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT programare_articol_fk
    FOREIGN KEY (articol_id, articol_tip) REFERENCES articol (id, tip)
    ON DELETE RESTRICT,

  CONSTRAINT programare_interval_ck CHECK (se_termina_la > incepe_la),

  -- Aceeași persoană nu poate fi în două locuri deodată. Programările anulate
  -- sunt în afara constrângerii — locul se eliberează pentru altcineva.
  CONSTRAINT programare_fara_suprapunere EXCLUDE USING gist (
    executant_id WITH =,
    tstzrange(incepe_la, se_termina_la) WITH &&
  ) WHERE (stare <> 'anulat')
);

CREATE INDEX IF NOT EXISTS programare_calendar_idx
  ON programare (incepe_la, executant_id);
CREATE INDEX IF NOT EXISTS programare_client_idx
  ON programare (client_id, incepe_la DESC);
-- Restanțele: ședințe onorate, căutate des de banda „De plată” a fișei.
CREATE INDEX IF NOT EXISTS programare_onorate_idx
  ON programare (client_id) WHERE stare = 'onorat';

DROP TRIGGER IF EXISTS programare_actualizat_la ON programare;
CREATE TRIGGER programare_actualizat_la BEFORE UPDATE ON programare
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- consimtamant — acordul GDPR semnat de client, pe tabletă
-- ---------------------------------------------------------------------------

/*
  Singura tabelă din bază care NU se modifică niciodată.

  Nu are `actualizat_la` și nu are trigger, fiindcă nu are ce actualiza: un
  acord semnat pe care cineva îl poate rescrie mai târziu nu dovedește nimic.
  Dacă ceva e greșit, clientul semnează din nou și rămân amândouă, cu datele
  lor — istoria consimțământului este ea însăși dovada, iar o corecție tăcută
  ar șterge exact partea care contează.

  `document` ține PDF-ul întreg, exact cum l-a văzut și semnat omul. Ar fi fost
  mai ieftin să păstrăm doar semnătura și să refacem hârtia la cerere, dar
  atunci am arăta unui control o reconstituire, nu documentul. Textul se poate
  schimba între timp; PDF-ul înghețat nu.

  `date_semnatar` este instantaneul fișei din clipa semnării. Clientul își
  schimbă adresa sau numele peste un an; acordul trebuie să arate în
  continuare ce scria pe el atunci, nu ce scrie în fișă acum.
*/
CREATE TABLE IF NOT EXISTS consimtamant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, nu CASCADE: o fișă cu acorduri semnate nu poate fi ștearsă din
  -- greșeală. Pentru clienții care pleacă există arhivarea.
  client_id      uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  -- Ședința la care s-a semnat. Poate lipsi — un acord semnat la ghișeu, în
  -- afara unei programări, este tot valid.
  programare_id  uuid REFERENCES programare(id) ON DELETE SET NULL,
  -- Versiunea textului semnat, ex. „gdpr-2026-09”. Fără ea nu s-ar mai putea
  -- spune, peste doi ani, CE anume a acceptat omul.
  versiune       text NOT NULL CHECK (btrim(versiune) <> ''),
  document       bytea NOT NULL,
  -- Mărimea și amprenta stau separat ca listele să nu atingă `document`:
  -- un `SELECT *` peste o sută de acorduri ar trage zeci de megaocteți prin
  -- rețea ca să afișeze o dată și un nume.
  marime         integer NOT NULL CHECK (marime > 0),
  -- sha256 hex. Dovedește că fișierul servit azi este cel scris atunci.
  amprenta       text NOT NULL CHECK (amprenta ~ '^[0-9a-f]{64}$'),
  date_semnatar  jsonb NOT NULL,
  -- Ce tabletă a cules semnătura, cu serie cu tot.
  dispozitiv     text,
  semnat_la      timestamptz NOT NULL DEFAULT now(),
  -- Cine de la recepție a asistat. Rămâne NULL dacă i se șterge contul.
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL
);

-- Banda de acorduri din fișa clientului, cele mai noi întâi.
CREATE INDEX IF NOT EXISTS consimtamant_client_idx
  ON consimtamant (client_id, semnat_la DESC);
-- „S-a semnat la ședința asta?” — întrebare pusă la fiecare onorare.
CREATE INDEX IF NOT EXISTS consimtamant_programare_idx
  ON consimtamant (programare_id) WHERE programare_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- vanzare — antetul încasării: cui, când, unde, de către cine
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vanzare (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  punct_lucru_id  uuid NOT NULL REFERENCES punct_lucru(id) ON DELETE RESTRICT,
  operator_id     uuid NOT NULL REFERENCES utilizator(id) ON DELETE RESTRICT,
  -- Legătură istorică din §3. Interfața NU o citește și o lasă de regulă NULL:
  -- încape o singură ședință într-un antet, iar o plată stinge adesea mai
  -- multe. Adevărul stă pe `vanzare_linie.programare_id`.
  programare_id   uuid REFERENCES programare(id) ON DELETE SET NULL,
  -- Momentul real al încasării, nu al introducerii în calculator.
  efectuat_la     timestamptz NOT NULL DEFAULT now(),
  nota            text,
  creat_la        timestamptz NOT NULL DEFAULT now(),
  actualizat_la   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vanzare_client_idx ON vanzare (client_id, efectuat_la DESC);
CREATE INDEX IF NOT EXISTS vanzare_efectuat_idx ON vanzare (efectuat_la DESC);

DROP TRIGGER IF EXISTS vanzare_actualizat_la ON vanzare;
CREATE TRIGGER vanzare_actualizat_la BEFORE UPDATE ON vanzare
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- vanzare_linie — ce s-a vândut
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vanzare_linie (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vanzare_id     uuid NOT NULL REFERENCES vanzare(id) ON DELETE CASCADE,
  articol_id     uuid NOT NULL REFERENCES articol(id) ON DELETE RESTRICT,
  cantitate      numeric(10,3) NOT NULL CHECK (cantitate > 0),
  -- COPIAT la momentul vânzării. Nu se citește niciodată din `articol`.
  pret_unitar    numeric(10,2) NOT NULL CHECK (pret_unitar >= 0),
  total_linie    numeric(12,2)
                 GENERATED ALWAYS AS (round(cantitate * pret_unitar, 2)) STORED,

  -- Ședința pe care o stinge linia; NULL pentru produse.
  --
  -- Aici, pe LINIE, nu pe antet: un client lasă trei ședințe neachitate și le
  -- plătește pe toate la final, cu o singură încasare. Cu legătura doar pe
  -- antet ar fi încăput una, iar restul ar fi rămas veșnic „de plată”.
  programare_id  uuid REFERENCES programare(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS vanzare_linie_vanzare_idx ON vanzare_linie (vanzare_id);
CREATE INDEX IF NOT EXISTS vanzare_linie_articol_idx ON vanzare_linie (articol_id);

-- Constrângerea care ține locul unei coloane `achitat` pe programare.
--
-- „S-a plătit ședința?” are un singur răspuns: există sau nu o linie care o
-- indică. Indexul unic parțial garantează că nu pot exista două — adică o
-- ședință încasată de două ori. Două locuri pentru același adevăr ajung mai
-- devreme sau mai târziu să se contrazică; aici există unul singur.
CREATE UNIQUE INDEX IF NOT EXISTS vanzare_linie_programare_uk
  ON vanzare_linie (programare_id) WHERE programare_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- sesiune — refresh token-urile emise
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sesiune (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilizator_id   uuid NOT NULL REFERENCES utilizator(id) ON DELETE CASCADE,
  -- SHA-256 al refresh token-ului. Tokenul în clar nu se păstrează: o copie a
  -- bazei nu trebuie să permită impersonarea nimănui.
  token_hash      text NOT NULL UNIQUE,
  emisa_la        timestamptz NOT NULL DEFAULT now(),
  expira_la       timestamptz NOT NULL,
  revocata_la     timestamptz,
  dispozitiv      text
);

CREATE INDEX IF NOT EXISTS sesiune_utilizator_idx ON sesiune (utilizator_id)
  WHERE revocata_la IS NULL;


-- ---------------------------------------------------------------------------
-- jurnal_operatiuni — append-only: fără UPDATE, fără DELETE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jurnal_operatiuni (
  id             bigserial PRIMARY KEY,
  utilizator_id  uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  actiune        actiune_jurnal NOT NULL,
  entitate       text NOT NULL,
  entitate_id    uuid,
  -- Doar câmpurile schimbate, nu rândul întreg: un jurnal care copiază
  -- cincisprezece coloane la fiecare salvare nu mai poate fi citit de nimeni.
  date_vechi     jsonb,
  date_noi       jsonb,
  adresa_ip      inet,
  creat_la       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jurnal_recent_idx ON jurnal_operatiuni (creat_la DESC);
CREATE INDEX IF NOT EXISTS jurnal_entitate_idx ON jurnal_operatiuni (entitate, entitate_id);
CREATE INDEX IF NOT EXISTS jurnal_utilizator_idx ON jurnal_operatiuni (utilizator_id, creat_la DESC);


-- ---------------------------------------------------------------------------
-- Abonamente — pachete de ședințe cu plată în rate.
--
-- Nu au ecran în aplicație și nu fac parte din contractul API al interfeței.
-- Tabelele există pentru rutele /abonamente, păstrate din versiunea inițială a
-- serverului.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS abonament (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  articol_id        uuid NOT NULL REFERENCES articol(id) ON DELETE RESTRICT,
  punct_lucru_id    uuid NOT NULL REFERENCES punct_lucru(id) ON DELETE RESTRICT,
  creat_de          uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  numar_sedinte     integer NOT NULL CHECK (numar_sedinte > 0),
  sedinte_folosite  integer NOT NULL DEFAULT 0 CHECK (sedinte_folosite >= 0),
  pret_total        numeric(10,2) NOT NULL CHECK (pret_total >= 0),
  suma_platita      numeric(10,2) NOT NULL DEFAULT 0 CHECK (suma_platita >= 0),
  stare             stare_abonament NOT NULL DEFAULT 'activ',
  valabil_pana_la   date,
  nota              text,
  creat_la          timestamptz NOT NULL DEFAULT now(),
  actualizat_la     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abonament_sedinte_ck CHECK (sedinte_folosite <= numar_sedinte)
);

DROP TRIGGER IF EXISTS abonament_actualizat_la ON abonament;
CREATE TRIGGER abonament_actualizat_la BEFORE UPDATE ON abonament
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();

CREATE TABLE IF NOT EXISTS abonament_sedinta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abonament_id     uuid NOT NULL REFERENCES abonament(id) ON DELETE CASCADE,
  programare_id    uuid REFERENCES programare(id) ON DELETE SET NULL,
  inregistrat_de   uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  efectuat_la      timestamptz NOT NULL DEFAULT now(),
  nota             text
);

CREATE TABLE IF NOT EXISTS plata (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  abonament_id  uuid NOT NULL REFERENCES abonament(id) ON DELETE CASCADE,
  operator_id   uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  suma          numeric(10,2) NOT NULL CHECK (suma > 0),
  metoda        metoda_plata NOT NULL DEFAULT 'numerar',
  efectuat_la   timestamptz NOT NULL DEFAULT now(),
  nota          text
);

-- Contoarele abonamentului se țin singure: numărate din altă parte, ar apuca
-- să se contrazică cu rândurile pe care le rezumă.
CREATE OR REPLACE FUNCTION reimprospateaza_abonament() RETURNS trigger AS $$
DECLARE
  tinta uuid := COALESCE(NEW.abonament_id, OLD.abonament_id);
BEGIN
  UPDATE abonament a SET
    sedinte_folosite = (SELECT count(*) FROM abonament_sedinta s WHERE s.abonament_id = a.id),
    suma_platita     = (SELECT COALESCE(sum(p.suma), 0) FROM plata p WHERE p.abonament_id = a.id)
  WHERE a.id = tinta;

  UPDATE abonament a SET stare = 'epuizat'
  WHERE a.id = tinta AND a.stare = 'activ' AND a.sedinte_folosite >= a.numar_sedinte;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS abonament_sedinta_contor ON abonament_sedinta;
CREATE TRIGGER abonament_sedinta_contor
  AFTER INSERT OR DELETE ON abonament_sedinta
  FOR EACH ROW EXECUTE FUNCTION reimprospateaza_abonament();

DROP TRIGGER IF EXISTS plata_contor ON plata;
CREATE TRIGGER plata_contor
  AFTER INSERT OR DELETE ON plata
  FOR EACH ROW EXECUTE FUNCTION reimprospateaza_abonament();


-- ===========================================================================
--  Proiecțiile citite de API
--
--  Interfața primește rândurile deja însoțite de numele clientului, al
--  serviciului și al executantului. Fără asta, fiecare celulă de calendar ar
--  declanșa trei cereri, iar o săptămână cu optzeci de programări ar face două
--  sute patruzeci.
--
--  Numele lipsă devine „—”, nu NULL și nici eroare: cheile ON DELETE SET NULL
--  chiar pot indica spre nimic, iar o listă care crapă fiindcă un cont a fost
--  șters este mai rea decât una care afișează o liniuță.
-- ===========================================================================

-- Ședința, cu tot ce spune despre ea fișa clientului.
--
-- `achitat`, `vanzare_id` și `achitat_la` sunt DERIVATE — nu există coloane cu
-- aceste nume. Se citesc din linia de vânzare care indică ședința.
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
  i.efectuat_la               AS achitat_la
FROM programare p
LEFT JOIN client      c  ON c.id  = p.client_id
LEFT JOIN articol     a  ON a.id  = p.articol_id
LEFT JOIN utilizator  e  ON e.id  = p.executant_id
LEFT JOIN punct_lucru pl ON pl.id = p.punct_lucru_id
LEFT JOIN LATERAL (
  SELECT vl.vanzare_id, v.efectuat_la
  FROM vanzare_linie vl
  JOIN vanzare v ON v.id = vl.vanzare_id
  WHERE vl.programare_id = p.id
  LIMIT 1
) i ON true;


-- Linia de vânzare, cu denumirea articolului și data ședinței stinse.
CREATE OR REPLACE VIEW v_vanzare_linie_detaliu AS
SELECT
  vl.*,
  COALESCE(a.denumire, '—')     AS articol_denumire,
  COALESCE(a.tip, 'produs')     AS articol_tip,
  pr.incepe_la                  AS programare_incepe_la
FROM vanzare_linie vl
LEFT JOIN articol    a  ON a.id  = vl.articol_id
LEFT JOIN programare pr ON pr.id = vl.programare_id;


-- Antetul încasării. Liniile se aduc separat, printr-o singură interogare
-- pentru tot setul: puse aici într-un `jsonb_agg`, sumele ar ieși ca text și
-- momentele în alt format decât restul răspunsului.
CREATE OR REPLACE VIEW v_vanzare_detaliu AS
SELECT
  v.*,
  COALESCE(c.nume, '—')       AS client_nume,
  COALESCE(pl.denumire, '—')  AS punct_lucru_denumire,
  COALESCE(o.nume, '—')       AS operator_nume
FROM vanzare v
LEFT JOIN client      c  ON c.id  = v.client_id
LEFT JOIN punct_lucru pl ON pl.id = v.punct_lucru_id
LEFT JOIN utilizator  o  ON o.id  = v.operator_id;


-- Rândul din lista de clienți: contoarele de lângă nume și, mai ales, restanța.
--
-- `de_incasat` stă în listă ca recepția să vadă cine are de plătit fără să
-- deschidă fișa. Se adună din ședințele onorate pe care nu le indică nicio
-- linie de vânzare.
CREATE OR REPLACE VIEW v_client_detaliu AS
SELECT
  c.*,
  COALESCE(p.numar, 0)        AS numar_programari,
  COALESCE(v.numar, 0)        AS numar_vanzari,
  GREATEST(p.ultima_onorata, v.ultima_incasare) AS ultima_vizita,
  COALESCE(p.de_incasat, 0)   AS de_incasat
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
) v ON true;


-- ---------------------------------------------------------------------------
-- v_consimtamant_detaliu — acordurile semnate, fără fișierul propriu-zis
-- ---------------------------------------------------------------------------

/*
  `document` lipsește dinadins de mai jos.

  Este singura coloană grea din toată baza, iar listele nu au ce face cu ea:
  fișa clientului arată data, versiunea textului și cine a asistat. PDF-ul se
  cere separat, câte unul, prin ruta lui. Scris aici `c.*`, deschiderea unei
  fișe cu douăzeci de acorduri ar fi tras câțiva megaocteți prin rețea ca să
  deseneze douăzeci de rânduri de listă.
*/
CREATE OR REPLACE VIEW v_consimtamant_detaliu AS
SELECT
  c.id,
  c.client_id,
  c.programare_id,
  c.versiune,
  c.marime,
  c.amprenta,
  c.date_semnatar,
  c.dispozitiv,
  c.semnat_la,
  c.creat_de,
  cl.nume AS client_nume,
  u.nume  AS creat_de_nume
FROM consimtamant c
JOIN client cl ON cl.id = c.client_id
LEFT JOIN utilizator u ON u.id = c.creat_de;

COMMIT;
