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
  actualizat_la         timestamptz NOT NULL DEFAULT now(),
  -- Culoarea aleasă de persoană pentru calendar (#rrggbb). NULL = culoarea
  -- dată automat din paleta aplicației.
  culoare               text CONSTRAINT utilizator_culoare_ck CHECK (culoare ~ '^#[0-9a-f]{6}$')
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
  -- În câte ședințe se face serviciul. Peste 1, `pret_lista` este prețul
  -- ÎNTREGULUI tratament, iar fiecare programare primește o parte din el
  -- (v. `tratament`). Un produs se vinde dintr-o bucată: rămâne 1.
  numar_sedinte  integer NOT NULL DEFAULT 1,
  -- Lista de prețuri din care face parte un produs: „Produse clienți”,
  -- „Produse colaboratori”. Același produs poate sta în amândouă, ca rânduri
  -- separate, fiecare cu prețul listei lui. Text liber, nu o listă fixă —
  -- serverul o lipește de una existentă care diferă doar prin majuscule.
  -- NULL = fără categorie. Serviciile nu au (articol_categorie_ck).
  categorie      text,

  CONSTRAINT articol_durata_ck CHECK (
    (tip = 'serviciu' AND durata_minute IS NOT NULL AND durata_minute > 0)
    OR
    (tip = 'produs'   AND durata_minute IS NULL)
  ),

  CONSTRAINT articol_sedinte_ck CHECK (
    numar_sedinte >= 1 AND (tip = 'serviciu' OR numar_sedinte = 1)
  ),

  CONSTRAINT articol_categorie_ck CHECK (
    categorie IS NULL OR (tip = 'produs' AND btrim(categorie) <> '')
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
-- nota_client — note libere pe fișă. Se pot modifica (cerința clinicii,
-- 2026-10-01); textul vechi rămâne în jurnal, la fiecare modificare.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS nota_client (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  autor_id      uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  text          text NOT NULL CHECK (btrim(text) <> ''),
  creat_la      timestamptz NOT NULL DEFAULT now(),
  -- Ultima modificare a textului; NULL = nemodificată de la scriere.
  modificat_la  timestamptz
);

CREATE INDEX IF NOT EXISTS nota_client_fisa_idx ON nota_client (client_id, creat_la DESC);


-- ---------------------------------------------------------------------------
-- tratament — un serviciu făcut în mai multe ședințe, pentru un client
-- ---------------------------------------------------------------------------

/*
  „Epilare IPL axile, 6 ședințe”, „anti-acnee, 4 ședințe”. Serviciul se
  cumpără o dată și se face în mai multe veniri; fiecare venire este o
  `programare` obișnuită, legată de rândul de aici prin `tratament_id`.

  Rândul ține DOAR ce se convine la început: câte ședințe și cât costă totul.
  Restul — câte s-au făcut, cât s-a încasat, cât mai e de programat — se
  NUMĂRĂ din programări, în `v_tratament_detaliu`. Nu există contoare ținute
  de mână: ar fi ajuns să se contrazică cu ședințele pe care le rezumă (vezi
  `abonament`, mai jos, care exact asta face și tocmai de aceea nu se
  folosește).

  Banii nu stau aici. `pret_total` se ÎMPARTE pe ședințe la crearea fiecăreia
  (restul neplanificat, la ședințele rămase) și devine `programare.pret`, iar
  de acolo urmează drumul obișnuit: onorat -> achitat -> linie de vânzare.
  Recepția poate corecta suma la fiecare ședință; ședințele următoare își
  refac singure partea din ce a rămas.

  `incheiat_la` se pune singur când s-au onorat toate ședințele, sau de mână
  când clientul renunță. Un client are cel mult un tratament ÎN CURS pentru
  același serviciu (`tratament_in_curs_uk`): o programare nouă la acel serviciu
  intră în el, nu deschide altul.
*/

CREATE TABLE IF NOT EXISTS tratament (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES client(id) ON DELETE RESTRICT,
  articol_id     uuid NOT NULL,
  articol_tip    tip_articol NOT NULL DEFAULT 'serviciu'
                 CHECK (articol_tip = 'serviciu'),
  -- Copiate din nomenclator la deschidere și editabile pe tratament: o
  -- schimbare ulterioară în nomenclator nu rescrie ce s-a convenit cu omul.
  numar_sedinte  integer NOT NULL CHECK (numar_sedinte >= 1),
  pret_total     numeric(10,2) NOT NULL CHECK (pret_total >= 0),
  nota           text,
  incheiat_la    timestamptz,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tratament_articol_fk
    FOREIGN KEY (articol_id, articol_tip) REFERENCES articol (id, tip)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS tratament_in_curs_uk
  ON tratament (client_id, articol_id) WHERE incheiat_la IS NULL;
CREATE INDEX IF NOT EXISTS tratament_client_idx
  ON tratament (client_id, creat_la DESC);

DROP TRIGGER IF EXISTS tratament_actualizat_la ON tratament;
CREATE TRIGGER tratament_actualizat_la BEFORE UPDATE ON tratament
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


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
  -- Tratamentul din care face parte ședința; NULL la serviciile dintr-o
  -- singură venire. Ultima coloană dinadins: pe o bază migrată, ALTER TABLE o
  -- pune tot la sfârșit, iar `p.*` din vederi dă atunci aceleași coloane, în
  -- aceeași ordine, indiferent cum a fost creată baza.
  tratament_id    uuid REFERENCES tratament(id) ON DELETE RESTRICT,
  -- Programarea din calendar din care face parte rândul.
  --
  -- Un rând `programare` este UN serviciu. Clienta care vine la 10:00 pentru o
  -- manichiură și ședința 3 din 6 de IPL are o singură programare în calendar,
  -- dar două rânduri aici, cu același `vizita_id`: fiecare cu prețul lui, cu
  -- tratamentul lui și cu plata lui — deci tot ce se numără pe ședință
  -- (tratamente, restanțe, încasări) rămâne numărat exact ca înainte.
  --
  -- Rândurile aceleiași vizite au același client, aceeași persoană, același
  -- interval, aceeași stare și aceeași notă; serverul le schimbă împreună.
  -- Un serviciu scos din programare primește o vizită a lui și se anulează.
  --
  -- Implicit unul nou la fiecare rând: o programare cu un singur serviciu —
  -- și toate cele de dinainte de coloană — este o vizită cu un singur rând.
  -- Ultima coloană dinadins, ca `p.*` din vederi să iasă la fel pe o bază
  -- nouă și pe una migrată.
  vizita_id       uuid NOT NULL DEFAULT gen_random_uuid(),

  CONSTRAINT programare_articol_fk
    FOREIGN KEY (articol_id, articol_tip) REFERENCES articol (id, tip)
    ON DELETE RESTRICT,

  -- Fără constrângere de suprapunere: aceeași persoană poate avea mai multe
  -- programări la aceeași oră (cerința clinicii, 2026-10-01; v. migrația
  -- 2026-10-01-programari-suprapuse.sql).
  CONSTRAINT programare_interval_ck CHECK (se_termina_la > incepe_la)
);
-- Bazele create înainte de 2026-10-01 o au încă; aici dispare și din ele.
ALTER TABLE programare DROP CONSTRAINT IF EXISTS programare_fara_suprapunere;

CREATE INDEX IF NOT EXISTS programare_calendar_idx
  ON programare (incepe_la, executant_id);
CREATE INDEX IF NOT EXISTS programare_client_idx
  ON programare (client_id, incepe_la DESC);
-- Restanțele: ședințe onorate, căutate des de banda „De plată” a fișei.
CREATE INDEX IF NOT EXISTS programare_onorate_idx
  ON programare (client_id) WHERE stare = 'onorat';
-- Ședințele unui tratament: numărate la fiecare citire a lui și la fiecare
-- programare nouă în el.
CREATE INDEX IF NOT EXISTS programare_tratament_idx
  ON programare (tratament_id, incepe_la) WHERE tratament_id IS NOT NULL;
-- Serviciile unei programări: citite împreună la fiecare modificare a ei.
CREATE INDEX IF NOT EXISTS programare_vizita_idx ON programare (vizita_id);

DROP TRIGGER IF EXISTS programare_actualizat_la ON programare;
CREATE TRIGGER programare_actualizat_la BEFORE UPDATE ON programare
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- notita — o însemnare în calendar, care NU este o programare
-- ---------------------------------------------------------------------------

/*
  „Irina e în concediu”, „vine furnizorul la 15:00”, „curățenie sala 2”.
  Ocupă un loc în calendar, dar nu are client, serviciu sau preț — și nu are
  ce căuta în `programare`, unde toate acelea sunt obligatorii. Cu o tabelă
  separată, recepția nu mai trebuie să inventeze un client „Concediu” și un
  serviciu de zero lei ca să-și scrie ceva în agendă.

  `executant_id` NULL înseamnă „pentru toată clinica”. Cu o persoană, notița
  se așază în coloana ei, în culoarea ei.

  Notița NU intră în `programare_fara_suprapunere`: este informativă, nu
  blochează intervalul. „Furnizor la 15:00” peste o ședință de la 15:00 nu e o
  greșeală, e exact ce vrea recepția să vadă. Dacă vreodată o notiță trebuie
  să și blocheze — un concediu care să refuze programările — se adaugă atunci,
  ca regulă explicită, nu se presupune acum.

  Se poate ȘTERGE, spre deosebire de programări: nu e o ședință care a avut
  loc și nu mișcă bani. Ștergerea rămâne totuși în jurnal.
*/
CREATE TABLE IF NOT EXISTS notita (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titlu          text NOT NULL CHECK (btrim(titlu) <> ''),
  detalii        text,
  executant_id   uuid REFERENCES utilizator(id) ON DELETE RESTRICT,
  incepe_la      timestamptz NOT NULL,
  se_termina_la  timestamptz NOT NULL,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notita_interval_ck CHECK (se_termina_la > incepe_la)
);

CREATE INDEX IF NOT EXISTS notita_calendar_idx
  ON notita (incepe_la, executant_id);

DROP TRIGGER IF EXISTS notita_actualizat_la ON notita;
CREATE TRIGGER notita_actualizat_la BEFORE UPDATE ON notita
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
  actualizat_la   timestamptz NOT NULL DEFAULT now(),
  -- Când a plătit clientul. NULL = NEACHITATĂ: produsele au plecat acasă cu
  -- clienta, banii vin mai târziu. Se bifează și se debifează de pe bon.
  --
  -- O vânzare care stinge ședințe este ÎNSĂȘI plata lor, deci nu poate fi
  -- neachitată (serverul refuză): ședința se socotește plătită după linia care
  -- o indică, iar o linie pe un bon neplătit ar fi spus două lucruri deodată.
  --
  -- Implicit `now()`, nu NULL: un drum care uită coloana scrie o vânzare
  -- plătită, adică ce se întâmpla înainte să existe coloana — nu o datorie
  -- inventată pe fișa cuiva. Ultima coloană dinadins, ca `v.*` din vederi să
  -- iasă la fel pe o bază nouă și pe una migrată.
  achitat_la      timestamptz DEFAULT now(),
  -- Cum s-a plătit: numerar sau card (cerința clinicii, 2026-10-01). NULL pe
  -- o vânzare neachitată — încă nu s-a plătit deloc — și pe încasările de
  -- dinainte de coloană, despre care nimeni nu mai știe. Se corectează din
  -- Statistici. După `achitat_la`, tot ca `v.*` să iasă la fel peste tot.
  metoda_plata    metoda_plata,

  CONSTRAINT vanzare_metoda_ck CHECK (achitat_la IS NOT NULL OR metoda_plata IS NULL)
);

CREATE INDEX IF NOT EXISTS vanzare_client_idx ON vanzare (client_id, efectuat_la DESC);
CREATE INDEX IF NOT EXISTS vanzare_efectuat_idx ON vanzare (efectuat_la DESC);
-- „Ce produse mi-a rămas datoare?” — puține rânduri, căutate des.
CREATE INDEX IF NOT EXISTS vanzare_neachitata_idx ON vanzare (client_id) WHERE achitat_la IS NULL;

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
-- program_lucru — în ce zile lucrează fiecare persoană, lună de lună
-- ---------------------------------------------------------------------------

/*
  Cerut de clinică (2026-10-01): persoanele lucrează pe zile pare sau impare,
  iar asta se hotărăște pe lună. Un rând = o persoană într-o lună, cu
  „pare” sau „impare” — după numărul zilei din lună (2, 4, 6… / 1, 3, 5…).

  Lipsa rândului înseamnă „fără program ales”: calendarul nu marchează nimic,
  ca înainte. `luna` este mereu ziua 1 a lunii; câte un rând pe persoană și
  lună, deci alegerea nouă o înlocuiește pe cea veche.

  „personalizat” (cerut tot pe 2026-10-01): zilele lucrate se aleg una câte
  una și stau în `zile_alese` (numerele zilelor, 1–31). O listă goală = lună
  întreagă liberă (concediu).
*/
CREATE TABLE IF NOT EXISTS program_lucru (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilizator_id  uuid NOT NULL REFERENCES utilizator(id) ON DELETE CASCADE,
  luna           date NOT NULL,
  zile           text NOT NULL,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),
  zile_alese     smallint[],

  CONSTRAINT program_lucru_luna_ck CHECK (extract(day FROM luna) = 1),
  CONSTRAINT program_lucru_zile_ck CHECK (zile IN ('pare', 'impare', 'personalizat')),
  CONSTRAINT program_lucru_alese_ck CHECK (
    (zile = 'personalizat') = (zile_alese IS NOT NULL)
    AND (zile_alese IS NULL OR (1 <= ALL (zile_alese) AND 31 >= ALL (zile_alese)))
  ),
  CONSTRAINT program_lucru_uk UNIQUE (utilizator_id, luna)
);

