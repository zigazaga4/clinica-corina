/**
 * /abonamente — pachetele de ședințe, plătite în rate.
 *
 * Abonamentele nu au ecran în aplicație și nu fac parte din contractul
 * interfeței (vezi comentariul de la montare, `src/index.ts`). Rutele sunt însă
 * montate, deci oricine are un token le poate apela: „cod parcat” și „cod
 * public” sunt două lucruri diferite, iar aici este vorba de al doilea. Prin
 * urmare ele se țin de aceleași reguli ca restul serverului — erori în forma din
 * contract, jurnal pentru fiecare mișcare de bani, blocare de rând acolo unde se
 * numără ședințele.
 *
 * Contoarele `sedinte_folosite` și `suma_platita`, ca și trecerea în „epuizat”,
 * sunt ținute de triggerul `reimprospateaza_abonament` din `sql/01_schema.sql`.
 * Nu se scriu niciodată din cerere și nici nu se recalculează aici: două locuri
 * pentru același adevăr ajung să se contrazică.
 */

import { Router, Response } from 'express'
import pool, { multe, tranzactie, unu, type Executor } from '../lib/db.js'
import { rotunjeste } from '../lib/bani.js'
import { eroareConflict, eroareNegasit, eroareValidare, ruta } from '../lib/erori.js'
import { Conditii, textDin } from '../lib/filtre.js'
import { adresaCererii, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { punctImplicit } from '../lib/proiectii.js'
import { ceruteText, numarCerut, textOptional } from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type {
  Abonament,
  AbonamentSedinta,
  CreateAbonamentRequest,
  CreatePlataRequest,
  MetodaPlata,
  Plata,
  StareAbonament,
} from '../types/database.js'

const router = Router()
router.use(requireAuth)

// ---------------------------------------------------------------------------
// Formele întoarse
// ---------------------------------------------------------------------------

interface AbonamentDetaliu extends Abonament {
  client: { id: string; nume: string; telefon: string | null } | null
  articol: { id: string; denumire: string } | null
}

interface AbonamentComplet extends AbonamentDetaliu {
  abonament_sedinta: AbonamentSedinta[]
  plata: Plata[]
}

/*
  Fișa de client are UN SINGUR câmp de nume.

  Proiecția cerea până acum și `cl.prenume`, coloană care nu există în
  `sql/01_schema.sql` — iar PostgreSQL refuză întreaga interogare, nu doar
  câmpul. Efectul era că abonamentele se puteau crea și consuma, dar nu se mai
  puteau citi niciodată: ambele GET-uri răspundeau cu 500.
*/
const DIN_ABONAMENTE = `
  SELECT a.*,
         json_build_object('id', cl.id, 'nume', cl.nume, 'telefon', cl.telefon) AS client,
         json_build_object('id', ar.id, 'denumire', ar.denumire) AS articol
  FROM abonament a
  LEFT JOIN client cl ON cl.id = a.client_id
  LEFT JOIN articol ar ON ar.id = a.articol_id`

const abonamentDetaliu = (ex: Executor, id: string) =>
  unu<AbonamentDetaliu>(ex, `${DIN_ABONAMENTE} WHERE a.id = $1`, [id], 'Abonamentul')

/**
 * Fișa unui abonament: antetul de mai sus, plus ședințele stinse și plățile.
 *
 * Copiii se aduc cu interogări separate, ca liniile bonului la /vanzari. Strânse
 * în SQL cu `json_agg`, momentele ar pleca în forma PostgreSQL —
 * „2026-01-02T10:00:00.123456+00:00” — în loc de cea a restului API-ului, unde
 * driverul le dă cu „Z” la coadă. Două forme de dată în același răspuns sunt un
 * defect care se descoperă abia în interfață.
 */
async function abonamentComplet(ex: Executor, id: string): Promise<AbonamentComplet> {
  const antet = await abonamentDetaliu(ex, id)
  const abonament_sedinta = await multe<AbonamentSedinta>(
    ex,
    `SELECT * FROM abonament_sedinta WHERE abonament_id = $1 ORDER BY efectuat_la DESC`,
    [id],
  )
  const plata = await multe<Plata>(
    ex, `SELECT * FROM plata WHERE abonament_id = $1 ORDER BY efectuat_la DESC`, [id],
  )
  return { ...antet, abonament_sedinta, plata }
}

// ---------------------------------------------------------------------------
// Verificări făcute înainte de a atinge baza
//
// Constrângerile din schemă rămân ultimul cuvânt, dar ele nu spun de ce au
// refuzat: un enum greșit iese din `pg` ca 22P02, adică „nu a fost găsită”, iar
// un `numeric(10,2)` depășit ca 22003, pe care traducerea centrală nu îl
// cunoaște — deci 500. Verificate aici, aceleași reguli întorc mesajul care
// spune ce câmp trebuie schimbat.
// ---------------------------------------------------------------------------

const STARI_ABONAMENT = ['activ', 'epuizat', 'anulat', 'expirat'] as const
const METODE_PLATA = ['numerar', 'card', 'transfer', 'online'] as const

/** Cât încape într-un `numeric(10,2)`. Peste, baza refuză cu „numeric field overflow”. */
const SUMA_MAXIMA = 99_999_999.99

/** Un pachet mai mare de atât este o greșeală de tastare, nu un abonament. */
const SEDINTE_MAXIME = 1000

const TIPAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIPAR_DATA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Un identificator venit dintr-un câmp de formular.
 *
 * Trimis strâmb, ajunge în bază și se întoarce ca 22P02, tradus central în „nu a
 * fost găsită” — corect pentru o adresă greșită, dar derutant într-un formular,
 * unde rămâne fără căsuță colorată. Aici se știe care câmp e vinovat.
 */
function idCerut(valoare: unknown, camp: string, eticheta: string): string {
  const text = ceruteText(valoare, camp, eticheta)
  if (!TIPAR_UUID.test(text)) {
    throw eroareValidare(`${eticheta} nu este un identificator valid.`, camp)
  }
  return text
}

/** Același lucru, pentru un câmp care poate lipsi. */
function idOptional(valoare: unknown, camp: string, eticheta: string): string | null {
  const text = textDin(valoare)
  return text === undefined ? null : idCerut(text, camp, eticheta)
}

/**
 * Identificatorul din adresă.
 *
 * Strâmb înseamnă 404, nu 400: nu este un câmp completat greșit, ci o adresă
 * care nu duce nicăieri. Aceeași alegere ca a traducerii lui 22P02 din
 * `lib/erori.ts`, doar că fără drum până la bază.
 */
function idDinAdresa(valoare: unknown): string {
  const text = typeof valoare === 'string' ? valoare : ''
  if (!TIPAR_UUID.test(text)) throw eroareNegasit('Abonamentul')
  return text
}

/** CHECK (pret_total >= 0) / CHECK (suma > 0), plus limita coloanei. */
function sumaCeruta(
  valoare: unknown,
  camp: string,
  eticheta: string,
  strictPozitiva: boolean,
): number {
  const n = numarCerut(valoare, camp, eticheta)
  if (strictPozitiva ? n <= 0 : n < 0) {
    throw eroareValidare(
      strictPozitiva
        ? `${eticheta} trebuie să fie mai mare ca zero.`
        : `${eticheta} nu poate fi negativ.`,
      camp,
    )
  }
  if (n > SUMA_MAXIMA) throw eroareValidare(`${eticheta} depășește maximul acceptat.`, camp)
  // Rotunjit ca în bază: altfel 10.999 s-ar scrie 11.00 și verificările de mai
  // sus ar fi făcut pe altă sumă decât cea încasată.
  return rotunjeste(n)
}

/** CHECK (numar_sedinte > 0), pe o coloană `integer`. */
function sedinteCerute(valoare: unknown): number {
  const n = numarCerut(valoare, 'numar_sedinte', 'Numărul de ședințe')
  if (!Number.isInteger(n) || n <= 0) {
    throw eroareValidare(
      'Numărul de ședințe trebuie să fie un întreg mai mare ca zero.',
      'numar_sedinte',
    )
  }
  if (n > SEDINTE_MAXIME) {
    throw eroareValidare(
      `Un abonament nu poate avea mai mult de ${SEDINTE_MAXIME} de ședințe.`,
      'numar_sedinte',
    )
  }
  return n
}

/** Coloana este `date`; orice altceva decât an-lună-zi o face să refuze cu 22007. */
function dataOptionala(valoare: unknown, camp: string, eticheta: string): string | null {
  const text = textOptional(valoare)
  if (text === null) return null
  if (!TIPAR_DATA.test(text) || Number.isNaN(new Date(text).getTime())) {
    throw eroareValidare(`${eticheta} se scrie ca an-lună-zi (2025-03-14).`, camp)
  }
  return text
}

/** Enumerarea `metoda_plata`. Lipsă înseamnă „numerar”, ca DEFAULT-ul coloanei. */
function metodaCeruta(valoare: unknown): MetodaPlata {
  if (valoare === undefined || valoare === null || valoare === '') return 'numerar'
  if (!METODE_PLATA.includes(valoare as MetodaPlata)) {
    throw eroareValidare(
      `Metoda de plată poate fi doar una dintre: ${METODE_PLATA.join(', ')}.`,
      'metoda',
    )
  }
  return valoare as MetodaPlata
}

/** Enumerarea `stare_abonament`, așa cum vine din filtrul listei. */
function stareOptionala(valoare: unknown): StareAbonament | undefined {
  const text = textDin(valoare)
  if (text === undefined) return undefined
  if (!STARI_ABONAMENT.includes(text as StareAbonament)) {
    throw eroareValidare(`Starea poate fi doar una dintre: ${STARI_ABONAMENT.join(', ')}.`, 'stare')
  }
  return text as StareAbonament
}

/** De ce nu se mai poate consuma un abonament care nu este activ. */
const MOTIV_INACTIV: Record<StareAbonament, string> = {
  activ: '',
  epuizat: 'Abonamentul are deja toate ședințele consumate.',
  anulat: 'Abonamentul a fost anulat.',
  expirat: 'Abonamentul a expirat.',
}

// ---------------------------------------------------------------------------
// GET /abonamente — orice rol
// ---------------------------------------------------------------------------

/*
  Lista nu este paginată.

  Tabela este mică, iar singurul apelant de azi (pagina de test) citește un
  tablou simplu. În ziua în care abonamentele intră în interfață, aici se pun
  `paginareDin` și `impacheteaza`, ca în /clienti și /vanzari.
*/
router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  unde.egal('a.client_id', idOptional(req.query['client_id'], 'client_id', 'Clientul'))
  unde.egal('a.stare', stareOptionala(req.query['stare']))

  res.json(await multe<AbonamentDetaliu>(
    pool, `${DIN_ABONAMENTE} ${unde.where} ORDER BY a.creat_la DESC`, unde.values,
  ))
}))

