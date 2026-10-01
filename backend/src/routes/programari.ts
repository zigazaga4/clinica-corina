/**
 * /programari — calendarul.
 *
 * Ședința poartă propriul preț, copiat la creare din ce a plătit ultima dată
 * acest client pentru acest serviciu. „Prețul reținut” nu este o tabelă
 * separată, ci chiar istoricul: o tabelă în plus ar fi trebuit ținută în
 * sincron cu programările și ar fi putut rămâne în urmă.
 *
 * O programare din calendar poate avea MAI MULTE servicii — o manichiură și
 * ședința 3 din 6 de IPL, la aceeași venire. Fiecare serviciu este un rând
 * `programare`, cu prețul, tratamentul și plata lui; rândurile aceleiași
 * programări au același `vizita_id` și aceleași client, persoană, interval,
 * stare și notă. Rutele de mai jos le schimbă pe toate deodată: un PATCH pe
 * oricare rând mută toată programarea, iar o stare nouă se pune pe toate.
 */

import { randomUUID } from 'node:crypto'
import { Router, Response } from 'express'
import pool, { alege, dynamicUpdate, unu, tranzactie, unuSauNimic, type Executor } from '../lib/db.js'
import { EroareApi, eroareConflict, eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii, listaDin, textDin } from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { inregistreazaIncasare } from '../lib/incasari.js'
import { executantulCerut } from '../lib/persoane.js'
import { programareDetaliu, programariDetaliu, punctImplicit } from '../lib/proiectii.js'
import {
  incheieDacaEComplet,
  pretTotalPentru,
  tratamentDetaliu,
  tratamentInCurs,
  tratamentulSedintei,
} from '../lib/tratamente.js'
import {
  momentCerut,
  numarCerut,
  textOptional,
  verificaIntervalProgramare,
  verificaPret,
  verificaStare,
} from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type { Articol, Programare, StareProgramare } from '../types/database.js'

const router = Router()
router.use(requireAuth)

/** Ce au în comun toate serviciile unei programări — se schimbă pe toate deodată. */
const CAMPURI_COMUNE = [
  'client_id', 'executant_id', 'punct_lucru_id', 'incepe_la', 'se_termina_la', 'nota',
] as const

/** Ce are fiecare serviciu al lui. */
const CAMPURI_SERVICIU = ['articol_id', 'pret'] as const

/** Peste atâtea servicii, lista e o greșeală de trimitere, nu o venire la clinică. */
const SERVICII_MAXIME = 20

/** Un serviciu așa cum vine în `servicii`: `{ id?, articol_id, pret?, tratament_id? }`. */
type ServiciuCerut = Record<string, unknown>

/** Un rând al programării, cu răspunsul la „s-a încasat?”. */
type RandProgramare = Programare & { achitata: boolean }

/** Ce scriu la fel toate rândurile aceleiași programări. */
interface Vizita {
  vizita_id: string
  client_id: string
  executant_id: string
  punct_lucru_id: string
  incepe_la: string
  se_termina_la: string
  stare: StareProgramare
  nota: string | null
}

/*
  Momentele venite din baza de date sunt obiecte `Date`, nu text: `pg`
  convertește singur `timestamptz`. `String(unDate)` dă forma englezească
  („Tue Jun 01 2027 10:00:00 GMT+0000 (Coordinated Universal Time)”), pe care
  PostgreSQL nu o poate citi înapoi în `tstzrange`.

  Fără conversia de mai jos, orice modificare care NU trimite ambele momente —
  o notă, un preț, alt client — cădea cu 500, pentru că valoarea neschimbată se
  întorcea la bază în forma greșită. Și verificarea suprapunerii se pierdea
  odată cu ea: 500 în loc de 409.
*/
const caText = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

// ---------------------------------------------------------------------------
// Verificări comune
// ---------------------------------------------------------------------------

/** FOREIGN KEY (articol_id, articol_tip) REFERENCES articol (id, tip) */
async function serviciulCerut(ex: Executor, articol_id: unknown): Promise<Articol> {
  const articol = await unu<Articol>(
    ex, `SELECT * FROM articol WHERE id = $1`, [articol_id], 'Serviciul',
  )
  if (articol.tip !== 'serviciu') {
    throw eroareValidare('Se pot programa doar articole de tip serviciu.', 'articol_id')
  }
  return articol
}