DROP TRIGGER IF EXISTS program_lucru_actualizat_la ON program_lucru;
CREATE TRIGGER program_lucru_actualizat_la BEFORE UPDATE ON program_lucru
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- cheltuiala — banii ieșiți: chirie, salarii, consumabile, marfă
-- ---------------------------------------------------------------------------

/*
  Jumătatea care lipsea profitului.

  Încasările spun cât a intrat; nicio altă tabelă nu spune cât a ieșit. Fără
  rândurile de aici, „profitul” din Statistici ar fi fost doar încasarea sub
  alt nume — o cifră mare și falsă, exact pe ecranul pe care se iau decizii.

  `data` este ziua plății, fără oră: chiria se plătește „pe 5”, nu „pe 5 la
  10:42”, iar o oră inventată ar fi mutat-o în altă zi pe un calculator cu alt
  fus. `categorie` este text liber, nu o listă fixă: fiecare clinică își
  împarte altfel cheltuielile, iar formularul propune categoriile folosite deja.

  Se poate ȘTERGE, ca notița: o cheltuială scrisă de două ori ar strica
  profitul fiecărei luni în care apare. Urma rămâne în jurnal.
*/
CREATE TABLE IF NOT EXISTS cheltuiala (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data           date NOT NULL,
  categorie      text NOT NULL,
  descriere      text,
  suma           numeric(10,2) NOT NULL,
  creat_de       uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  creat_la       timestamptz NOT NULL DEFAULT now(),
  actualizat_la  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cheltuiala_categorie_ck CHECK (btrim(categorie) <> ''),
  CONSTRAINT cheltuiala_suma_ck CHECK (suma > 0)
);

