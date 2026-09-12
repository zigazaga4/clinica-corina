/**
 * /tratamente — serviciile făcute în mai multe ședințe, per client.
 *
 * Ecranul „Tratamente” răspunde la „unde a ajuns fiecare client cu ce a
 * cumpărat”: câte ședințe s-au făcut din câte, cât s-a încasat din cât, când e
 * următoarea. Toate se numără din programări (`v_tratament_detaliu`); rândul
 * de tratament ține doar înțelegerea de la început.
 *
 * Ședințele NU se scriu pe aici. Se fac prin `POST /programari`, ca oricare
 * alta, iar serverul le pune singur în tratamentul în curs al clientului.
 * Rutele de mai jos deschid, corectează și încheie înțelegerea.
 */

import { Router, Response } from 'express'
import pool, { multe, unu, tranzactie, type Executor } from '../lib/db.js'
import { eroareConflict, eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii, impacheteaza, paginareDin, textDin, tiparLike } from '../lib/filtre.js'
import { adresaCererii, diferenta, scrieJurnal } from '../lib/jurnal.js'
import {
  DIN_TRATAMENTE,
  deschideTratament,
  tratamentDetaliu,
  tratamentInCurs,
} from '../lib/tratamente.js'
import { textOptional, verificaNumarSedinte, verificaPret } from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type { Articol, Tratament, TratamentDetaliu } from '../types/database.js'

const router = Router()
router.use(requireAuth)

// ---------------------------------------------------------------------------
// GET /tratamente — orice rol
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const p = paginareDin(req)

  unde.egal('client_id', textDin(req.query['client_id']))
  unde.egal('articol_id', textDin(req.query['articol_id']))

  // `in_curs=true` = neîncheiate; `false` = încheiate; lipsă = toate.
  const in_curs = boolDin(req.query['in_curs'])
  if (in_curs === true) unde.brut('incheiat_la IS NULL')
  if (in_curs === false) unde.brut('incheiat_la IS NOT NULL')

  const q = textDin(req.query['q'])
  if (q) {
    const tipar = unde.marcaj(`%${tiparLike(q)}%`)
    unde.brut(`(unaccent(client_nume) ILIKE unaccent(${tipar}) OR unaccent(articol_denumire) ILIKE unaccent(${tipar}))`)
  }

  /*
    Cele în curs întâi, iar între ele cele fără nicio ședință programată:
    acelea sunt clienții pe care recepția trebuie să-i sune. Apoi, după cât de
    curând vine următoarea. `id` la urmă ține paginarea stabilă.
  */
  const ordine = `ORDER BY (incheiat_la IS NOT NULL), urmatoarea_la ASC NULLS FIRST, creat_la DESC, id`

  const doarFiltre = [...unde.values]
  const felie = `LIMIT ${unde.marcaj(p.pe_pagina)} OFFSET ${unde.marcaj(p.offset)}`

  const [randuri, numarate] = await Promise.all([
    multe<TratamentDetaliu>(pool, `${DIN_TRATAMENTE} ${unde.where} ${ordine} ${felie}`, unde.values),
    multe<{ total: number }>(pool, `SELECT count(*)::bigint AS total FROM v_tratament_detaliu ${unde.where}`, doarFiltre),
  ])

  res.json(impacheteaza(randuri, numarate[0]?.total ?? 0, p))
}))

// ---------------------------------------------------------------------------
// GET /tratamente/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await tratamentDetaliu(pool, req.params['id']!))
}))

// ---------------------------------------------------------------------------
// POST /tratamente — orice rol
// ---------------------------------------------------------------------------

/**
 * Deschide un tratament fără nicio ședință încă — clientul a cumpărat pachetul
 * și programează pe rând. Drumul obișnuit rămâne prima programare, care îl
 * deschide singură; aici e pentru cine vrea să-l vadă în listă de pe acum.
 */
router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>

  const tratament = await tranzactie(async (ex: Executor) => {
    const clientul = await unu<{ id: string; arhivat_la: Date | null }>(
      ex, `SELECT id, arhivat_la FROM client WHERE id = $1`, [corp['client_id']], 'Clientul',
    )
    if (clientul.arhivat_la !== null) {
      throw eroareValidare('Clientul este arhivat; dezarhivează-l înainte.', 'client_id')
    }
    const articol = await unu<Articol>(
      ex, `SELECT * FROM articol WHERE id = $1`, [corp['articol_id']], 'Serviciul',
    )

    const rand = await deschideTratament(ex, {
      client_id: clientul.id,
      articol,
      numar_sedinte: corp['numar_sedinte'],
      pret_total: corp['pret_total'],
      nota: corp['nota'],
      autor_id: autor.id,
      adresa_ip: adresaCererii(req),
    })
    return tratamentDetaliu(ex, rand.id)
  })

  res.status(201).json(tratament)
}))