/*
  Suprapunerea pe aceeași persoană este PERMISĂ (cerința clinicii, 2026-10-01):
  o persoană poate avea mai multe programări la aceeași oră — o clientă cu
  vopseaua la uscat, alta pe scaun. Constrângerea `programare_fara_suprapunere`
  a fost scoasă (sql/migratii/2026-10-01-programari-suprapuse.sql), iar grila
  le așază una lângă alta.
*/

/**
 * Prețul cu care se deschide formularul pentru un client și un serviciu.
 *
 * Serviciu dintr-o venire: ultima ședință a clientului la acel serviciu
 * dictează. Ședințele anulate nu spun nimic despre ce plătește omul, deci nu
 * se numără.
 *
 * Serviciu în mai multe ședințe: prețul este PARTEA ședinței din tratament —
 * ce a rămas neplanificat din `pret_total`, împărțit la ședințele rămase.
 * Răspunsul spune și în ce tratament ar intra ședința și a câta ar fi, ca
 * formularul să poată scrie „ședința 3 din 8” înainte de a salva ceva.
 */
async function pretPentru(ex: Executor, client_id: string, articol: Articol) {
  const pret_lista = Number(articol.pret_lista)

  // Un tratament în curs — oricum ar fi fost deschis — dictează partea ședinței.
  const inCurs = await tratamentInCurs(ex, client_id, articol.id)
  if (inCurs) {
    const t = await tratamentDetaliu(ex, inCurs.id)
    return {
      pret: Number(t.pret_urmatoarea),
      din_istoric: false,
      pret_lista,
      tratament: {
        id: t.id,
        numar_sedinte: t.numar_sedinte,
        sedinta_nr: t.sedinte_programate + t.sedinte_onorate + 1,
        pret_total: Number(t.pret_total),
      },
    }
  }

  if (articol.numar_sedinte > 1) {
    // Ședința ar deschide un tratament nou: prima parte din prețul lui, care
    // la rândul lui ține minte ce s-a convenit data trecută cu acest client.
    const { pret_total, din_istoric } = await pretTotalPentru(ex, client_id, articol)
    return {
      pret: Math.round((pret_total / articol.numar_sedinte) * 100) / 100,
      din_istoric,
      pret_lista,
      tratament: { id: null, numar_sedinte: articol.numar_sedinte, sedinta_nr: 1, pret_total },
    }
  }

  const ultima = await unuSauNimic<{ pret: number }>(
    ex,
    `SELECT pret FROM programare
     WHERE client_id = $1 AND articol_id = $2 AND stare <> 'anulat'
     ORDER BY incepe_la DESC LIMIT 1`,
    [client_id, articol.id],
  )

  if (!ultima || Number(ultima.pret) === pret_lista) {
    return { pret: pret_lista, din_istoric: false, pret_lista }
  }
  return { pret: Number(ultima.pret), din_istoric: true, pret_lista }
}

// ---------------------------------------------------------------------------
// Serviciile unei programări
// ---------------------------------------------------------------------------

/**
 * `servicii` din corpul cererii: lipsă -> `undefined` (programarea cu un
 * singur serviciu, trimis ca până acum); altfel o listă nevidă de obiecte.
 */
function serviciiDin(valoare: unknown): ServiciuCerut[] | undefined {
  if (valoare === undefined || valoare === null) return undefined
  if (!Array.isArray(valoare) || valoare.length === 0) {
    throw eroareValidare('Programarea trebuie să aibă cel puțin un serviciu.', 'servicii')
  }
  if (valoare.length > SERVICII_MAXIME) {
    throw eroareValidare(`O programare poate avea cel mult ${SERVICII_MAXIME} de servicii.`, 'servicii')
  }
  return valoare.map((s, i) => {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) {
      throw eroareValidare('Fiecare serviciu se trimite ca obiect.', `servicii.${i}`)
    }
    return s as ServiciuCerut
  })
}

/**
 * Eroarea unui serviciu din listă spune și CARE serviciu: `servicii.2.pret`,
 * nu doar `pret`. Cu trei servicii în formular, „prețul nu poate fi negativ”
 * fără loc ar fi lăsat recepția să ghicească sub care căsuță.
 *
 * `index` null = serviciul a venit ca până acum, fără listă: câmpul rămâne
 * cel știut de aplicațiile deja instalate.
 */
