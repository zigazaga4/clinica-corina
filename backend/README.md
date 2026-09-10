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

### Vederile

| Vedere | Pentru |
| --- | --- |
| `v_programare_detaliu` | ședința cu nume, denumiri și starea plății |
| `v_vanzare_detaliu` | antetul încasării, hidratat |
| `v_vanzare_linie_detaliu` | linia, cu articolul și data ședinței stinse |
| `v_client_detaliu` | fișa cu contoare, ultima vizită și restanța |

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

GET    /programari              ?de_la= &pana_la= &executant_id= &client_id= &stare= &neachitate=
GET    /programari/pret-sugerat ?client_id= &articol_id=
POST   /programari
GET    /programari/:id
PATCH  /programari/:id
PATCH  /programari/:id/stare    { stare, achitat? }

GET    /vanzari                 ?client_id= &operator_id= &articol_id= &de_la= &pana_la=
POST   /vanzari
POST   /vanzari/incasare        { client_id, programare_ids[], linii[]? }
GET    /vanzari/:id
PATCH  /vanzari/:id

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
npm run test:api                       # 91 de verificări, din partea serverului
# și, din proiectul de interfață:
API_LIVE=http://localhost:3001 npx vitest run src/api/http
```

Al doilea rulează clientul HTTP **pe care îl folosește chiar aplicația**
împotriva serverului pornit. Amândouă scriu date reale: se folosesc pe baza de
dezvoltare, niciodată pe cea a clinicii.
