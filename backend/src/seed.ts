/**
 * Date de pornire — `npm run seed`.
 *
 * Populează baza cu punctul de lucru, conturile personalului, nomenclatorul și
 * un istoric scurt: câteva cliente, ședințe onorate rămase de plată și una
 * încasată. Suficient cât să se vadă că fiecare ecran chiar funcționează, fără
 * să dea impresia unei clinici cu doi ani de activitate.
 *
 * ȘTERGE datele existente din tabelele tranzacționale. Nomenclatorul și
 * conturile se actualizează în loc (ON CONFLICT), ca rularea repetată să nu
 * schimbe identificatorii la care s-ar putea să existe deja trimiteri.
 *
 * Parolele sunt hash-uite cu Argon2id, ca cele reale — scriptul nu are cale
 * scurtă pe care serverul nu o are.
 */

import 'dotenv/config'
import argon2 from 'argon2'
import pool, { tranzactie, type Executor } from './lib/db.js'

const PAROLA_DEMO = 'parola123'

const PUNCT = { denumire: 'Clinica Centru', adresa: 'Str. Mihai Eminescu 12, București', telefon: '0212345678' }

const CONTURI: { nume: string; email: string; rol: 'administrator' | 'utilizator'; activ?: boolean }[] = [
  { nume: 'Mitea Cătălina Irina', email: 'admin@clinica.ro', rol: 'administrator' },
  { nume: 'Andreea Popescu', email: 'andreea.popescu@clinica.ro', rol: 'utilizator' },
  { nume: 'Elena Dumitrescu', email: 'elena.dumitrescu@clinica.ro', rol: 'utilizator' },
  { nume: 'Raluca Ionescu', email: 'raluca.ionescu@clinica.ro', rol: 'utilizator' },
  { nume: 'Mihaela Stan', email: 'mihaela.stan@clinica.ro', rol: 'utilizator' },
  { nume: 'Cristina Marin', email: 'cristina.marin@clinica.ro', rol: 'utilizator' },
  { nume: 'Diana Georgescu', email: 'diana.georgescu@clinica.ro', rol: 'utilizator', activ: false },
]

const SERVICII: { denumire: string; durata: number; pret: number; activ?: boolean }[] = [
  { denumire: 'Curățare facială profundă', durata: 75, pret: 220 },
  { denumire: 'Tratament facial hidratant', durata: 60, pret: 180 },
  { denumire: 'Tratament anti-acnee', durata: 60, pret: 210 },
  { denumire: 'Microdermabraziune', durata: 45, pret: 250 },
  { denumire: 'Peeling chimic', durata: 40, pret: 300 },
  { denumire: 'Mezoterapie facială', durata: 50, pret: 450 },
  { denumire: 'Masaj facial anti-aging', durata: 40, pret: 160 },
  { denumire: 'Radiofrecvență facială', durata: 45, pret: 280 },
  { denumire: 'Epilare definitivă IPL — față', durata: 20, pret: 150 },
  { denumire: 'Epilare definitivă IPL — axile', durata: 25, pret: 180 },
  { denumire: 'Epilare definitivă IPL — picioare complet', durata: 60, pret: 400 },
  { denumire: 'Epilare cu ceară — picioare', durata: 40, pret: 120 },
  { denumire: 'Manichiură clasică', durata: 45, pret: 80 },
  { denumire: 'Manichiură cu gel', durata: 75, pret: 140 },
  { denumire: 'Pedichiură clasică', durata: 60, pret: 110 },
  { denumire: 'Pedichiură cu gel', durata: 90, pret: 170 },
  { denumire: 'Extensii gene — volum rus', durata: 120, pret: 350 },
  { denumire: 'Extensii gene — întreținere', durata: 60, pret: 180 },
  { denumire: 'Laminare sprâncene', durata: 45, pret: 150 },
  { denumire: 'Masaj corporal relaxant', durata: 60, pret: 200 },
  { denumire: 'Masaj anticelulitic', durata: 50, pret: 220 },
  { denumire: 'Drenaj limfatic', durata: 60, pret: 240 },
  { denumire: 'Machiaj profesional', durata: 60, pret: 250 },
  { denumire: 'Împachetare corporală cu alge', durata: 70, pret: 260, activ: false },
]

