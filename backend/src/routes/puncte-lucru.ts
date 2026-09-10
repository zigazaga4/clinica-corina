/**
 * /puncte-lucru — locațiile clinicii.
 *
 * Clinica are una singură, iar interfața nu o mai cere în niciun formular:
 * serverul completează punctul implicit. Rutele există fiindcă §7 le prevede și
 * pentru ziua în care se deschide al doilea punct — atunci se reafișează
 * selectorul, fără migrare de bază.
 */

import { Router, Response } from 'express'
import pool, { alege, multe, tranzactie, unu, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii } from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { ceruteText, textOptional } from '../lib/validare.js'
import { requireAuth, requireRole, AuthRequest, cont } from '../middleware/auth.js'
import type { PunctLucru } from '../types/database.js'

const router = Router()
router.use(requireAuth)

const CAMPURI = ['denumire', 'adresa', 'telefon', 'activ'] as const

function pregateste(corp: Record<string, unknown>, laCreare: boolean): Record<string, unknown> {
  const date = alege(corp, CAMPURI)

  if (laCreare || date['denumire'] !== undefined) {
    date['denumire'] = ceruteText(date['denumire'], 'denumire', 'Denumirea')
  }
  for (const camp of ['adresa', 'telefon'] as const) {
    if (date[camp] !== undefined) date[camp] = textOptional(date[camp])
  }
  if (date['activ'] !== undefined) date['activ'] = Boolean(date['activ'])

  return date
}

/** GET /puncte-lucru — orice rol */
router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const activ = boolDin(req.query['activ'])
  if (activ !== undefined) unde.egal('activ', activ)

  res.json(await multe<PunctLucru>(
    pool, `SELECT * FROM punct_lucru ${unde.where} ORDER BY denumire`, unde.values,
  ))
}))

/** POST /puncte-lucru — doar administrator */
router.post('/', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const date = pregateste(req.body as Record<string, unknown>, true)

  const punct = await tranzactie(async (ex: Executor) => {
    // Unicitatea denumirii o decide constrângerea `punct_lucru_denumire_key`,
    // tradusă în 409 de `dinEroarePostgres`.
    const { rows } = await ex.query<PunctLucru>(
      `INSERT INTO punct_lucru (denumire, adresa, telefon, activ)
       VALUES ($1, $2, $3, COALESCE($4, true)) RETURNING *`,
      [date['denumire'], date['adresa'] ?? null, date['telefon'] ?? null, date['activ'] ?? null],
    )
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'punct_lucru',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })
    return rand
  })

  res.status(201).json(punct)
}))

/** PATCH /puncte-lucru/:id — doar administrator */
router.patch('/:id', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const date = pregateste(req.body as Record<string, unknown>, false)

  const coloane = Object.keys(date)
  if (coloane.length === 0) throw eroareValidare('Nu ai trimis niciun câmp de modificat.')

  const punct = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<PunctLucru>(
      ex, `SELECT * FROM punct_lucru WHERE id = $1 FOR UPDATE`, [id], 'Punctul de lucru',
    )

    const { rows } = await ex.query<PunctLucru>(
      `UPDATE punct_lucru SET ${coloane.map((c, i) => `"${c}" = $${i + 1}`).join(', ')}
       WHERE id = $${coloane.length + 1} RETURNING *`,
      [...coloane.map((c) => date[c]), id],
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
        entitate: 'punct_lucru',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }
    return dupa
  })

  res.json(punct)
}))

export default router