async function peServiciu<T>(index: number | null, fn: () => Promise<T>): Promise<T> {
  if (index === null) return fn()
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EroareApi && e.camp && !e.camp.startsWith('servicii.')) {
      throw new EroareApi(e.cod, e.message, {
        camp: `servicii.${index}.${e.camp}`,
        ...(e.detalii ? { detalii: e.detalii } : {}),
        ...(e.interne ? { interne: e.interne } : {}),
      })
    }
    throw e
  }
}

/**
 * Toate serviciile programării din care face parte rândul `id`, în ordinea în
 * care s-au adăugat, blocate până la COMMIT.
 *
 * Blocate TOATE, nu doar cel cerut: o schimbare de stare sau o mutare atinge
 * fiecare rând, iar o încasare făcută între timp pe unul dintre ele l-ar fi
 * lăsat „anulat, dar plătit”.
 */
async function serviciileProgramarii(
  ex: Executor,
  id: string,
): Promise<{ ancora: RandProgramare; randuri: RandProgramare[] }> {
  const { vizita_id } = await unu<{ vizita_id: string }>(
    ex, `SELECT vizita_id FROM programare WHERE id = $1`, [id], 'Programarea',
  )
  const { rows } = await ex.query<RandProgramare>(
    `SELECT p.*, EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id) AS achitata
     FROM programare p WHERE p.vizita_id = $1
     ORDER BY p.creat_la, p.id
     FOR UPDATE OF p`,
    [vizita_id],
  )
  const ancora = rows.find((r) => r.id === id)
  // Între cele două citiri, rândul putea fi scos din programare de altcineva.
  if (!ancora) throw eroareConflict('Programarea tocmai a fost modificată; reîncearcă.')
  return { ancora, randuri: rows }
}

/**
 * Scrie un serviciu al programării: un rând `programare`, cu tratamentul și
 * prețul lui, și urma lui în jurnal.
 *
 * Tratamentul, înaintea prețului: la un serviciu în mai multe ședințe, prețul
 * ședinței este partea ei din tratament, iar tratamentul trebuie găsit (sau
 * deschis) și blocat înainte de a se număra locurile din el. Două ședințe din
 * același tratament în aceeași programare se scriu pe rând, deci a doua își ia
 * locul și partea după ce prima și le-a luat pe ale ei.
 *
 * `creat_la` este `clock_timestamp()`, nu `now()`: serviciile scrise în aceeași
 * tranzacție ar fi avut altfel exact același moment, iar ordinea lor — cea în
 * care le-a trecut recepția — s-ar fi pierdut la prima citire.
 */
async function adaugaServiciu(
  ex: Executor,
  req: AuthRequest,
  autor_id: string,
  vizita: Vizita,
  articol: Articol,
  serviciu: ServiciuCerut,
): Promise<Programare> {
  const inTratament = await tratamentulSedintei(ex, {
    client_id: vizita.client_id, articol, tratament_id: serviciu['tratament_id'], autor_id, req,
  })

  // Prețul lipsă se completează din memoria clientului, nu direct din
  // nomenclator: dacă i s-a mai făcut acest serviciu la un preț anume, acela
  // este prețul lui. Într-un tratament, memoria este chiar tratamentul.
  const pret = serviciu['pret'] === undefined || serviciu['pret'] === null
    ? (inTratament?.pret ?? (await pretPentru(ex, vizita.client_id, articol)).pret)
    : verificaPret(numarCerut(serviciu['pret'], 'pret', 'Prețul'), 'pret')

  const { rows } = await ex.query<Programare>(
    `INSERT INTO programare
       (client_id, articol_id, articol_tip, executant_id, punct_lucru_id, incepe_la, se_termina_la,
        stare, pret, nota, creat_de, tratament_id, vizita_id, creat_la)
     VALUES ($1, $2, 'serviciu', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, clock_timestamp())
     RETURNING *`,
    [
      vizita.client_id, articol.id, vizita.executant_id, vizita.punct_lucru_id,
      vizita.incepe_la, vizita.se_termina_la, vizita.stare, pret, vizita.nota, autor_id,
      inTratament?.tratament.id ?? null, vizita.vizita_id,
    ],
  )
  const rand = rows[0]!

  await scrieJurnal(ex, {
    utilizator_id: autor_id,
    actiune: 'creare',
    entitate: 'programare',
    entitate_id: rand.id,
    date_noi: instantaneu(rand as unknown as Record<string, unknown>),
    adresa_ip: adresaCererii(req),
  })

  return rand
}

