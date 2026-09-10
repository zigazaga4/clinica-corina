/**
 * Listele scurte de referință, pentru selectoarele din formulare.
 *
 * Rutele stau la rădăcină, nu sub un prefix, fiindcă așa le cere pagina de test
 * livrată cu serverul: `/utilizatori-ref` și `/puncte-lucru-ref`. Numele cu
 * sufix le ține totuși departe de `/utilizatori` și `/puncte-lucru`, care sunt
 * altceva — rutele de administrare, cu drepturi și forme proprii.
 *
 * Întorc strict ce încape într-un `<option>`: identificatorul și eticheta. Fișa
 * întreagă a unui cont se citește din /utilizatori, care cere rol de
 * administrator; enumerate aici, `email`-ul sau `ultima_autentificare` ar
 * ocoli exact acea verificare.
 */

import { Router, Response } from 'express'
import pool, { multe } from '../lib/db.js'
import { ruta } from '../lib/erori.js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import type { RolUtilizator } from '../types/database.js'

const router = Router()
router.use(requireAuth)

interface UtilizatorRef {
  id: string
  nume: string
  rol: RolUtilizator
}

interface PunctLucruRef {
  id: string
  denumire: string
  activ: boolean
}

/** GET /utilizatori-ref — orice rol. Executanții care se pot alege la o programare. */
router.get('/utilizatori-ref', ruta(async (_req: AuthRequest, res: Response) => {
  // Doar conturile active: un coleg plecat nu mai are ce căuta în lista de
  // executanți, deși rămâne pe programările lui vechi.
  res.json(await multe<UtilizatorRef>(
    pool, `SELECT id, nume, rol FROM utilizator WHERE activ = true ORDER BY nume`,
  ))
}))

/** GET /puncte-lucru-ref — orice rol. */
router.get('/puncte-lucru-ref', ruta(async (_req: AuthRequest, res: Response) => {
  /*
    Punctele dezactivate rămân în listă, dar la coadă și marcate ca atare.

    Scoase de tot, un punct dezactivat din greșeală ar face imposibilă orice
    programare pe el, inclusiv corectarea uneia vechi; nemarcat, apelantul care
    ia primul element din listă — cum face pagina de test — ar putea alege
    tocmai locația închisă. Aceeași ordonare ca a lui `punctImplicit`.
  */
  res.json(await multe<PunctLucruRef>(
    pool, `SELECT id, denumire, activ FROM punct_lucru ORDER BY activ DESC, denumire`,
  ))
}))

export default router