-- Statisticile citesc câte o perioadă; lista, cele mai noi întâi.
CREATE INDEX IF NOT EXISTS cheltuiala_data_idx ON cheltuiala (data DESC);

DROP TRIGGER IF EXISTS cheltuiala_actualizat_la ON cheltuiala;
CREATE TRIGGER cheltuiala_actualizat_la BEFORE UPDATE ON cheltuiala
  FOR EACH ROW EXECUTE FUNCTION set_actualizat_la();


-- ---------------------------------------------------------------------------
-- parola_statistici — parola separată a ecranului „Statistici”
-- ---------------------------------------------------------------------------

/*
  Banii clinicii se văd cu o parolă a lor, nu cu a contului.

  Contul de la recepție îl folosesc, în fapt, mai mulți oameni, iar unele
  calculatoare rămân deschise toată ziua. Parola de aici o știe doar cine
  trebuie să vadă încasările, cheltuielile și profitul — oricine ar fi
  autentificat în aplicație.

  Un singur rând, oricât ar încerca cineva: cheia este `true` și nu poate fi
  altceva. Lipsa rândului înseamnă „încă nealeasă” — o alege primul
  administrator care deschide ecranul. Argon2id, ca parolele conturilor, și
  la fel ca ele nu părăsește niciodată serverul.
*/
CREATE TABLE IF NOT EXISTS parola_statistici (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  parola_hash    text NOT NULL,
  actualizat_de  uuid REFERENCES utilizator(id) ON DELETE SET NULL,
  actualizat_la  timestamptz NOT NULL DEFAULT now()
);


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
-- serverului. Ce folosește aplicația pentru „serviciu în mai multe ședințe”
-- este `tratament`, mai sus: fără contoare ținute de mână și fără un al doilea
-- drum al banilor (`plata`) pe lângă încasări.
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
--
-- `sedinta_nr` / `tratament_numar_sedinte` dau „ședința 3 din 8” pe ședințele
-- unui tratament; NULL în rest. Se numără doar ședințele care CONTEAZĂ —
-- programate sau onorate; una anulată nu ocupă un loc din cele 8.
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


