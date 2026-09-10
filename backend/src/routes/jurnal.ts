/**
 * /jurnal — urma operațiunilor. Doar administrator.
 *
 * Art. 3.1.D din contract cere „jurnal al operațiunilor asupra datelor, cu
 * utilizatorul și momentul efectuării”. Tabela este append-only: nu există aici
 * nici POST, nici PATCH, nici DELETE. Rândurile se scriu exclusiv din
 * tranzacțiile operațiunilor pe care le descriu.
 */

import { Router, Response } from 'express'
import pool, { multe } from '../lib/db.js'
import { ruta } from '../lib/erori.js'
import { Conditii, impacheteaza, listaDin, paginareDin, textDin } from '../lib/filtre.js'
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth.js'
import type { JurnalOperatiuneDetaliu } from '../types/database.js'

const router = Router()
router.use(requireAuth, requireRole('administrator'))

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  // Jurnalul se citește în pagini mai mari: rândurile sunt scurte, iar cine îl
  // deschide caută un tipar, nu o singură intrare.
  const p = paginareDin(req, 50)

  unde.deLa('j.creat_la', textDin(req.query['de_la']))
  unde.panaLa('j.creat_la', textDin(req.query['pana_la']))
  unde.egal('j.entitate', textDin(req.query['entitate']))
  unde.egal('j.entitate_id', textDin(req.query['entitate_id']))
  unde.egal('j.utilizator_id', textDin(req.query['utilizator_id']))
  unde.oricareDin('j.actiune::text', listaDin(req.query['actiune']))

  const doarFiltre = [...unde.values]
  const felie = `LIMIT ${unde.marcaj(p.pe_pagina)} OFFSET ${unde.marcaj(p.offset)}`

  const [randuri, numarate] = await Promise.all([
    multe<JurnalOperatiuneDetaliu>(
      pool,
      `SELECT j.*, u.nume AS utilizator_nume
       FROM jurnal_operatiuni j
       LEFT JOIN utilizator u ON u.id = j.utilizator_id
       ${unde.where}
       ORDER BY j.creat_la DESC, j.id DESC
       ${felie}`,
      unde.values,
    ),
    multe<{ total: number }>(
      pool,
      `SELECT count(*)::bigint AS total FROM jurnal_operatiuni j ${unde.where}`,
      doarFiltre,
    ),
  ])

  res.json(impacheteaza(randuri, numarate[0]?.total ?? 0, p))
}))

export default router
