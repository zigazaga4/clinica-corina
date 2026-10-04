# Clinica — API

Serverul aplicației de gestiune pentru clinică. Contract CTR-2026-011,
ZIAN BUILDING S.R.L.

Node + Express + PostgreSQL. Fără ORM: interogările sunt scrise de mână, iar
numele coloanelor din bază sunt identice cu numele câmpurilor din răspunsuri și
cu tipurile TypeScript ale aplicației. Nu există strat de mapare — ce scrie în
`sql/01_schema.sql` este ce citește ecranul.

---

## Pornire

Ai nevoie de PostgreSQL 14+ (pentru `gen_random_uuid`) și Node 20+.

```bash
npm install

cp .env.example .env          # completează DATABASE_URL și JWT_SECRET
createdb clinica
psql -d clinica -f sql/01_schema.sql
npm run seed                  # date de pornire; scrie parole Argon2id

npm run dev                   # http://localhost:3000
```

Autentificare după `seed`: `admin@clinica.ro` / `parola123`.
**Schimbă parolele înainte de a pune serverul în folosință.**

### O bază care merge deja

`01_schema.sql` creează ce lipsește, dar nu modifică tabelele existente. Pentru
o bază pornită înainte de o schimbare de schemă se rulează migrațiile din
`sql/migratii/`, în ordinea datei din nume — fiecare se poate rula de câte ori
vrei:

```bash
for f in sql/migratii/*.sql; do psql -d clinica -v ON_ERROR_STOP=1 -f "$f"; done
```

`sql/date/` ține date ale clinicii aduse o singură dată, nu schemă — de exemplu
listele ei de prețuri (`2026-10-04-produse-colaboratori-si-clienti.sql`, după
migrația categoriilor). Și ele se pot rula de câte ori vrei: ce există deja nu
se adaugă a doua oară și nu se atinge.

`JWT_SECRET` trebuie să aibă cel puțin 32 de caractere, altfel serverul refuză
să pornească — verificat la pornire, nu la primul login, ca să nu descoperi
lipsa lui prin `500` la ora de vârf:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Comenzi

| Comandă | Ce face |
| --- | --- |
| `npm run dev` | pornește serverul cu reîncărcare la salvare |
| `npm run build` / `npm start` | compilează în `dist/` și rulează de acolo |
| `npm run typecheck` | verifică tipurile fără să compileze |
| `npm run seed` | rescrie datele de pornire (**șterge** ce era) |
| `npm run test:db` | „văd baza? are schema și constrângerile?” |
| `npm run test:api` | verifică întreg contractul, pe serverul pornit |
| `npm run parola-statistici` | **șterge** parola statisticilor uitată; primul administrator o alege din nou |

---

## Ce ține baza

Tabelele sunt cele din §3 al specificației. Trei lucruri merită citite înainte
de a modifica ceva:

**Prețul stă pe ședință, nu în nomenclator.** `programare.pret` se copiază la
creare din ultimul preț al *aceluiași client pentru același serviciu* — de
acolo vine „prețul reținut” pe care îl propune formularul. O scumpire de mâine
nu rescrie ce s-a convenit ieri.

**„Achitat” nu este o coloană.** O ședință este plătită dacă există o linie de
vânzare care o indică: `vanzare_linie.programare_id`. Legătura stă pe LINIE, nu
pe antet, fiindcă o singură plată stinge adesea mai multe ședințe — clienta care
vine de trei ori și achită la final. Un index unic parțial garantează că aceeași
ședință nu poate fi încasată de două ori.

Din asta se derivă tot restul: `programare.achitat`, `achitat_la`, `vanzare_id`
și `client.de_incasat` sunt calculate în vederile din schemă. Două locuri pentru
același adevăr ajung mai devreme sau mai târziu să se contrazică.

**Nimic nu se șterge.** Clienții se arhivează, conturile și articolele se
dezactivează. Cheile `ON DELETE RESTRICT` refuză ștergerea a orice are istoric,
iar rutele `DELETE` există doar pentru rândurile create din greșeală, înainte de
prima folosire.

**Notița nu este o programare.** „Irina e în concediu”, „vine furnizorul la
15:00” stau în tabela `notita`: titlu, interval, opțional o persoană
(`executant_id` NULL = toată clinica). Nu au client, serviciu sau preț, nu
intră în constrângerea de suprapunere — sunt informative — și sunt singurul
lucru din calendar care se poate șterge, cu urmă în jurnal. Fără tabela asta,
recepția ar fi inventat un client „Concediu” și un serviciu de zero lei.