-- Tratamentul, cu tot ce se NUMĂRĂ din ședințele lui.
--
-- Nimic de aici nu este coloană: câte ședințe s-au făcut, cât s-a încasat și
-- cât mai e de plată se citesc din programări și din liniile de vânzare, la
-- fiecare cerere. `pret_urmatoarea` este partea propusă pentru ședința
-- următoare — ce a rămas neplanificat din `pret_total`, împărțit la ședințele
-- rămase — și este singurul loc în care se face împărțirea: serverul o
-- citește de aici la fiecare programare nouă.
--
-- Se numără doar ședințele programate sau onorate. Cele anulate și
-- neprezentările nu ocupă un loc și nu iau bani: clientul are în continuare
-- ședința de făcut.
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


-- Notița, cu numele persoanei. `executant_nume` rămâne NULL pentru notițele
-- întregii clinici — aici NULL are înțeles, nu se înlocuiește cu „—”.
CREATE OR REPLACE VIEW v_notita_detaliu AS
SELECT
  n.*,
  e.nume AS executant_nume,
  u.nume AS creat_de_nume
FROM notita n
LEFT JOIN utilizator e ON e.id = n.executant_id
LEFT JOIN utilizator u ON u.id = n.creat_de;


-- Cheltuiala, cu numele celui care a scris-o. NULL dacă i s-a șters contul.
CREATE OR REPLACE VIEW v_cheltuiala_detaliu AS
SELECT
  ch.*,
  u.nume AS creat_de_nume
FROM cheltuiala ch
LEFT JOIN utilizator u ON u.id = ch.creat_de;


-- Linia de vânzare, cu denumirea articolului, data ședinței stinse și cine a
-- făcut-o. Executantul stă pe linie, nu pe antet: operatorul antetului este
-- cine a introdus plata la recepție, iar salariul se socotește după cine a
-- lucrat (cerința clinicii, 2026-10-05). NULL pe produse — n-au executant.
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


-- Antetul încasării. Liniile se aduc separat, printr-o singură interogare
-- pentru tot setul: puse aici într-un `jsonb_agg`, sumele ar ieși ca text și
-- momentele în alt format decât restul răspunsului.
CREATE OR REPLACE VIEW v_vanzare_detaliu AS
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


-- Rândul din lista de clienți: contoarele de lângă nume și, mai ales, restanța.
--
-- `de_incasat` stă în listă ca recepția să vadă cine are de plătit fără să
-- deschidă fișa. Se adună din ședințele onorate pe care nu le indică nicio
-- linie de vânzare și din produsele vândute neachitate.
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
