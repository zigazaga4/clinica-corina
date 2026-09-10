import { Router, Response } from 'express'
import pool, { alege, dynamicInsert } from '../lib/db.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { CreateAbonamentRequest, CreatePlataRequest } from '../types/database.js'

const router = Router()
router.use(requireAuth)

/*
  Câmpurile pe care le acceptă fiecare scriere.

  Fără liste, `dynamicInsert('abonament', req.body)` scrie orice coloană
  trimisă: un POST cu `sedinte_folosite: 0, suma_platita: 9999` inventează un
  abonament plătit care nu a fost. Contoarele sunt ținute de triggerele din
  `sql/01_schema.sql` și nu se scriu niciodată din cerere.
*/
const CAMPURI_ABONAMENT = [
  'client_id', 'articol_id', 'punct_lucru_id', 'numar_sedinte',
  'pret_total', 'valabil_pana_la', 'nota',
] as const

const CAMPURI_PLATA = ['suma', 'metoda', 'nota'] as const

// GET /abonamente?client_id=&stare=activ
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const conditions = ['1=1']
    const values: unknown[] = []

    if (req.query.client_id) { values.push(req.query.client_id); conditions.push(`a.client_id = $${values.length}`) }
    if (req.query.stare) { values.push(req.query.stare); conditions.push(`a.stare = $${values.length}`) }

    const { rows } = await pool.query(`
      SELECT a.id, a.numar_sedinte, a.sedinte_folosite, a.pret_total, a.suma_platita,
             a.stare, a.valabil_pana_la, a.creat_la,
        json_build_object('id', cl.id, 'nume', cl.nume, 'prenume', cl.prenume, 'telefon', cl.telefon) AS client,
        json_build_object('id', ar.id, 'denumire', ar.denumire) AS articol
      FROM abonament a
      LEFT JOIN client cl ON cl.id = a.client_id
      LEFT JOIN articol ar ON ar.id = a.articol_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.creat_la DESC
    `, values)

    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// GET /abonamente/:id
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*,
        json_build_object('id', cl.id, 'nume', cl.nume, 'prenume', cl.prenume, 'telefon', cl.telefon) AS client,
        json_build_object('id', ar.id, 'denumire', ar.denumire) AS articol,
        COALESCE((SELECT json_agg(s) FROM abonament_sedinta s WHERE s.abonament_id = a.id), '[]'::json) AS abonament_sedinta,
        COALESCE((SELECT json_agg(p) FROM plata p WHERE p.abonament_id = a.id), '[]'::json) AS plata
      FROM abonament a
      LEFT JOIN client cl ON cl.id = a.client_id
      LEFT JOIN articol ar ON ar.id = a.articol_id
      WHERE a.id = $1
    `, [req.params.id])

    if (!rows[0]) { res.status(404).json({ error: 'Abonament not found' }); return }
    res.json(rows[0])
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /abonamente
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateAbonamentRequest
    const required = ['client_id', 'articol_id', 'punct_lucru_id', 'numar_sedinte', 'pret_total']
    const missing = required.filter(f => !body[f as keyof CreateAbonamentRequest])
    if (missing.length) { res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` }); return }

    const q = dynamicInsert('abonament', {
      ...alege(body as unknown as Record<string, unknown>, CAMPURI_ABONAMENT),
      creat_de: req.user!.sub,
    })
    const { rows } = await pool.query(q.text, q.values)
    res.status(201).json(rows[0])
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /abonamente/:id/sedinta — mark one session as used
router.post('/:id/sedinta', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { programare_id, nota } = req.body

    const { rows: abRows } = await pool.query(
      `SELECT stare, sedinte_folosite, numar_sedinte FROM abonament WHERE id = $1`,
      [req.params.id]
    )
    const ab = abRows[0]

    if (!ab || ab.stare !== 'activ') {
      res.status(400).json({ error: 'Subscription is not active' }); return
    }
    if (ab.sedinte_folosite >= ab.numar_sedinte) {
      res.status(400).json({ error: 'All sessions already used' }); return
    }

    const { rows } = await pool.query(
      `INSERT INTO abonament_sedinta (abonament_id, programare_id, inregistrat_de, nota)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, programare_id || null, req.user!.sub, nota || null]
    )
    res.status(201).json(rows[0])
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /abonamente/:id/plata — register a partial payment
router.post('/:id/plata', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as CreatePlataRequest
    if (!body.suma || body.suma <= 0) {
      res.status(400).json({ error: 'suma must be a positive number' }); return
    }

    const q = dynamicInsert('plata', {
      ...alege(body as unknown as Record<string, unknown>, CAMPURI_PLATA),
      abonament_id: req.params.id,
      operator_id: req.user!.sub,
    })
    const { rows } = await pool.query(q.text, q.values)
    res.status(201).json(rows[0])
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
