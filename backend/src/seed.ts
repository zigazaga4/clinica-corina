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

/*
  `sedinte` peste 1 face din serviciu un tratament: `pret` este atunci al
  ÎNTREGULUI tratament, iar fiecare venire primește o parte din el.
*/
const SERVICII: { denumire: string; durata: number; pret: number; sedinte?: number; activ?: boolean }[] = [
  { denumire: 'Curățare facială profundă', durata: 75, pret: 220 },
  { denumire: 'Tratament facial hidratant', durata: 60, pret: 180 },
  { denumire: 'Tratament anti-acnee', durata: 60, pret: 760, sedinte: 4 },
  { denumire: 'Microdermabraziune', durata: 45, pret: 250 },
  { denumire: 'Peeling chimic', durata: 40, pret: 300 },
  { denumire: 'Mezoterapie facială', durata: 50, pret: 450 },
  { denumire: 'Masaj facial anti-aging', durata: 40, pret: 160 },
  { denumire: 'Radiofrecvență facială', durata: 45, pret: 280 },
  { denumire: 'Epilare definitivă IPL — față', durata: 20, pret: 150 },
  { denumire: 'Epilare definitivă IPL — axile', durata: 25, pret: 900, sedinte: 6 },
  { denumire: 'Epilare definitivă IPL — picioare complet', durata: 60, pret: 2400, sedinte: 8 },
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

// Categoriile sunt listele de prețuri ale clinicii. Două produse rămân fără
// categorie, cum ar arăta unul adăugat din grabă, de la vânzare. Aceeași
// listă ca în datele demo din interfață (src/api/memory/seed.ts).
const CLIENTI = 'Produse clienți'
const COLABORATORI = 'Produse colaboratori'
const PRODUSE: { denumire: string; pret: number; activ?: boolean; categorie?: string }[] = [
  { denumire: 'Ser cu acid hialuronic 30 ml', pret: 200, categorie: CLIENTI },
  { denumire: 'Ser cu vitamina C 30 ml', pret: 180, categorie: CLIENTI },
  { denumire: 'Cremă hidratantă SPF 50', pret: 120, categorie: CLIENTI },
  { denumire: 'Cremă de noapte regeneratoare', pret: 160, categorie: CLIENTI },
  { denumire: 'Gel de curățare facială', pret: 95, categorie: CLIENTI },
  { denumire: 'Loțiune tonică', pret: 85, categorie: CLIENTI },
  { denumire: 'Mască facială cu argilă', pret: 75, categorie: COLABORATORI },
  { denumire: 'Cremă anticelulitică', pret: 140, categorie: CLIENTI },
  { denumire: 'Ulei pentru masaj', pret: 70, categorie: COLABORATORI },
  { denumire: 'Ulei pentru cuticule', pret: 45 },
  { denumire: 'Balsam pentru gene', pret: 90 },
  { denumire: 'Protecție solară corp SPF 30', pret: 110, activ: false, categorie: CLIENTI },
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
                             programare, tratament, nota_client, jurnal_operatiuni, sesiune,
                             cheltuiala
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

    const articole = new Map<string, { id: string; pret: number; sedinte: number }>()
    for (const s of SERVICII) {
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO articol (tip, denumire, durata_minute, pret_lista, activ, numar_sedinte)
         VALUES ('serviciu', $1, $2, $3, $4, $5) RETURNING id`,
        [s.denumire, s.durata, s.pret, s.activ ?? true, s.sedinte ?? 1],
      )
      articole.set(s.denumire, { id: rows[0]!.id, pret: s.pret, sedinte: s.sedinte ?? 1 })
    }
    for (const p of PRODUSE) {
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO articol (tip, denumire, durata_minute, pret_lista, activ, categorie)
         VALUES ('produs', $1, NULL, $2, $3, $4) RETURNING id`,
        [p.denumire, p.pret, p.activ ?? true, p.categorie ?? null],
      )
      articole.set(p.denumire, { id: rows[0]!.id, pret: p.pret, sedinte: 1 })
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
      // Tratament în curs: 2 din 6 ședințe de IPL, a doua încă neprogramată
      // mai departe — exact rândul pe care îl arată ecranul „Tratamente”.
      { client: 'Ioana Dobre', serviciu: 'Epilare definitivă IPL — axile', executant: 'mihaela.stan@clinica.ro', start: la(-30, 11, 0), stare: 'onorat' },
      { client: 'Ioana Dobre', serviciu: 'Epilare definitivă IPL — axile', executant: 'mihaela.stan@clinica.ro', start: la(-2, 11, 0), stare: 'onorat' },
      { client: 'Ioana Dobre', serviciu: 'Peeling chimic', executant: 'cristina.marin@clinica.ro', start: la(6, 12, 0), stare: 'programat', pret: 260 },
      // Tratament anti-acnee, 4 ședințe: una făcută, una programată.
      { client: 'Gabriela Nistor', serviciu: 'Tratament anti-acnee', executant: 'andreea.popescu@clinica.ro', start: la(-8, 10, 0), stare: 'onorat' },
      { client: 'Gabriela Nistor', serviciu: 'Tratament anti-acnee', executant: 'andreea.popescu@clinica.ro', start: la(6, 10, 0), stare: 'programat' },
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

    /*
      Tratamentele se deschid pe măsură ce apar ședințele lor, exact cum face
      serverul la `POST /programari`: prima ședință a unui serviciu în mai multe
      veniri deschide tratamentul, următoarele intră în el. Prețul fiecărei
      ședințe este partea ei — totalul împărțit la numărul de ședințe.
    */
    const tratamente = new Map<string, string>()
    const tratamentPentru = async (client: string, serviciu: string): Promise<string | null> => {
      const articol = articole.get(serviciu)!
      if (articol.sedinte <= 1) return null
      const cheie = `${client}|${serviciu}`
      const existent = tratamente.get(cheie)
      if (existent) return existent
      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO tratament (client_id, articol_id, numar_sedinte, pret_total, creat_de, pret_lista)
         VALUES ($1, $2, $3, $4, $5, $4) RETURNING id`,
        [cliente.get(client), articol.id, articol.sedinte, articol.pret, admin_id],
      )
      tratamente.set(cheie, rows[0]!.id)
      return rows[0]!.id
    }

    const create = new Map<string, { id: string; articol_id: string; pret: number; se_termina_la: Date }>()
    for (const p of programari) {
      const serviciu = articole.get(p.serviciu)!
      const durata = SERVICII.find((s) => s.denumire === p.serviciu)!.durata
      const se_termina_la = dupa(p.start, durata)
      const tratament_id = await tratamentPentru(p.client, p.serviciu)
      const pret = p.pret ?? Math.round((serviciu.pret / serviciu.sedinte) * 100) / 100

      const { rows } = await ex.query<{ id: string }>(
        `INSERT INTO programare
           (client_id, articol_id, executant_id, punct_lucru_id, incepe_la, se_termina_la,
            stare, pret, creat_de, tratament_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          cliente.get(p.client), serviciu.id, conturi.get(p.executant), punct_lucru_id,
          p.start, se_termina_la, p.stare, pret, admin_id, tratament_id,
        ],
      )
      create.set(`${p.client}|${p.serviciu}|${p.start.toISOString()}`, {
        id: rows[0]!.id, articol_id: serviciu.id, pret, se_termina_la,
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
      `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, efectuat_la, nota, achitat_la)
       VALUES ($1, $2, $3, $4, $5, $4) RETURNING id`,
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

    /*
      Produse luate acum și plătite mai târziu: vânzarea NEACHITATĂ. Fără ea,
      banda „De plată” de pe fișă ar arăta doar ședințe, iar bifa „Achitat” de
      pe bon n-ar avea pe ce să fie încercată.
    */
    const { rows: datorie } = await ex.query<{ id: string }>(
      `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, efectuat_la, nota, achitat_la)
       VALUES ($1, $2, $3, $4, $5, NULL) RETURNING id`,
      [
        cliente.get('Gabriela Nistor'), punct_lucru_id,
        conturi.get('mihaela.stan@clinica.ro'), la(-2, 17, 30),
        'Plătește săptămâna viitoare.',
      ],
    )
    for (const [denumire, cantitate] of [['Ser cu vitamina C 30 ml', 1], ['Loțiune tonică', 2]] as const) {
      const produs = articole.get(denumire)!
      await ex.query(
        `INSERT INTO vanzare_linie (vanzare_id, articol_id, cantitate, pret_unitar)
         VALUES ($1, $2, $3, $4)`,
        [datorie[0]!.id, produs.id, cantitate, produs.pret],
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

    /*
      Cheltuielile ultimelor două luni, ca Statisticile să aibă din ce scădea
      profitul. Doar zile trecute: o chirie „plătită” mâine ar fi o minciună.
    */
    const ziua = (zile: number) => la(zile, 12).toISOString().slice(0, 10)
    for (const [zile, categorie, suma, descriere] of [
      [-55, 'Chirie', 3500, 'Chiria spațiului'],
      [-50, 'Utilități', 640, 'Curent și apă'],
      [-40, 'Consumabile', 420, 'Mănuși, comprese, dezinfectant'],
      [-35, 'Produse pentru vânzare', 1250, 'Seruri și creme de la distribuitor'],
      [-25, 'Chirie', 3500, 'Chiria spațiului'],
      [-20, 'Utilități', 590, 'Curent și apă'],
      [-12, 'Consumabile', 380, 'Hârtie de canapea, geluri'],
      [-6, 'Marketing', 300, 'Promovare pe rețele'],
    ] as const) {
      await ex.query(
        `INSERT INTO cheltuiala (data, categorie, suma, descriere, creat_de) VALUES ($1, $2, $3, $4, $5)`,
        [ziua(zile), categorie, suma, descriere, admin_id],
      )
    }
  })

  console.log('Date de pornire scrise.\n')
  console.log(`  ${CONTURI.length} conturi, ${SERVICII.length} servicii, ${PRODUSE.length} produse,`)
  console.log(`  ${CLIENTE.length} cliente, 18 programări, 2 tratamente în curs, 1 încasare,`)
  console.log(`  1 vânzare de produse neachitată, 8 cheltuieli.\n`)
  console.log('  Parola statisticilor NU se scrie: o alege primul administrator care le deschide.')
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
