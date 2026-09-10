import { Router, Response } from 'express'
import pool from '../lib/db.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/utilizatori-ref', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nume, rol FROM utilizator WHERE activ = true ORDER BY nume`
    )
    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/puncte-lucru-ref', async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await pool.query(
      `SELECT id, denumire FROM punct_lucru ORDER BY denumire`
    )
    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
