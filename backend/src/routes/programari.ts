/**
 * /programari — calendarul.
 *
 * Ședința poartă propriul preț, copiat la creare din ce a plătit ultima dată
 * acest client pentru acest serviciu. „Prețul reținut” nu este o tabelă
 * separată, ci chiar istoricul: o tabelă în plus ar fi trebuit ținută în
 * sincron cu programările și ar fi putut rămâne în urmă.
 */

import { Router, Response } from 'express'
import pool, { alege, dynamicInsert, dynamicUpdate, multe, unu, tranzactie, unuSauNimic, type Executor } from '../lib/db.js'
import { eroareConflict, eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii, listaDin, textDin } from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { inregistreazaIncasare } from '../lib/incasari.js'
import { programareDetaliu, programariDetaliu, punctImplicit } from '../lib/proiectii.js'
import {
  momentCerut,
  numarCerut,
  textOptional,
  verificaIntervalProgramare,
  verificaPret,
  verificaStare,
} from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type { Articol, Programare, Utilizator } from '../types/database.js'

const router = Router()
router.use(requireAuth)

const CAMPURI = [
  'client_id', 'articol_id', 'executant_id', 'punct_lucru_id',
  'incepe_la', 'se_termina_la', 'pret', 'nota',
] as const

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

async function executantulCerut(ex: Executor, executant_id: unknown): Promise<Utilizator> {
  const executant = await unu<Utilizator>(
    ex, `SELECT * FROM utilizator WHERE id = $1`, [executant_id], 'Executantul',
  )
  if (!executant.activ) {
    throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
  }
  return executant
}

/**
 * CONSTRAINT programare_fara_suprapunere, verificată din timp.
 *
 * Baza refuză oricum suprapunerea, dar cu un `23P01` care nu spune cine este
 * ocupat și când. Aici se află numele persoanei și programarea vinovată, adică
 * exact ce trebuie scris pe ecran ca operatoarea să poată alege altă oră.
 * Constrângerea rămâne plasa de siguranță pentru cursa dintre două verificări
 * simultane.
 */
async function verificaSuprapunere(
  ex: Executor,
  p: { executant_id: string; incepe_la: string; se_termina_la: string; stare?: string },
  exceptaId?: string,
): Promise<void> {
  // Programările anulate sunt în afara constrângerii — locul se eliberează.
  if (p.stare === 'anulat') return

  const ciocnire = await unuSauNimic<{ id: string; incepe_la: string; nume: string }>(
    ex,
    `SELECT pr.id, pr.incepe_la, COALESCE(u.nume, 'Persoana selectată') AS nume
     FROM programare pr
     LEFT JOIN utilizator u ON u.id = pr.executant_id
     WHERE pr.executant_id = $1
       AND pr.stare <> 'anulat'
       AND ($4::uuid IS NULL OR pr.id <> $4)
       AND tstzrange(pr.incepe_la, pr.se_termina_la) && tstzrange($2, $3)
     LIMIT 1`,
    [p.executant_id, p.incepe_la, p.se_termina_la, exceptaId ?? null],
  )

  if (ciocnire) {
    throw eroareConflict(
      `${ciocnire.nume} are deja o programare care se suprapune cu acest interval.`,
      { camp: 'incepe_la', detalii: { programare_id: ciocnire.id } },
    )
  }
}

/**
 * Prețul cu care se deschide formularul pentru un client și un serviciu.
 *
 * Ultima ședință a clientului la acel serviciu dictează. Ședințele anulate nu
 * spun nimic despre ce plătește omul, deci nu se numără.
 */
async function pretPentru(ex: Executor, client_id: string, articol: Articol) {
  const ultima = await unuSauNimic<{ pret: number }>(
    ex,
    `SELECT pret FROM programare
     WHERE client_id = $1 AND articol_id = $2 AND stare <> 'anulat'
     ORDER BY incepe_la DESC LIMIT 1`,
    [client_id, articol.id],
  )

  const pret_lista = Number(articol.pret_lista)
  if (!ultima || Number(ultima.pret) === pret_lista) {
    return { pret: pret_lista, din_istoric: false, pret_lista }
  }
  return { pret: Number(ultima.pret), din_istoric: true, pret_lista }
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
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>

  const programare = await tranzactie(async (ex: Executor) => {
    const client_id = (await unu<{ id: string }>(
      ex, `SELECT id FROM client WHERE id = $1`, [corp['client_id']], 'Clientul',
    )).id
    const articol = await serviciulCerut(ex, corp['articol_id'])
    const executant = await executantulCerut(ex, corp['executant_id'])

    const incepe_la = momentCerut(corp['incepe_la'], 'incepe_la', 'Ora de început')
    const se_termina_la = momentCerut(corp['se_termina_la'], 'se_termina_la', 'Ora de sfârșit')
    verificaIntervalProgramare(incepe_la, se_termina_la)
    await verificaSuprapunere(ex, { executant_id: executant.id, incepe_la, se_termina_la })

    // Punctul de lucru nu mai apare în niciun formular: clinica are unul singur.
    const punct_lucru_id = textDin(corp['punct_lucru_id']) ?? (await punctImplicit(ex))

    // Prețul lipsă se completează din memoria clientului, nu direct din
    // nomenclator: dacă i s-a mai făcut acest serviciu la un preț anume, acela
    // este prețul lui.
    const pret = corp['pret'] === undefined || corp['pret'] === null
      ? (await pretPentru(ex, client_id, articol)).pret
      : verificaPret(numarCerut(corp['pret'], 'pret', 'Prețul'), 'pret')

    const q = dynamicInsert('programare', {
      client_id,
      articol_id: articol.id,
      articol_tip: 'serviciu',
      executant_id: executant.id,
      punct_lucru_id,
      incepe_la,
      se_termina_la,
      pret,
      nota: textOptional(corp['nota']),
      creat_de: autor.id,
    })
    const { rows } = await ex.query<Programare>(q.text, q.values)
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'programare',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    return programareDetaliu(ex, rand.id)
  })

  res.status(201).json(programare)
}))