// ---------------------------------------------------------------------------
// GET /programari — orice rol
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()

  /*
    Intervalul se citește ca SUPRAPUNERE, nu ca „începe între”.

    O ședință de la 23:40 la 00:20 aparține și zilei în care se termină. Filtrată
    după `incepe_la`, ar dispărea din ea — și cineva ar căuta-o degeaba în
    agenda de dimineață.
  */
  const de_la = textDin(req.query['de_la'])
  const pana_la = textDin(req.query['pana_la'])
  if (de_la) unde.brut(`se_termina_la > ${unde.marcaj(de_la)}`)
  if (pana_la) unde.brut(`incepe_la < ${unde.marcaj(pana_la)}`)

  unde.egal('executant_id', textDin(req.query['executant_id']))
  unde.egal('punct_lucru_id', textDin(req.query['punct_lucru_id']))
  unde.egal('client_id', textDin(req.query['client_id']))
  // Ședințele unui tratament, pentru fișa lui.
  unde.egal('tratament_id', textDin(req.query['tratament_id']))
  // Serviciile unei programări, pentru fereastra ei.
  unde.egal('vizita_id', textDin(req.query['vizita_id']))
  unde.oricareDin('stare::text', listaDin(req.query['stare']))

  // `neachitate` este întrebarea „cine îmi datorează bani?”, pusă din calendar.
  if (boolDin(req.query['neachitate'])) unde.brut(`stare = 'onorat' AND NOT achitat`)

  res.json(await programariDetaliu(pool, unde.where, unde.values))
}))

// ---------------------------------------------------------------------------
// GET /programari/pret-sugerat — orice rol
//
// Declarată ÎNAINTEA lui `/:id`: altfel Express citește „pret-sugerat” ca
// identificator și ruta nu se atinge niciodată.
// ---------------------------------------------------------------------------

router.get('/pret-sugerat', ruta(async (req: AuthRequest, res: Response) => {
  const client_id = textDin(req.query['client_id'])
  const articol_id = textDin(req.query['articol_id'])
  if (!client_id || !articol_id) {
    throw eroareValidare('Trebuie precizate clientul și serviciul.', 'articol_id')
  }

  await unu(pool, `SELECT id FROM client WHERE id = $1`, [client_id], 'Clientul')
  const articol = await serviciulCerut(pool, articol_id)
  res.json(await pretPentru(pool, client_id, articol))
}))

// ---------------------------------------------------------------------------
// GET /programari/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await programareDetaliu(pool, req.params['id']!))
}))

// ---------------------------------------------------------------------------
// POST /programari — orice rol
//
// Cu `servicii: [{ articol_id, pret?, tratament_id? }, …]`, programarea are
// toate serviciile din listă, în ordinea ei. Fără listă, are unul singur —
// `articol_id`, `pret`, `tratament_id` de pe corp, ca până acum.
//
// Întoarce PRIMUL serviciu, hidratat: aplicațiile deja instalate așteaptă o
// programare, nu o listă. Restul se citesc cu `GET /programari?vizita_id=`.
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>
  const lista = serviciiDin(corp['servicii'])
  const servicii: ServiciuCerut[] = lista ?? [{
    articol_id: corp['articol_id'], pret: corp['pret'], tratament_id: corp['tratament_id'],
  }]
  // Locul unui serviciu în listă, pentru `servicii.N.camp` — doar dacă lista a existat.
  const locul = (i: number) => (lista ? i : null)

  const programare = await tranzactie(async (ex: Executor) => {
    /*
      Arhivarea este, în aplicația asta, înlocuitorul ștergerii: o fișă cu
      istoric nu se șterge, se scoate din listă. Dacă tot se putea programa pe
      ea, arhivarea nu însemna nimic — fișa dispărea din căutare, dar continua
      să adune ședințe pe care nimeni nu le mai vedea.
    */
    const clientul = await unu<{ id: string; arhivat_la: Date | null }>(
      ex, `SELECT id, arhivat_la FROM client WHERE id = $1`, [corp['client_id']], 'Clientul',
    )
    if (clientul.arhivat_la !== null) {
      throw eroareValidare(
        'Clientul este arhivat; dezarhivează-l înainte de a-i face o programare.',
        'client_id',
      )
    }
    const client_id = clientul.id

    // Toate serviciile se verifică înainte de orice scriere: al treilea greșit
    // nu are voie să lase primele două programate fără el.
    const articole: Articol[] = []
    for (const [i, s] of servicii.entries()) {
      articole.push(await peServiciu(locul(i), () => serviciulCerut(ex, s['articol_id'])))
    }
    const executant = await executantulCerut(ex, corp['executant_id'])

    const incepe_la = momentCerut(corp['incepe_la'], 'incepe_la', 'Ora de început')
    const se_termina_la = momentCerut(corp['se_termina_la'], 'se_termina_la', 'Ora de sfârșit')
    verificaIntervalProgramare(incepe_la, se_termina_la)

    const vizita: Vizita = {
      vizita_id: randomUUID(),
      client_id,
      executant_id: executant.id,
      // Punctul de lucru nu mai apare în niciun formular: clinica are unul singur.
      punct_lucru_id: textDin(corp['punct_lucru_id']) ?? (await punctImplicit(ex)),
      incepe_la,
      se_termina_la,
      stare: 'programat',
      nota: textOptional(corp['nota']),
    }

    const randuri: Programare[] = []
    for (const [i, s] of servicii.entries()) {
      randuri.push(await peServiciu(locul(i), () =>
        adaugaServiciu(ex, req, autor.id, vizita, articole[i]!, s)))
    }

    return programareDetaliu(ex, randuri[0]!.id)
  })

  res.status(201).json(programare)
}))