// ---------------------------------------------------------------------------
// GET /abonamente/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await abonamentComplet(pool, idDinAdresa(req.params['id'])))
}))

// ---------------------------------------------------------------------------
// POST /abonamente — orice rol
// ---------------------------------------------------------------------------

/*
  Coloanele scrise sunt enumerate una câte una.

  Varianta cu `dynamicInsert(req.body)` scria orice coloană trimisă: un POST cu
  `sedinte_folosite: 0, suma_platita: 9999` inventa un abonament plătit care nu
  fusese. Contoarele și starea nu apar în listă tocmai fiindcă le ține triggerul.
*/
router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as CreateAbonamentRequest

  const client_id = idCerut(corp.client_id, 'client_id', 'Clientul')
  const articol_id = idCerut(corp.articol_id, 'articol_id', 'Serviciul')
  const punct_cerut = idOptional(corp.punct_lucru_id, 'punct_lucru_id', 'Punctul de lucru')
  const numar_sedinte = sedinteCerute(corp.numar_sedinte)
  const pret_total = sumaCeruta(corp.pret_total, 'pret_total', 'Prețul pachetului', false)
  const valabil_pana_la = dataOptionala(corp.valabil_pana_la, 'valabil_pana_la', 'Valabilitatea')
  const nota = textOptional(corp.nota)

  const abonament = await tranzactie(async (ex: Executor) => {
    /*
      Rândurile legate se caută înainte de inserare.

      Cheile străine ar refuza oricum, dar cu 23503, tradus în „înregistrarea
      este legată de altele” — un mesaj despre ștergeri, la crearea unui
      abonament. Căutate întâi, lipsa lor spune ce anume lipsește.
    */
    await unu(ex, `SELECT id FROM client WHERE id = $1`, [client_id], 'Clientul')
    await unu(ex, `SELECT id FROM articol WHERE id = $1`, [articol_id], 'Serviciul')

    // Clinica are un singur punct de lucru și interfața nu îl mai cere; la fel
    // ca la încasări, îl completează serverul când nu vine din cerere.
    const punct_lucru_id = punct_cerut
      ? (await unu<{ id: string }>(
          ex, `SELECT id FROM punct_lucru WHERE id = $1`, [punct_cerut], 'Punctul de lucru',
        )).id
      : await punctImplicit(ex)

    const { rows } = await ex.query<Abonament>(
      `INSERT INTO abonament
         (client_id, articol_id, punct_lucru_id, creat_de,
          numar_sedinte, pret_total, valabil_pana_la, nota)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [client_id, articol_id, punct_lucru_id, autor.id,
       numar_sedinte, pret_total, valabil_pana_la, nota],
    )
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'abonament',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    return abonamentDetaliu(ex, rand.id)
  })

  res.status(201).json(abonament)
}))

// ---------------------------------------------------------------------------
// POST /abonamente/:id/sedinta — orice rol. Stinge o ședință din pachet.
// ---------------------------------------------------------------------------

router.post('/:id/sedinta', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = idDinAdresa(req.params['id'])
  const corp = req.body as { programare_id?: unknown; nota?: unknown }
  const programare_id = idOptional(corp.programare_id, 'programare_id', 'Programarea')
  const nota = textOptional(corp.nota)

  const raspuns = await tranzactie(async (ex: Executor) => {
    /*
      Rândul de abonament se BLOCHEAZĂ înainte de a i se citi contorul.

      Fără `FOR UPDATE`, două cereri simultane citesc amândouă
      `sedinte_folosite = 0` pe un pachet de o ședință și scriu amândouă: nici
      constrângerea nu le prinde, fiindcă `abonament_sedinte_ck` stă pe rândul
      părinte și este alimentată de trigger, care apucă să numere abia după ce
      ambele inserări au trecut. Ambele cereri primeau 201, iar clientul plătea
      o ședință și consuma două. Cu blocarea, a doua cerere așteaptă commit-ul
      primei și citește contorul deja crescut. Este același tipar ca la
      /vanzari, unde a fost verificat sub cereri paralele.
    */
    const inainte = await unu<Abonament>(
      ex, `SELECT * FROM abonament WHERE id = $1 FOR UPDATE`, [id], 'Abonamentul',
    )

    if (inainte.stare !== 'activ') throw eroareConflict(MOTIV_INACTIV[inainte.stare])
    if (inainte.sedinte_folosite >= inainte.numar_sedinte) {
      throw eroareConflict('Abonamentul nu mai are ședințe disponibile.')
    }
    if (programare_id) {
      await unu(ex, `SELECT id FROM programare WHERE id = $1`, [programare_id], 'Programarea')
    }

    const { rows } = await ex.query<AbonamentSedinta>(
      `INSERT INTO abonament_sedinta (abonament_id, programare_id, inregistrat_de, nota)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, programare_id, autor.id, nota],
    )
    const sedinta = rows[0]!

    // Contorul a fost deja recalculat de trigger, în aceeași tranzacție.
    const dupa = await unu<Abonament>(
      ex, `SELECT * FROM abonament WHERE id = $1`, [id], 'Abonamentul',
    )

    /*
      Jurnalul se scrie pe ABONAMENT, nu pe rândul-copil.

      Cine caută peste șase luni „ce s-a întâmplat cu pachetul ăsta” cere
      `/jurnal?entitate=abonament&entitate_id=…` și trebuie să vadă acolo tot:
      cumpărarea, fiecare ședință stinsă și fiecare plată. Este aceeași alegere
      ca la /vanzari, unde liniile bonului se jurnalizează sub bon.
    */
    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'abonament',
      entitate_id: id,
      date_noi: {
        sedinta_id: sedinta.id,
        programare_id,
        sedinte_folosite: dupa.sedinte_folosite,
        numar_sedinte: dupa.numar_sedinte,
        stare: dupa.stare,
      },
      adresa_ip: adresaCererii(req),
    })

    // Ședința creată, plus abonamentul în noua lui stare: cine a marcat ședința
    // vrea să vadă imediat câte au mai rămas, fără încă o cerere.
    return { ...sedinta, abonament: await abonamentDetaliu(ex, id) }
  })

  res.status(201).json(raspuns)
}))