const PRODUSE: { denumire: string; pret: number; activ?: boolean }[] = [
  { denumire: 'Ser cu acid hialuronic 30 ml', pret: 200 },
  { denumire: 'Ser cu vitamina C 30 ml', pret: 180 },
  { denumire: 'Cremă hidratantă SPF 50', pret: 120 },
  { denumire: 'Cremă de noapte regeneratoare', pret: 160 },
  { denumire: 'Gel de curățare facială', pret: 95 },
  { denumire: 'Loțiune tonică', pret: 85 },
  { denumire: 'Mască facială cu argilă', pret: 75 },
  { denumire: 'Cremă anticelulitică', pret: 140 },
  { denumire: 'Ulei pentru masaj', pret: 70 },
  { denumire: 'Ulei pentru cuticule', pret: 45 },
  { denumire: 'Balsam pentru gene', pret: 90 },
  { denumire: 'Protecție solară corp SPF 30', pret: 110, activ: false },
]

const CLIENTE: { nume: string; telefon: string; email: string | null }[] = [
  { nume: 'Ioana Dobre', telefon: '0722114455', email: 'ioana.dobre@gmail.com' },
  { nume: 'Alexandra Petrescu', telefon: '0733220099', email: 'a.petrescu@yahoo.com' },
  { nume: 'Maria Ștefănescu', telefon: '0744556677', email: null },
  { nume: 'Gabriela Nistor', telefon: '0755887766', email: 'gabi.nistor@outlook.com' },
  { nume: 'Roxana Vasilescu', telefon: '0766332211', email: null },
  { nume: 'Simona Radu', telefon: '0777445566', email: 'simona.radu@gmail.com' },
]

/** Un moment relativ la acum, ca datele să pară proaspete oricând se rulează. */
function la(zile: number, ora: number, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + zile)
  d.setHours(ora, minute, 0, 0)
  return d
}

const dupa = (start: Date, minute: number) => new Date(start.getTime() + minute * 60_000)