// ---------------------------------------------------------------------------
// PATCH /programari/:id — orice rol. Modifică sau reprogramează.
//
// Clientul, persoana, intervalul și nota sunt ale PROGRAMĂRII: trimise pe
// oricare serviciu al ei, se schimbă pe toate. Serviciul și prețul sunt ale
// rândului cerut.
//
// Cu `servicii: [{ id?, articol_id, pret?, tratament_id? }, …]`, lista este
// cea COMPLETĂ a programării de acum încolo:
//   - cu `id`: un serviciu existent, cu serviciul și prețul lui (poate schimbate);
//   - fără `id`: un serviciu nou, adăugat programării;
//   - un serviciu existent care lipsește din listă se scoate: primește o
//     programare a lui și se anulează — nu există ștergere, iar fișa trebuie
//     să arate în continuare că a fost pus în calendar.
// Atunci `articol_id` și `pret` de pe corp nu mai au înțeles și se ignoră.
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>
  const lista = serviciiDin(corp['servicii'])

  const programare = await tranzactie(async (ex: Executor) => {
    const { ancora, randuri } = await serviciileProgramarii(ex, id)
    const comune = alege(corp, CAMPURI_COMUNE)

    /*
      Ce se schimbă pe fiecare serviciu. Fără listă, doar pe rândul cerut —
      exact PATCH-ul de dinainte de programările cu mai multe servicii.
    */
    const proprii = new Map<string, { index: number | null; date: Record<string, unknown> }>()
    const deAdaugat: { index: number; serviciu: ServiciuCerut }[] = []
    let deScos: RandProgramare[] = []

    if (!lista) {
      const date = alege(corp, CAMPURI_SERVICIU)
      if (Object.keys(comune).length === 0 && Object.keys(date).length === 0) {
        throw eroareValidare('Nu ai trimis niciun câmp de modificat.')
      }
      proprii.set(ancora.id, { index: null, date })
    } else {
      const pastrate = new Set<string>()
      for (const [i, s] of lista.entries()) {
        if (s['id'] === undefined || s['id'] === null || s['id'] === '') {
          deAdaugat.push({ index: i, serviciu: s })
          continue
        }
        const rand = randuri.find((r) => r.id === s['id'])
        if (!rand || pastrate.has(rand.id)) {
          throw eroareValidare('Serviciul nu face parte din această programare.', `servicii.${i}.id`)
        }
        pastrate.add(rand.id)
        proprii.set(rand.id, { index: i, date: alege(s, CAMPURI_SERVICIU) })
      }
      deScos = randuri.filter((r) => !pastrate.has(r.id))
    }
    const ramase = randuri.filter((r) => !deScos.includes(r))

    /*
      Într-un tratament, clientul și serviciul sunt ale tratamentului.

      Mutată pe alt client, ședința ar rămâne numărată în tratamentul primului;
      pe alt serviciu, ar lua o parte din prețul unui tratament de altceva.
      Ședința greșită se anulează și se face alta — anularea îi eliberează
      locul din tratament. Clientul fiind al întregii programări, o singură
      ședință de tratament rămasă în ea îl fixează.
    */
    if (comune['client_id'] !== undefined && comune['client_id'] !== ancora.client_id) {
      if (ramase.some((r) => r.tratament_id !== null)) {
        throw eroareValidare(
          'Ședința face parte dintr-un tratament; clientul nu se poate schimba. Anuleaz-o și fă alta.',
          'client_id',
        )
      }
      await unu(ex, `SELECT id FROM client WHERE id = $1`, [comune['client_id']], 'Clientul')
    }
    if (comune['executant_id'] !== undefined) await executantulCerut(ex, comune['executant_id'])
    if (comune['punct_lucru_id'] !== undefined) {
      await unu(ex, `SELECT id FROM punct_lucru WHERE id = $1`,
        [comune['punct_lucru_id']], 'Punctul de lucru')
    }
    if (comune['incepe_la'] !== undefined) {
      comune['incepe_la'] = momentCerut(comune['incepe_la'], 'incepe_la', 'Ora de început')
    }
    if (comune['se_termina_la'] !== undefined) {
      comune['se_termina_la'] = momentCerut(comune['se_termina_la'], 'se_termina_la', 'Ora de sfârșit')
    }
    if (comune['nota'] !== undefined) comune['nota'] = textOptional(comune['nota'])

    /*
      Serviciul și prețul fiecărui rând păstrat. Se compară cu ce era: formularul
      retrimite toată lista, iar un serviciu încasat, trimis neschimbat, nu are
      de ce să cadă pe „nu se mai poate schimba”.
    */
    for (const [randId, { index, date }] of proprii) {
      const rand = randuri.find((r) => r.id === randId)!
      await peServiciu(index, async () => {
        if (date['articol_id'] !== undefined) {
          if (date['articol_id'] === rand.articol_id) {
            delete date['articol_id']
          } else if (rand.tratament_id !== null) {
            throw eroareValidare(
              'Ședința face parte dintr-un tratament; serviciul nu se poate schimba. Anuleaz-o și fă alta.',
              'articol_id',
            )
          } else if (rand.achitata) {
            // Linia de pe bon spune ce s-a plătit; un alt serviciu sub ea ar
            // face bonul să mintă.
            throw eroareValidare('Serviciul este deja încasat; nu se mai poate schimba.', 'articol_id')
          } else {
            await serviciulCerut(ex, date['articol_id'])
          }
        }
        if (date['pret'] !== undefined) {
          const pret = verificaPret(numarCerut(date['pret'], 'pret', 'Prețul'), 'pret')
          if (pret === Number(rand.pret)) {
            delete date['pret']
          } else if (rand.achitata) {
            // Prețul unei ședințe deja încasate nu se mai atinge: ar rămâne
            // diferit de suma chiar plătită, iar bonul nu se rescrie.
            throw eroareValidare('Ședința este deja încasată; prețul ei nu se mai poate schimba.', 'pret')
          } else {
            date['pret'] = pret
          }
        }
      })
    }

    // Un serviciu încasat nu se scoate: bonul ar arăta plătit ceva ce nu s-a făcut.
    if (deScos.some((r) => r.achitata)) {
      throw eroareValidare(
        'Un serviciu deja încasat nu se poate scoate din programare; scoate-l mai întâi de pe bon.',
        'servicii',
      )
    }

    const articoleNoi: Articol[] = []
    for (const { index, serviciu } of deAdaugat) {
      articoleNoi.push(await peServiciu(index, () => serviciulCerut(ex, serviciu['articol_id'])))
    }

    const dupa: Vizita = {
      vizita_id: ancora.vizita_id,
      client_id: String(comune['client_id'] ?? ancora.client_id),
      executant_id: String(comune['executant_id'] ?? ancora.executant_id),
      punct_lucru_id: String(comune['punct_lucru_id'] ?? ancora.punct_lucru_id),
      incepe_la: caText(comune['incepe_la'] ?? ancora.incepe_la),
      se_termina_la: caText(comune['se_termina_la'] ?? ancora.se_termina_la),
      stare: ancora.stare,
      nota: comune['nota'] !== undefined ? (comune['nota'] as string | null) : ancora.nota,
    }
    verificaIntervalProgramare(dupa.incepe_la, dupa.se_termina_la)

    // 1. Serviciile păstrate: ce e comun pe toate, plus ce e al fiecăruia.
    for (const rand of ramase) {
      const date = { ...comune, ...(proprii.get(rand.id)?.date ?? {}) }
      if (Object.keys(date).length === 0) continue
      const q = dynamicUpdate('programare', date, 'id', rand.id)
      const { rows } = await ex.query<Programare>(q.text, q.values)

      const { achitata: _ignorat, ...vechi } = rand
      const dif = diferenta(
        vechi as unknown as Record<string, unknown>,
        rows[0]! as unknown as Record<string, unknown>,
      )
      if (dif) {
        await scrieJurnal(ex, {
          utilizator_id: autor.id,
          actiune: 'modificare',
          entitate: 'programare',
          entitate_id: rand.id,
          ...dif,
          adresa_ip: adresaCererii(req),
        })
      }
    }

    // 2. Cele scoase: o programare a lor, anulată — locul e al celorlalte.
    for (const rand of deScos) {
      const { rows } = await ex.query<{ vizita_id: string }>(
        `UPDATE programare SET stare = 'anulat', vizita_id = gen_random_uuid()
         WHERE id = $1 RETURNING vizita_id`,
        [rand.id],
      )
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'programare',
        entitate_id: rand.id,
        date_vechi: { stare: rand.stare, vizita_id: rand.vizita_id },
        date_noi: { stare: 'anulat', vizita_id: rows[0]!.vizita_id, motiv: 'scos din programare' },
        adresa_ip: adresaCererii(req),
      })
    }

    // 3. Cele noi, cu starea programării: adăugat la una deja onorată, serviciul
    // s-a făcut și el — și rămâne de plată, ca oricare altul.
    const noi: Programare[] = []
    for (const [k, { index, serviciu }] of deAdaugat.entries()) {
      noi.push(await peServiciu(index, () =>
        adaugaServiciu(ex, req, autor.id, dupa, articoleNoi[k]!, serviciu)))
    }
    if (dupa.stare === 'onorat') {
      for (const rand of noi) {
        await incheieDacaEComplet(ex, rand.tratament_id, autor.id, adresaCererii(req))
      }
    }

    // Rândul cerut, dacă a rămas în programare; altfel primul care a rămas.
    const raspuns = deScos.includes(ancora) ? (ramase[0] ?? noi[0])!.id : ancora.id
    return programareDetaliu(ex, raspuns)
  })

  res.json(programare)
}))