// ---------------------------------------------------------------------------
// PATCH /tratamente/:id — orice rol
// ---------------------------------------------------------------------------

/**
 * Corectează înțelegerea: mai multe (sau mai puține) ședințe, alt preț total,
 * o notă. Numărul nu poate coborî sub ședințele deja programate sau făcute —
 * acelea există și ocupă locul lor.
 */
router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>

  const tratament = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Tratament>(
      ex, `SELECT * FROM tratament WHERE id = $1 FOR UPDATE`, [id], 'Tratamentul',
    )
    const detaliu = await tratamentDetaliu(ex, id)

    const date: Record<string, unknown> = {}
    if (corp['numar_sedinte'] !== undefined) {
      const n = verificaNumarSedinte(corp['numar_sedinte'])
      const ocupate = detaliu.sedinte_programate + detaliu.sedinte_onorate
      if (n < ocupate) {
        throw eroareValidare(
          `Tratamentul are deja ${ocupate} ședințe programate sau făcute; numărul nu poate fi mai mic.`,
          'numar_sedinte',
        )
      }
      date['numar_sedinte'] = n
    }
    if (corp['pret_total'] !== undefined) {
      date['pret_total'] = verificaPret(Number(corp['pret_total']), 'pret_total')
    }
    if (corp['nota'] !== undefined) date['nota'] = textOptional(corp['nota'], 'nota', 'Nota')

    if (Object.keys(date).length === 0) return detaliu

    const coloane = Object.keys(date)
    const { rows } = await ex.query<Tratament>(
      `UPDATE tratament SET ${coloane.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...coloane.map((c) => date[c])],
    )
    const dupa = rows[0]!

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'tratament',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }

    return tratamentDetaliu(ex, id)
  })

  res.json(tratament)
}))

// ---------------------------------------------------------------------------
// POST /tratamente/:id/incheiere și /redeschidere — orice rol
// ---------------------------------------------------------------------------

/**
 * Încheierea și redeschiderea sunt aceeași operațiune cu semn schimbat, ca
 * arhivarea fișei. Încheiat de mână = clientul a renunțat; ședințele făcute și
 * banii rămân exact unde erau. Redeschiderea cade pe 409 dacă între timp s-a
 * deschis alt tratament în curs pentru aceeași pereche.
 */
function comutaIncheierea(incheie: boolean) {
  return ruta(async (req: AuthRequest, res: Response) => {
    const autor = cont(req)
    const id = req.params['id']!

    const tratament = await tranzactie(async (ex: Executor) => {
      const inainte = await unu<Tratament>(
        ex, `SELECT * FROM tratament WHERE id = $1 FOR UPDATE`, [id], 'Tratamentul',
      )
      const deja = incheie ? inainte.incheiat_la !== null : inainte.incheiat_la === null
      if (deja) return tratamentDetaliu(ex, id)

      if (!incheie) {
        const altul = await tratamentInCurs(ex, inainte.client_id, inainte.articol_id)
        if (altul) {
          throw eroareConflict(
            'Clientul are între timp alt tratament în curs pentru acest serviciu; încheie-l pe acela întâi.',
            { detalii: { tratament_id: altul.id } },
          )
        }
      }

      const { rows } = await ex.query<Tratament>(
        `UPDATE tratament SET incheiat_la = ${incheie ? 'now()' : 'NULL'} WHERE id = $1 RETURNING *`,
        [id],
      )

      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'tratament',
        entitate_id: id,
        date_vechi: { incheiat_la: inainte.incheiat_la },
        date_noi: { incheiat_la: rows[0]!.incheiat_la },
        adresa_ip: adresaCererii(req),
      })

      return tratamentDetaliu(ex, id)
    })

    res.json(tratament)
  })
}

router.post('/:id/incheiere', comutaIncheierea(true))
router.post('/:id/redeschidere', comutaIncheierea(false))

export default router