**Tratamentul ține doar înțelegerea.** Un serviciu cu `articol.numar_sedinte`
peste 1 se face în mai multe veniri. Prima lui programare deschide un rând în
`tratament` — câte ședințe, cât în total — iar fiecare ședință îl referă prin
`programare.tratament_id`. Nimic altceva nu se scrie acolo: câte s-au făcut,
cât s-a încasat, cât mai e de împărțit sunt coloane ale `v_tratament_detaliu`,
numărate din programări. Prețul total se împarte la programarea fiecărei
ședințe (restul neplanificat la ședințele rămase) și devine `programare.pret`,
de unde banii merg pe drumul obișnuit; corectat la o ședință, restul se
reîmparte singur. Un client are cel mult un tratament în curs la același
serviciu (`tratament_in_curs_uk`); ultima ședință onorată îl încheie de la
sine. Tabelele `abonament`/`plata` din versiunea inițială NU se folosesc
pentru asta: ar fi însemnat contoare ținute de mână și un al doilea drum al
banilor.

### Vederile

| Vedere | Pentru |
| --- | --- |
| `v_programare_detaliu` | ședința cu nume, denumiri, starea plății și „ședința 3 din 8” |
| `v_tratament_detaliu` | tratamentul cu tot ce se numără din ședințe: făcute, programate, rămase, încasat, de încasat, partea următoarei |
| `v_notita_detaliu` | notița, cu numele persoanei (NULL = toată clinica) |
| `v_vanzare_detaliu` | antetul încasării, hidratat |
| `v_vanzare_linie_detaliu` | linia, cu articolul și data ședinței stinse |
| `v_client_detaliu` | fișa cu contoare, ultima vizită și restanța |
| `v_cheltuiala_detaliu` | cheltuiala, cu numele celui care a scris-o |

---

## Rutele

Toate cer `Authorization: Bearer <access_token>`, în afara celor marcate
*public*. Rolul cerut este cel din §7.

```
POST   /auth/login              public
POST   /auth/refresh            public
GET    /auth/eu
POST   /auth/logout

GET    /clienti                 ?q= &include_arhivati= &sortare= &directie= &pagina= &pe_pagina=
POST   /clienti
GET    /clienti/:id
PATCH  /clienti/:id
DELETE /clienti/:id             administrator
POST   /clienti/:id/arhivare
POST   /clienti/:id/dezarhivare
GET    /clienti/:id/istoric
GET    /clienti/:id/note
POST   /clienti/:id/note

GET    /programari              ?de_la= &pana_la= &executant_id= &client_id= &tratament_id= &stare= &neachitate=
GET    /programari/pret-sugerat ?client_id= &articol_id=      (+ tratament: în care ar intra, a câta ședință)
POST   /programari              tratament_id? — lipsă: serverul alege singur tratamentul în curs
GET    /programari/:id
PATCH  /programari/:id
PATCH  /programari/:id/stare    { stare, achitat?, pret? }

GET    /notite                  ?de_la= &pana_la= &executant_id=   (persoana + toată clinica)
POST   /notite                  { titlu, detalii?, executant_id?, incepe_la, se_termina_la }
GET    /notite/:id
PATCH  /notite/:id              executant_id: null = toată clinica
DELETE /notite/:id

GET    /tratamente              ?client_id= &articol_id= &in_curs= &q= &pagina= &pe_pagina=
POST   /tratamente              { client_id, articol_id, numar_sedinte?, pret_total?, nota? }
GET    /tratamente/:id
PATCH  /tratamente/:id          { numar_sedinte?, pret_total?, nota? }
POST   /tratamente/:id/incheiere
POST   /tratamente/:id/redeschidere

GET    /vanzari                 ?client_id= &operator_id= &articol_id= &de_la= &pana_la= &achitat=   (+ deblocare statistici)
POST   /vanzari                 { ..., achitat? }   false = produse pe datorie
POST   /vanzari/incasare        { client_id, programare_ids[], linii[]? }
GET    /vanzari/:id
PATCH  /vanzari/:id             { ..., achitat? }   true = plătită acum, false = datoria revine

GET    /statistici/acces        { parola_setata }
POST   /statistici/acces        { parola }  ->  { jeton, expira_la }   parola statisticilor, NU a contului
PUT    /statistici/parola       administrator — { parola_noua, parola_curenta? }  ->  { jeton, expira_la }
GET    /statistici              ?de_la= &pana_la= &pas=zi|saptamana|luna &fus= &comparatie_de_la= &comparatie_pana_la=
GET    /cheltuieli              ?de_la= &pana_la= &categorie= &q= &pagina= &pe_pagina=   ->  paginat + suma
GET    /cheltuieli/categorii
POST   /cheltuieli              { data, categorie, suma, descriere? }
PATCH  /cheltuieli/:id
DELETE /cheltuieli/:id

GET    /articole                ?tip= &activ= &q=
POST   /articole                administrator
PATCH  /articole/:id            administrator
DELETE /articole/:id            administrator

GET    /puncte-lucru
POST   /puncte-lucru            administrator
PATCH  /puncte-lucru/:id        administrator

GET    /utilizatori             administrator
POST   /utilizatori             administrator
PATCH  /utilizatori/:id         administrator
POST   /utilizatori/:id/reset-parola   administrator

GET    /jurnal                  administrator
```