async function ruleaza(): Promise<void> {
  const parola_hash = await argon2.hash(PAROLA_DEMO)

  await tranzactie(async (ex: Executor) => {
    // Ordinea contează: copiii înaintea părinților, altfel cheile RESTRICT
    // opresc ștergerea.
    await ex.query(`TRUNCATE vanzare_linie, vanzare, abonament_sedinta, plata, abonament,
                             programare, nota_client, jurnal_operatiuni, sesiune
                    RESTART IDENTITY CASCADE`)
    // Nomenclatorul și fișele se rescriu întregi. Se pot șterge doar fiindcă
    // tabelele care le referă tocmai au fost golite; ordinea inversă ar lovi în
    // ON DELETE RESTRICT.
    await ex.query(`DELETE FROM client`)
    await ex.query(`DELETE FROM articol`)

    const { rows: puncte } = await ex.query<{ id: string }>(
      `INSERT INTO punct_lucru (denumire, adresa, telefon) VALUES ($1, $2, $3)
       ON CONFLICT (denumire) DO UPDATE SET adresa = EXCLUDED.adresa, telefon = EXCLUDED.telefon
       RETURNING id`,
      [PUNCT.denumire, PUNCT.adresa, PUNCT.telefon],
    )
    const punct_lucru_id = puncte[0]!.id

    const conturi = new Map<string, string>()
    for (const c of CONTURI) {
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO utilizator (nume, email, parola_hash, rol, activ)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (lower(email)) DO UPDATE
           SET nume = EXCLUDED.nume, parola_hash = EXCLUDED.parola_hash,
               rol = EXCLUDED.rol, activ = EXCLUDED.activ
         RETURNING id`,
        [c.nume, c.email, parola_hash, c.rol, c.activ ?? true],
      )
      conturi.set(c.email, rows[0]!.id)
    }
    const admin_id = conturi.get('admin@clinica.ro')!

    const articole = new Map<string, { id: string; pret: number }>()
    for (const s of SERVICII) {
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO articol (tip, denumire, durata_minute, pret_lista, activ)
         VALUES ('serviciu', $1, $2, $3, $4) RETURNING id`,
        [s.denumire, s.durata, s.pret, s.activ ?? true],
      )
      articole.set(s.denumire, { id: rows[0]!.id, pret: s.pret })
    }
    for (const p of PRODUSE) {
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO articol (tip, denumire, durata_minute, pret_lista, activ)
         VALUES ('produs', $1, NULL, $2, $3) RETURNING id`,
        [p.denumire, p.pret, p.activ ?? true],
      )
      articole.set(p.denumire, { id: rows[0]!.id, pret: p.pret })
    }

    const cliente = new Map<string, string>()
    for (const c of CLIENTE) {
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO client (nume, telefon, email, creat_de) VALUES ($1, $2, $3, $4) RETURNING id`,
        [c.nume, c.telefon, c.email, admin_id],
      )
      cliente.set(c.nume, rows[0]!.id)
    }

    /*
      Programările.

      `pret` este completat explicit peste tot, ca datele demo să arate și
      cazul „prețul reținut”: Ioana plătește 260 pentru un peeling de 300, iar
      formularul o va propune singur la următoarea programare.
    */
    const programari: {
      client: string; serviciu: string; executant: string
      start: Date; stare: 'programat' | 'onorat' | 'anulat' | 'neprezentat'
      pret?: number
    }[] = [
      { client: 'Ioana Dobre', serviciu: 'Peeling chimic', executant: 'cristina.marin@clinica.ro', start: la(-14, 11, 55), stare: 'onorat', pret: 260 },
      { client: 'Ioana Dobre', serviciu: 'Radiofrecvență facială', executant: 'andreea.popescu@clinica.ro', start: la(-7, 13, 0), stare: 'onorat' },
      { client: 'Ioana Dobre', serviciu: 'Epilare definitivă IPL — axile', executant: 'mihaela.stan@clinica.ro', start: la(-2, 11, 0), stare: 'onorat' },
      { client: 'Ioana Dobre', serviciu: 'Peeling chimic', executant: 'cristina.marin@clinica.ro', start: la(6, 12, 0), stare: 'programat', pret: 260 },
      { client: 'Alexandra Petrescu', serviciu: 'Manichiură cu gel', executant: 'raluca.ionescu@clinica.ro', start: la(-3, 10, 0), stare: 'onorat' },
      { client: 'Alexandra Petrescu', serviciu: 'Pedichiură cu gel', executant: 'raluca.ionescu@clinica.ro', start: la(-3, 11, 30), stare: 'onorat' },
      { client: 'Alexandra Petrescu', serviciu: 'Manichiură cu gel', executant: 'raluca.ionescu@clinica.ro', start: la(4, 10, 0), stare: 'programat' },
      { client: 'Maria Ștefănescu', serviciu: 'Extensii gene — volum rus', executant: 'elena.dumitrescu@clinica.ro', start: la(-5, 14, 0), stare: 'onorat' },
      { client: 'Maria Ștefănescu', serviciu: 'Extensii gene — întreținere', executant: 'elena.dumitrescu@clinica.ro', start: la(2, 14, 0), stare: 'programat' },
      { client: 'Gabriela Nistor', serviciu: 'Masaj anticelulitic', executant: 'mihaela.stan@clinica.ro', start: la(-1, 16, 0), stare: 'onorat' },
      { client: 'Gabriela Nistor', serviciu: 'Drenaj limfatic', executant: 'mihaela.stan@clinica.ro', start: la(1, 16, 0), stare: 'programat' },
      { client: 'Roxana Vasilescu', serviciu: 'Curățare facială profundă', executant: 'andreea.popescu@clinica.ro', start: la(-6, 9, 0), stare: 'neprezentat' },
      { client: 'Roxana Vasilescu', serviciu: 'Tratament facial hidratant', executant: 'andreea.popescu@clinica.ro', start: la(3, 9, 0), stare: 'programat' },
      { client: 'Simona Radu', serviciu: 'Laminare sprâncene', executant: 'cristina.marin@clinica.ro', start: la(-4, 15, 0), stare: 'anulat' },
      { client: 'Simona Radu', serviciu: 'Machiaj profesional', executant: 'cristina.marin@clinica.ro', start: la(5, 15, 0), stare: 'programat' },
    ]

    const create = new Map<string, { id: string; articol_id: string; pret: number; se_termina_la: Date }>()
    for (const p of programari) {
      const serviciu = articole.get(p.serviciu)!
      const durata = SERVICII.find((s) => s.denumire === p.serviciu)!.durata
      const se_termina_la = dupa(p.start, durata)

      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO programare
           (client_id, articol_id, executant_id, punct_lucru_id, incepe_la, se_termina_la,
            stare, pret, creat_de)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          cliente.get(p.client), serviciu.id, conturi.get(p.executant), punct_lucru_id,
          p.start, se_termina_la, p.stare, p.pret ?? serviciu.pret, admin_id,
        ],
      )
      create.set(`${p.client}|${p.serviciu}|${p.start.toISOString()}`, {
        id: rows[0]!.id, articol_id: serviciu.id, pret: p.pret ?? serviciu.pret, se_termina_la,
      })
    }

    /*
      O singură încasare, care stinge două ședințe și vinde și o cremă.

      Restul ședințelor onorate rămân neplătite intenționat: ele sunt ce dă fișa
      „De plată” și ecranul de încasare cu care se lucrează zilnic. Un demo în
      care totul e deja achitat nu arată nimic din asta.
    */
    const manichiura = create.get(`Alexandra Petrescu|Manichiură cu gel|${la(-3, 10, 0).toISOString()}`)!
    const pedichiura = create.get(`Alexandra Petrescu|Pedichiură cu gel|${la(-3, 11, 30).toISOString()}`)!
    const crema = articole.get('Cremă anticelulitică')!

    const { rows: bon } = await ex.query<{ id: string }>(
      `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, efectuat_la, nota)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        cliente.get('Alexandra Petrescu'), punct_lucru_id,
        conturi.get('raluca.ionescu@clinica.ro'), pedichiura.se_termina_la,
        'Plată la final, pentru ambele ședințe.',
      ],
    )
    for (const linie of [
      { articol_id: manichiura.articol_id, cantitate: 1, pret: manichiura.pret, programare_id: manichiura.id },
      { articol_id: pedichiura.articol_id, cantitate: 1, pret: pedichiura.pret, programare_id: pedichiura.id },
      { articol_id: crema.id, cantitate: 1, pret: crema.pret, programare_id: null },
    ]) {
      await ex.query(
        `INSERT INTO vanzare_linie (vanzare_id, articol_id, cantitate, pret_unitar, programare_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [bon[0]!.id, linie.articol_id, linie.cantitate, linie.pret, linie.programare_id],
      )
    }

    await ex.query(
      `INSERT INTO nota_client (client_id, autor_id, text) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [
        cliente.get('Ioana Dobre'), admin_id, 'Piele sensibilă — se evită produsele cu parfum.',
        cliente.get('Gabriela Nistor'), conturi.get('mihaela.stan@clinica.ro'),
        'De verificat dacă mai are produsul de acasă.',
      ],
    )
  })

  console.log('Date de pornire scrise.\n')
  console.log(`  ${CONTURI.length} conturi, ${SERVICII.length} servicii, ${PRODUSE.length} produse,`)
  console.log(`  ${CLIENTE.length} cliente, 15 programări, 1 încasare.\n`)
  console.log(`  Autentificare:  admin@clinica.ro  /  ${PAROLA_DEMO}`)
  console.log('  Schimbă parolele înainte de a pune serverul în folosință.')
}

ruleaza()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e)
    await pool.end()
    process.exit(1)
  })
