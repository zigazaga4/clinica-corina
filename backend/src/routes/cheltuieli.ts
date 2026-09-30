/**
 * /cheltuieli — banii ieșiți, în spatele parolei statisticilor.
 *
 * Profitul din Statistici este încasat minus cheltuit; rândurile de aici sunt
 * a doua jumătate. Toate rutele cer deblocarea statisticilor: cine nu are voie
 * să vadă profitul nu are voie să vadă nici chiria și salariile din care se
 * scade.
 *
 * Se pot ȘTERGE — o cheltuială scrisă de două ori ar strica profitul fiecărei
 * luni în care apare. Urma rămâne în jurnal, cu tot rândul.
 */

import { Router, Response } from 'express'
import pool, { alege, dynamicInsert, dynamicUpdate, multe, tranzactie, unu, unuSauNimic, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { Conditii, impacheteaza, paginareDin, textDin, tiparLike } from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { ceruteText, dataCeruta, textOptional, verificaSumaPozitiva } from '../lib/validare.js'
import { cereAccesStatistici } from '../middleware/acces-statistici.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type { Cheltuiala, CheltuialaDetaliu } from '../types/database.js'

const router = Router()
router.use(requireAuth, cereAccesStatistici)

const CAMPURI = ['data', 'categorie', 'descriere', 'suma'] as const

const DIN_CHELTUIELI = 'SELECT * FROM v_cheltuiala_detaliu'

function cheltuialaDetaliu(ex: Executor, id: string): Promise<CheltuialaDetaliu> {
  return unu<CheltuialaDetaliu>(ex, `${DIN_CHELTUIELI} WHERE id = $1`, [id], 'Cheltuiala')
}

/**
 * Categoria, scrisă ca data trecută.
 *
 * „chirie” și „Chirie” ar fi fost două felii în graficul cheltuielilor, iar
 * suma chiriei s-ar fi citit pe jumătate. Dacă există deja o categorie care
 * diferă doar prin majuscule, se folosește aceea.
 */
async function categoriaCeruta(ex: Executor, valoare: unknown): Promise<string> {
  const categorie = ceruteText(valoare, 'categorie', 'Categoria')
  const existenta = await unuSauNimic<{ categorie: string }>(
    ex,
    `SELECT categorie FROM cheltuiala WHERE lower(categorie) = lower($1)
     ORDER BY creat_la LIMIT 1`,
    [categorie],
  )
  return existenta?.categorie ?? categorie
}

// ---------------------------------------------------------------------------
// GET /cheltuieli — listă paginată, cu suma întregului filtru
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const p = paginareDin(req)

  const de_la = textDin(req.query['de_la'])
  const pana_la = textDin(req.query['pana_la'])
  if (de_la) unde.brut(`data >= ${unde.marcaj(dataCeruta(de_la, 'de_la', 'Începutul perioadei'))}`)
  if (pana_la) unde.brut(`data <= ${unde.marcaj(dataCeruta(pana_la, 'pana_la', 'Sfârșitul perioadei'))}`)
  unde.egal('categorie', textDin(req.query['categorie']))

  const q = textDin(req.query['q'])
  if (q) {
    const tipar = unde.marcaj(`%${tiparLike(q)}%`)
    // `unaccent`, ca la celelalte căutări: „utilitati” găsește „Utilități”.
    unde.brut(
      `(unaccent(categorie) ILIKE unaccent(${tipar}) OR unaccent(COALESCE(descriere, '')) ILIKE unaccent(${tipar}))`,
    )
  }

  const doarFiltre = [...unde.values]
  const felie = `LIMIT ${unde.marcaj(p.pe_pagina)} OFFSET ${unde.marcaj(p.offset)}`

  const [randuri, rezumat] = await Promise.all([
    multe<CheltuialaDetaliu>(
      pool,
      `${DIN_CHELTUIELI} ${unde.where} ORDER BY data DESC, creat_la DESC, id ${felie}`,
      unde.values,
    ),
    multe<{ total: number; suma: number }>(
      pool,
      `SELECT count(*)::bigint AS total, COALESCE(sum(suma), 0) AS suma
       FROM cheltuiala ${unde.where}`,
      doarFiltre,
    ),
  ])

  res.json({
    ...impacheteaza(randuri, rezumat[0]?.total ?? 0, p),
    suma: rezumat[0]?.suma ?? 0,
  })
}))

