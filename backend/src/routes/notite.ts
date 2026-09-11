/**
 * /notite — însemnările din calendar care nu sunt programări.
 *
 * „Irina e în concediu”, „vine furnizorul la 15:00”. Au titlu, interval și,
 * opțional, o persoană; nu au client, serviciu sau preț. Trăiesc în tabela
 * lor tocmai ca recepția să nu mai inventeze un client „Concediu” și un
 * serviciu de zero lei ca să-și scrie ceva în agendă.
 *
 * Două lucruri le deosebesc de programări și sunt intenționate:
 *
 *   - NU blochează intervalul. O notiță peste o ședință nu e o greșeală, e
 *     informația pe care recepția vrea să o vadă acolo.
 *   - Se pot ȘTERGE. Nu e o ședință care a avut loc și nu mișcă bani; urma
 *     rămâne în jurnal.
 */

import { Router, Response } from 'express'
import pool, { alege, dynamicInsert, dynamicUpdate, multe, unu, tranzactie, type Executor } from '../lib/db.js'
import { ruta } from '../lib/erori.js'
import { Conditii, textDin } from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { executantulCerut } from '../lib/persoane.js'
import { ceruteText, momentCerut, textOptional, verificaIntervalProgramare } from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type { Notita, NotitaDetaliu } from '../types/database.js'

const router = Router()
router.use(requireAuth)

const CAMPURI = ['titlu', 'detalii', 'executant_id', 'incepe_la', 'se_termina_la'] as const

const DIN_NOTITE = 'SELECT * FROM v_notita_detaliu'

function notitaDetaliu(ex: Executor, id: string): Promise<NotitaDetaliu> {
  return unu<NotitaDetaliu>(ex, `${DIN_NOTITE} WHERE id = $1`, [id], 'Notița')
}

/**
 * Persoana notiței, dacă are una.
 *
 * `null` și lipsa sunt același lucru — „toată clinica”. Cu o persoană,
 * contul trebuie să existe și să fie activ, la fel ca la programări.
 */
async function executantOptional(ex: Executor, valoare: unknown): Promise<string | null> {
  const id = textDin(valoare)
  if (!id) return null
  return (await executantulCerut(ex, id)).id
}

// ---------------------------------------------------------------------------
// GET /notite — orice rol
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()

  // Intervalul se citește ca SUPRAPUNERE, exact ca la programări: o notiță
  // care traversează miezul nopții aparține și zilei în care se termină.
  const de_la = textDin(req.query['de_la'])
  const pana_la = textDin(req.query['pana_la'])
  if (de_la) unde.brut(`se_termina_la > ${unde.marcaj(de_la)}`)
  if (pana_la) unde.brut(`incepe_la < ${unde.marcaj(pana_la)}`)

  /*
    Filtrul pe persoană aduce și notițele întregii clinici.

    Întrebarea din calendar este „ce o privește pe Irina azi?”, iar „clinica e
    închisă de la 14” o privește. Fără regula asta, filtrarea pe o persoană ar
    ascunde exact însemnările care sunt pentru toți.
  */
  const executant_id = textDin(req.query['executant_id'])
  if (executant_id) {
    unde.brut(`(executant_id = ${unde.marcaj(executant_id)} OR executant_id IS NULL)`)
  }

  res.json(await multe<NotitaDetaliu>(pool, `${DIN_NOTITE} ${unde.where} ORDER BY incepe_la`, unde.values))
}))

// ---------------------------------------------------------------------------
// GET /notite/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await notitaDetaliu(pool, req.params['id']!))
}))

// ---------------------------------------------------------------------------
// POST /notite — orice rol
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>

  const notita = await tranzactie(async (ex: Executor) => {
    const titlu = ceruteText(corp['titlu'], 'titlu', 'Titlul')
    const executant_id = await executantOptional(ex, corp['executant_id'])
    const incepe_la = momentCerut(corp['incepe_la'], 'incepe_la', 'Ora de început')
    const se_termina_la = momentCerut(corp['se_termina_la'], 'se_termina_la', 'Ora de sfârșit')
    verificaIntervalProgramare(incepe_la, se_termina_la)

    const q = dynamicInsert('notita', {
      titlu,
      detalii: textOptional(corp['detalii'], 'detalii', 'Detaliile'),
      executant_id,
      incepe_la,
      se_termina_la,
      creat_de: autor.id,
    })
    const { rows } = await ex.query<Notita>(q.text, q.values)
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'notita',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    return notitaDetaliu(ex, rand.id)
  })

  res.status(201).json(notita)
}))

// ---------------------------------------------------------------------------
// PATCH /notite/:id — orice rol
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>

  const notita = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Notita>(
      ex, `SELECT * FROM notita WHERE id = $1 FOR UPDATE`, [id], 'Notița',
    )

    const date = alege(corp, CAMPURI)

    if (date['titlu'] !== undefined) date['titlu'] = ceruteText(date['titlu'], 'titlu', 'Titlul')
    if (date['detalii'] !== undefined) {
      date['detalii'] = textOptional(date['detalii'], 'detalii', 'Detaliile')
    }
    // `null` explicit mută notița pe toată clinica; lipsa câmpului o lasă cum e.
    if (Object.hasOwn(corp, 'executant_id')) {
      date['executant_id'] = await executantOptional(ex, corp['executant_id'])
    }
    if (date['incepe_la'] !== undefined) {
      date['incepe_la'] = momentCerut(date['incepe_la'], 'incepe_la', 'Ora de început')
    }
    if (date['se_termina_la'] !== undefined) {
      date['se_termina_la'] = momentCerut(date['se_termina_la'], 'se_termina_la', 'Ora de sfârșit')
    }

    // Momentele din bază sunt `Date`, nu text — vezi observația din /programari.
    const caText = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))
    verificaIntervalProgramare(
      caText(date['incepe_la'] ?? inainte.incepe_la),
      caText(date['se_termina_la'] ?? inainte.se_termina_la),
    )

    const q = dynamicUpdate('notita', date, 'id', id)
    const { rows } = await ex.query<Notita>(q.text, q.values)
    const dupa = rows[0]!

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'notita',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }

    return notitaDetaliu(ex, id)
  })

  res.json(notita)
}))

// ---------------------------------------------------------------------------
// DELETE /notite/:id — orice rol
// ---------------------------------------------------------------------------

router.delete('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!

  await tranzactie(async (ex: Executor) => {
    const rand = await unu<Notita>(ex, `SELECT * FROM notita WHERE id = $1 FOR UPDATE`, [id], 'Notița')

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'stergere',
      entitate: 'notita',
      entitate_id: id,
      date_vechi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    await ex.query(`DELETE FROM notita WHERE id = $1`, [id])
  })

  res.status(204).end()
}))

export default router