// ---------------------------------------------------------------------------
// PATCH /programari/:id — orice rol. Modifică sau reprogramează.
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>

  const programare = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Programare & { achitata: boolean }>(
      ex,
      `SELECT p.*, EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id) AS achitata
       FROM programare p WHERE p.id = $1 FOR UPDATE OF p`,
      [id], 'Programarea',
    )

    const date = alege(corp, CAMPURI)

    if (date['client_id'] !== undefined) {
      await unu(ex, `SELECT id FROM client WHERE id = $1`, [date['client_id']], 'Clientul')
    }
    if (date['articol_id'] !== undefined) await serviciulCerut(ex, date['articol_id'])
    if (date['executant_id'] !== undefined) await executantulCerut(ex, date['executant_id'])
    if (date['punct_lucru_id'] !== undefined) {
      await unu(ex, `SELECT id FROM punct_lucru WHERE id = $1`,
        [date['punct_lucru_id']], 'Punctul de lucru')
    }
    if (date['incepe_la'] !== undefined) {
      date['incepe_la'] = momentCerut(date['incepe_la'], 'incepe_la', 'Ora de început')
    }
    if (date['se_termina_la'] !== undefined) {
      date['se_termina_la'] = momentCerut(date['se_termina_la'], 'se_termina_la', 'Ora de sfârșit')
    }
    if (date['nota'] !== undefined) date['nota'] = textOptional(date['nota'])

    if (date['pret'] !== undefined) {
      // Prețul unei ședințe deja încasate nu se mai atinge: ar rămâne diferit
      // de suma chiar plătită, iar bonul nu se rescrie.
      if (inainte.achitata) {
        throw eroareValidare(
          'Ședința este deja încasată; prețul ei nu se mai poate schimba.', 'pret',
        )
      }
      date['pret'] = verificaPret(numarCerut(date['pret'], 'pret', 'Prețul'), 'pret')
    }

    const dupaIncepe = String(date['incepe_la'] ?? inainte.incepe_la)
    const dupaTermina = String(date['se_termina_la'] ?? inainte.se_termina_la)
    verificaIntervalProgramare(dupaIncepe, dupaTermina)
    // Se exclude pe sine: altfel o reprogramare cu cinci minute mai târziu s-ar
    // suprapune cu propria variantă veche.
    await verificaSuprapunere(ex, {
      executant_id: String(date['executant_id'] ?? inainte.executant_id),
      incepe_la: dupaIncepe,
      se_termina_la: dupaTermina,
      stare: inainte.stare,
    }, id)

    const q = dynamicUpdate('programare', date, 'id', id)
    const { rows } = await ex.query<Programare>(q.text, q.values)
    const dupa = rows[0]!

    const { achitata: _ignorat, ...vechi } = inainte
    const dif = diferenta(
      vechi as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'programare',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }

    return programareDetaliu(ex, id)
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
 */
router.patch('/:id/stare', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as { stare?: unknown; achitat?: unknown }
  const stare = verificaStare(corp.stare)

  const programare = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Programare & { achitata: boolean }>(
      ex,
      `SELECT p.*, EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id) AS achitata
       FROM programare p WHERE p.id = $1 FOR UPDATE OF p`,
      [id], 'Programarea',
    )

    if (inainte.stare !== stare) {
      // Reactivarea unei programări anulate o readuce sub constrângerea de
      // suprapunere — între timp, locul putea fi ocupat de altcineva.
      if (inainte.stare === 'anulat') {
        await verificaSuprapunere(ex, { ...inainte, stare }, id)
      }

      await ex.query(`UPDATE programare SET stare = $1 WHERE id = $2`, [stare, id])
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'programare',
        entitate_id: id,
        date_vechi: { stare: inainte.stare },
        date_noi: { stare },
        adresa_ip: adresaCererii(req),
      })
    }

    if (corp.achitat === true && stare === 'onorat' && !inainte.achitata) {
      await inregistreazaIncasare(ex, {
        autor_id: autor.id,
        client_id: inainte.client_id,
        programari: [inainte],
        produse: [],
        // Momentul plății este sfârșitul ședinței, nu ora la care s-a apăsat
        // butonul: bifa se pune adesea la câteva ore după, iar raportul zilei
        // ar arăta atunci banii într-o zi în care nu au intrat.
        efectuat_la: inainte.se_termina_la,
        adresa_ip: adresaCererii(req),
      })
    }

    return programareDetaliu(ex, id)
  })

  res.json(programare)
}))

export default router