// ---------------------------------------------------------------------------
// POST /abonamente/:id/plata — orice rol. Înregistrează o rată.
// ---------------------------------------------------------------------------

router.post('/:id/plata', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = idDinAdresa(req.params['id'])
  const corp = req.body as CreatePlataRequest
  const suma = sumaCeruta(corp.suma, 'suma', 'Suma încasată', true)
  const metoda = metodaCeruta(corp.metoda)
  const nota = textOptional(corp.nota)

  const raspuns = await tranzactie(async (ex: Executor) => {
    // Aceeași blocare ca la ședințe, din același motiv: două rate trimise în
    // paralel citesc altfel același `suma_platita` și trec amândouă de plafon.
    const inainte = await unu<Abonament>(
      ex, `SELECT * FROM abonament WHERE id = $1 FOR UPDATE`, [id], 'Abonamentul',
    )

    // Un pachet epuizat sau expirat poate avea încă rate neachitate — datoria
    // nu dispare odată cu ședințele. Doar cel anulat nu mai are ce încasa.
    if (inainte.stare === 'anulat') throw eroareConflict(MOTIV_INACTIV.anulat)

    /*
      Plata nu poate depăși restul de plată.

      `suma_platita` este recalculată de trigger ca suma rândurilor din `plata`,
      iar abonamentul nu are unde ține un rest de dat înapoi. Fără plafon, o
      încasare de 5000 pe un pachet de 200 nu era „un bacșiș”, ci un rând care
      face din `pret_total - suma_platita` un număr negativ în orice raport de
      restanțe — bani care par încasați pentru ceva ce nu s-a vândut. Cine chiar
      plătește mai mult cumpără altceva, iar acel altceva se scrie pe încasarea
      lui, nu aici.
    */
    const rest = rotunjeste(inainte.pret_total - inainte.suma_platita)
    if (rest <= 0) throw eroareValidare('Abonamentul este achitat integral.', 'suma')
    if (suma > rest) {
      throw eroareValidare(
        `Suma depășește restul de plată: au mai rămas ${rest.toFixed(2)} lei.`,
        'suma',
      )
    }

    const { rows } = await ex.query<Plata>(
      `INSERT INTO plata (abonament_id, operator_id, suma, metoda, nota)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, autor.id, suma, metoda, nota],
    )
    const plata = rows[0]!

    const dupa = await unu<Abonament>(
      ex, `SELECT * FROM abonament WHERE id = $1`, [id], 'Abonamentul',
    )

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'abonament',
      entitate_id: id,
      date_noi: {
        plata_id: plata.id,
        suma: plata.suma,
        metoda: plata.metoda,
        suma_platita: dupa.suma_platita,
        pret_total: dupa.pret_total,
        rest_de_plata: rotunjeste(dupa.pret_total - dupa.suma_platita),
      },
      adresa_ip: adresaCererii(req),
    })

    return { ...plata, abonament: await abonamentDetaliu(ex, id) }
  })

  res.status(201).json(raspuns)
}))

export default router