// ---------------------------------------------------------------------------
// PATCH /programari/:id/stare — orice rol
// ---------------------------------------------------------------------------

/**
 * Schimbarea stării, cu încasarea opțională în aceeași tranzacție.
 *
 * `achitat: true` are efect doar la trecerea pe „onorat” și doar dacă ședința
 * nu e deja plătită. Cerut pe una anulată, ar însemna încasarea unui serviciu
 * care nu a avut loc. Omis, ședința rămâne „de plată” și se stinge mai târziu
 * prin `POST /vanzari/incasare` — cazul clientei care vine de mai multe ori și
 * plătește la final.
 *
 * `pret` corectează suma ședinței în același gest: la casă se află cât s-a
 * luat de fapt — mai puțin la o ședință scurtă, mai mult la una prelungită —
 * iar la un tratament partea următoarelor ședințe se reface din ce a rămas.
 * Pe o ședință deja încasată nu se mai poate schimba, ca la PATCH.
 *
 * Starea este a PROGRAMĂRII: se pune pe toate serviciile ei. Clienta a venit
 * sau nu a venit — nu „a venit la manichiură, dar nu și la IPL”; un serviciu
 * care nu s-a mai făcut se scoate din programare, din formular. Tot așa,
 * `achitat` încasează toate serviciile neplătite, pe UN bon, iar
 * `preturi: { [id]: suma }` corectează suma fiecăruia (`pret` rămâne pentru
 * rândul cerut, ca la aplicațiile deja instalate).
 */
