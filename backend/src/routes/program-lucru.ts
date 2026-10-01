/**
 * /program-lucru — în ce zile lucrează fiecare persoană: pare sau impare, pe lună.
 *
 *   GET /program-lucru?de_la=AAAA-LL-ZZ&pana_la=AAAA-LL-ZZ — orice rol.
 *       Programele lunilor care ating intervalul (calendarul cere o săptămână
 *       care poate trece peste două luni).
 *   PUT /program-lucru — orice rol. { utilizator_id, luna, zile, zile_alese? }.
 *       `zile` = 'pare' | 'impare' pune sau înlocuiește programul lunii;
 *       `zile` = 'personalizat' cere și `zile_alese` (numerele zilelor lucrate);
 *       `zile` = null îl scoate (persoana rămâne fără program ales).
 *
 * Orice rol, nu doar administratorul: fiecare își știe zilele, iar la recepție
 * se lucrează și de pe contul obișnuit.
 */

import { Router, Response } from 'express'
import pool, { multe, tranzactie, unu, unuSauNimic, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { textDin } from '../lib/filtre.js'
import { adresaCererii, scrieJurnal } from '../lib/jurnal.js'
import { dataCeruta } from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type { ProgramLucru, ZileLucru } from '../types/database.js'

const router = Router()
router.use(requireAuth)

const DIN_PROGRAM = `SELECT pl.*, COALESCE(u.nume, '—') AS utilizator_nume
                     FROM program_lucru pl LEFT JOIN utilizator u ON u.id = pl.utilizator_id`

/** Luna cerută, ca ziua ei întâi: primește „2026-10” sau „2026-10-01”. */
function lunaCeruta(valoare: unknown): string {
  const text = typeof valoare === 'string' && /^\d{4}-\d{2}$/.test(valoare) ? `${valoare}-01` : valoare
  return `${dataCeruta(text, 'luna', 'Luna').slice(0, 7)}-01`
}

function zileCerute(valoare: unknown): ZileLucru | null {
  if (valoare === null || valoare === undefined || valoare === '') return null
  if (valoare !== 'pare' && valoare !== 'impare' && valoare !== 'personalizat') {
    throw eroareValidare('Alege zilele: pare, impare sau personalizat.', 'zile')
  }
  return valoare
}

/**
 * Zilele alese la programul personalizat: numere întregi din lună, fără
 * dubluri, în ordine. Lista goală e voie — luna întreagă liberă.
 */
function zileAleseCerute(valoare: unknown, luna: string): number[] {
  if (!Array.isArray(valoare)) throw eroareValidare('Alege zilele în care lucrează.', 'zile_alese')
  const [an, l] = luna.split('-').map(Number) as [number, number]
  const ultima = new Date(Date.UTC(an, l, 0)).getUTCDate()
  const zile = new Set<number>()
  for (const zi of valoare) {
    if (!Number.isInteger(zi) || zi < 1 || zi > ultima) {
      throw eroareValidare(`Zilele alese trebuie să fie între 1 și ${ultima}.`, 'zile_alese')
    }
    zile.add(zi as number)
  }
  return [...zile].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// GET /program-lucru
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const de_la = dataCeruta(textDin(req.query['de_la']), 'de_la', 'Începutul intervalului')
  const pana_la = dataCeruta(textDin(req.query['pana_la']), 'pana_la', 'Sfârșitul intervalului')

  res.json(await multe<ProgramLucru>(
    pool,
    `${DIN_PROGRAM}
     WHERE pl.luna BETWEEN date_trunc('month', $1::date)::date AND $2::date
     ORDER BY pl.luna, utilizator_nume`,
    [de_la, pana_la],
  ))
}))

// ---------------------------------------------------------------------------
// PUT /program-lucru
// ---------------------------------------------------------------------------

router.put('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = (req.body ?? {}) as Record<string, unknown>
  const utilizator_id = typeof corp['utilizator_id'] === 'string' ? corp['utilizator_id'] : ''
  if (!utilizator_id) throw eroareValidare('Alege persoana.', 'utilizator_id')
  const luna = lunaCeruta(corp['luna'])
  const zile = zileCerute(corp['zile'])
  const zile_alese = zile === 'personalizat' ? zileAleseCerute(corp['zile_alese'], luna) : null

  const rezultat = await tranzactie(async (ex: Executor) => {
    await unu(ex, `SELECT id FROM utilizator WHERE id = $1`, [utilizator_id], 'Persoana')
    const inainte = await unuSauNimic<ProgramLucru>(
      ex,
      `SELECT * FROM program_lucru WHERE utilizator_id = $1 AND luna = $2 FOR UPDATE`,
      [utilizator_id, luna],
    )

    if (zile === null) {
      if (!inainte) return null
      await ex.query(`DELETE FROM program_lucru WHERE id = $1`, [inainte.id])
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'stergere',
        entitate: 'program_lucru',
        entitate_id: inainte.id,
        date_vechi: { utilizator_id, luna, zile: inainte.zile, zile_alese: inainte.zile_alese },
        adresa_ip: adresaCererii(req),
      })
      return null
    }

    const { rows } = await ex.query<{ id: string }>(
      `INSERT INTO program_lucru (utilizator_id, luna, zile, zile_alese, creat_de)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (utilizator_id, luna)
       DO UPDATE SET zile = EXCLUDED.zile, zile_alese = EXCLUDED.zile_alese
       RETURNING id`,
      [utilizator_id, luna, zile, zile_alese, autor.id],
    )
    const id = rows[0]!.id

    const schimbat =
      inainte?.zile !== zile || JSON.stringify(inainte?.zile_alese ?? null) !== JSON.stringify(zile_alese)
    if (schimbat) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: inainte ? 'modificare' : 'creare',
        entitate: 'program_lucru',
        entitate_id: id,
        date_vechi: inainte ? { zile: inainte.zile, zile_alese: inainte.zile_alese } : null,
        date_noi: { utilizator_id, luna, zile, zile_alese },
        adresa_ip: adresaCererii(req),
      })
    }

    return unu<ProgramLucru>(ex, `${DIN_PROGRAM} WHERE pl.id = $1`, [id], 'Programul')
  })

  if (rezultat) res.json(rezultat)
  else res.status(204).end()
}))

export default router