// ---------------------------------------------------------------------------
// GET /cheltuieli/categorii — cele folosite deja, cele mai folosite întâi
//
// Înaintea lui `/:id`, ca „categorii” să nu fie citit ca identificator.
// ---------------------------------------------------------------------------

router.get('/categorii', ruta(async (_req: AuthRequest, res: Response) => {
  const randuri = await multe<{ categorie: string }>(
    pool,
    `SELECT categorie FROM cheltuiala GROUP BY categorie
     ORDER BY count(*) DESC, categorie`,
  )
  res.json(randuri.map((r) => r.categorie))
}))

// ---------------------------------------------------------------------------
// GET /cheltuieli/:id
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await cheltuialaDetaliu(pool, req.params['id']!))
}))

// ---------------------------------------------------------------------------
// POST /cheltuieli
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = (req.body ?? {}) as Record<string, unknown>

  const cheltuiala = await tranzactie(async (ex: Executor) => {
    const q = dynamicInsert('cheltuiala', {
      data: dataCeruta(corp['data'], 'data', 'Data'),
      categorie: await categoriaCeruta(ex, corp['categorie']),
      descriere: textOptional(corp['descriere'], 'descriere', 'Descrierea'),
      suma: verificaSumaPozitiva(corp['suma'], 'suma', 'Suma'),
      creat_de: autor.id,
    })
    const { rows } = await ex.query<Cheltuiala>(q.text, q.values)
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'cheltuiala',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    return cheltuialaDetaliu(ex, rand.id)
  })

  res.status(201).json(cheltuiala)
}))

// ---------------------------------------------------------------------------
// PATCH /cheltuieli/:id
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = (req.body ?? {}) as Record<string, unknown>

  const cheltuiala = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Cheltuiala>(
      ex, `SELECT * FROM cheltuiala WHERE id = $1 FOR UPDATE`, [id], 'Cheltuiala',
    )

    const date = alege(corp, CAMPURI)
    if (date['data'] !== undefined) date['data'] = dataCeruta(date['data'], 'data', 'Data')
    if (date['categorie'] !== undefined) date['categorie'] = await categoriaCeruta(ex, date['categorie'])
    if (Object.hasOwn(corp, 'descriere')) {
      date['descriere'] = textOptional(corp['descriere'], 'descriere', 'Descrierea')
    }
    if (date['suma'] !== undefined) date['suma'] = verificaSumaPozitiva(date['suma'], 'suma', 'Suma')

    if (Object.keys(date).length === 0) {
      throw eroareValidare('Nu ai trimis niciun câmp de modificat.')
    }

    const q = dynamicUpdate('cheltuiala', date, 'id', id)
    const { rows } = await ex.query<Cheltuiala>(q.text, q.values)
    const dupa = rows[0]!

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'cheltuiala',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }

    return cheltuialaDetaliu(ex, id)
  })

  res.json(cheltuiala)
}))

// ---------------------------------------------------------------------------
// DELETE /cheltuieli/:id
// ---------------------------------------------------------------------------

router.delete('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!

  await tranzactie(async (ex: Executor) => {
    const rand = await unu<Cheltuiala>(
      ex, `SELECT * FROM cheltuiala WHERE id = $1 FOR UPDATE`, [id], 'Cheltuiala',
    )

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'stergere',
      entitate: 'cheltuiala',
      entitate_id: id,
      date_vechi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    await ex.query(`DELETE FROM cheltuiala WHERE id = $1`, [id])
  })

  res.status(204).end()
}))

export default router