Rutele `/abonamente` și `/*-ref` rămân din varianta inițială a serverului. Nu
fac parte din contractul interfeței.

### Parola statisticilor

`GET /statistici`, toate rutele `/cheltuieli` și lista `GET /vanzari` cer, pe
lângă sesiune, antetul `X-Acces-Statistici: <jeton>` — jetonul primit de la
`POST /statistici/acces` cu parola statisticilor (tabela `parola_statistici`,
un singur rând, Argon2id). E altă parolă decât a oricărui cont: o alege primul
administrator care deschide ecranul, iar schimbarea ei cere parola curentă.
Jetonul ține o oră și este legat de cont, de sesiune și de parolă — schimbată,
încuie pe loc toate statisticile deschise. Fără el răspunsul este `403` cu
`camp: "acces_statistici"`, nu `401`: sesiunea aplicației rămâne neatinsă.
Uitată de toți, parola se șterge doar de pe server: `npm run parola-statistici`.

### Forme de răspuns

Listele lungi vin într-o anvelopă:

```json
{ "randuri": [ ... ], "total": 137, "pagina": 1, "pe_pagina": 25 }
```

Erorile vin întotdeauna la fel, iar `camp` este ce înroșește căsuța potrivită
din formular:

```json
{ "mesaj": "Adresa de e-mail este deja folosită.", "camp": "email" }
```

| Cod | Când |
| --- | --- |
| 400 | date invalide |
| 401 | token lipsă, expirat sau cu sesiunea revocată |
| 403 | rol insuficient sau cont dezactivat |
| 404 | rândul nu există (inclusiv identificator care nu e UUID) |
| 409 | constrângere încălcată: suprapunere, duplicat, ștergere refuzată |

---

## Ce trebuie știut despre autentificare

Access token-ul este un JWT cu durata din `JWT_EXPIRES_IN` (implicit 8 ore).
Refresh token-ul este un șir aleatoriu; în bază se păstrează doar SHA-256 al
lui, deci o copie a bazei nu impersonează pe nimeni.

Fiecare cerere autentificată verifică în bază că sesiunea nu a fost revocată și
că *acum* contul este activ. Semnătura singură ar dovedi doar că token-ul a fost
emis de noi cândva — iar „dezactivează contul” ar rămâne un buton fără efect
până la expirare.

Refresh token-ul **nu se rotește**. Aplicația rulează pe mai multe ferestre și
pe telefon; rotit, prima reînnoire l-ar invalida pe cel din mâna celorlalte.

---

## Legătura cu aplicația

Interfața ([`../frontend`](../frontend)) alege între datele demo și serverul
real dintr-o singură variabilă:

```
# .env.local, în proiectul de interfață
VITE_API_URL=http://localhost:3001
```

Absentă, aplicația rulează pe datele ei în memorie și nu are nevoie de server.

Originile Tauri (`tauri://localhost`, `http://tauri.localhost`) sunt permise
implicit la CORS, alături de `localhost:1420` și `localhost:5173`. Fără ele,
aplicația compilată ar primi eroare la fiecare cerere, în timp ce aceeași
aplicație pornită în browser ar merge perfect — genul de defect care apare abia
la prima instalare în clinică. `CORS_ORIGINS` adaugă la listă, nu o înlocuiește.

Verificarea că cele două chiar se înțeleg:

```bash
npm run test:api                       # 221 de verificări, din partea serverului
# și, din proiectul de interfață:
API_LIVE=http://localhost:3001 npx vitest run src/api/http
```

Al doilea rulează clientul HTTP **pe care îl folosește chiar aplicația**
împotriva serverului pornit. Amândouă scriu date reale: se folosesc pe baza de
dezvoltare, niciodată pe cea a clinicii.