router.patch('/:id/stare', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as { stare?: unknown; achitat?: unknown; pret?: unknown; preturi?: unknown }
  const stare = verificaStare(corp.stare)

  const programare = await tranzactie(async (ex: Executor) => {
    const { ancora, randuri } = await serviciileProgramarii(ex, id)

    // Sumele corectate, pe rând — `camp` spune care, ca să se coloreze căsuța lui.
    const preturi = new Map<string, { pret: number; camp: string }>()
    if (corp.pret !== undefined && corp.pret !== null) {
      preturi.set(ancora.id, { pret: verificaPret(numarCerut(corp.pret, 'pret', 'Prețul'), 'pret'), camp: 'pret' })
    }
    if (corp.preturi !== undefined && corp.preturi !== null) {
      if (typeof corp.preturi !== 'object' || Array.isArray(corp.preturi)) {
        throw eroareValidare('Sumele se trimit ca { serviciu: sumă }.', 'preturi')
      }
      for (const [randId, valoare] of Object.entries(corp.preturi as Record<string, unknown>)) {
        const camp = `preturi.${randId}`
        if (!randuri.some((r) => r.id === randId)) {
          throw eroareValidare('Serviciul nu face parte din această programare.', camp)
        }
        preturi.set(randId, { pret: verificaPret(numarCerut(valoare, camp, 'Prețul'), camp), camp })
      }
    }

    for (const rand of randuri) {
      const corectat = preturi.get(rand.id)
      if (!corectat || corectat.pret === Number(rand.pret)) continue
      if (rand.achitata) {
        throw eroareValidare('Ședința este deja încasată; prețul ei nu se mai poate schimba.', corectat.camp)
      }
      await ex.query(`UPDATE programare SET pret = $1 WHERE id = $2`, [corectat.pret, rand.id])
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'programare',
        entitate_id: rand.id,
        date_vechi: { pret: Number(rand.pret) },
        date_noi: { pret: corectat.pret },
        adresa_ip: adresaCererii(req),
      })
      rand.pret = corectat.pret
    }

    const deSchimbat = randuri.filter((r) => r.stare !== stare)
    if (deSchimbat.length > 0) {
      /*
        O ședință încasată nu se poate anula.

        Altfel banii rămân agățați de o ședință care „nu a avut loc”: bonul o
        arată plătită, calendarul o arată anulată, și nu există nici rută de
        ștergere a bonului, nici noțiune de restituire prin care cineva să pună
        cele două de acord. Corectura corectă este să se scoată ședința de pe
        bon — atunci redevine de plată — și abia apoi să se anuleze.
      */
      if (stare === 'anulat' && randuri.some((r) => r.achitata)) {
        throw eroareValidare(
          randuri.length === 1
            ? 'Ședința este deja încasată; scoate-o mai întâi de pe bon, apoi anuleaz-o.'
            : 'Programarea are un serviciu deja încasat; scoate-l mai întâi de pe bon, apoi anulează programarea.',
          'stare',
        )
      }

      for (const rand of deSchimbat) {
        await ex.query(`UPDATE programare SET stare = $1 WHERE id = $2`, [stare, rand.id])
        await scrieJurnal(ex, {
          utilizator_id: autor.id,
          actiune: 'modificare',
          entitate: 'programare',
          entitate_id: rand.id,
          date_vechi: { stare: rand.stare },
          date_noi: { stare },
          adresa_ip: adresaCererii(req),
        })
        rand.stare = stare
      }
    }

    const neachitate = randuri.filter((r) => !r.achitata)
    if (corp.achitat === true && stare === 'onorat' && neachitate.length > 0) {
      await inregistreazaIncasare(ex, {
        autor_id: autor.id,
        client_id: ancora.client_id,
        programari: neachitate,
        produse: [],
        // Momentul plății este sfârșitul ședinței, nu ora la care s-a apăsat
        // butonul: bifa se pune adesea la câteva ore după, iar raportul zilei
        // ar arăta atunci banii într-o zi în care nu au intrat.
        efectuat_la: ancora.se_termina_la,
        adresa_ip: adresaCererii(req),
      })
    }

    // Ultima ședință onorată încheie tratamentul de la sine — al fiecărui serviciu.
    for (const tratament_id of new Set(randuri.map((r) => r.tratament_id))) {
      await incheieDacaEComplet(ex, tratament_id, autor.id, adresaCererii(req))
    }

    return programareDetaliu(ex, id)
  })

  res.json(programare)
}))

export default router
