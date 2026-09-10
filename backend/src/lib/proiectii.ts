/**
 * Formele compuse pe care le întoarce API-ul.
 *
 * Interfața nu cere niciodată „programarea” goală: îi trebuie, în același
 * răspuns, numele clientului, denumirea serviciului și dacă ședința a fost
 * achitată. JOIN-urile stau în vederile din `sql/01_schema.sql`; aici sunt
 * funcțiile prin care le citesc rutele.
 *
 * Toate rutele care întorc o programare trec prin `programareDetaliu` /
 * `programariDetaliu`, iar cele care întorc o încasare prin
 * `vanzareDetaliu` / `vanzariDetaliu`. Așa, `POST /programari` și
 * `GET /programari/:id` nu pot ajunge să răspundă cu forme diferite pentru
 * același rând — greșeala pe care o face orice server unde fiecare rută își
 * scrie propriul SELECT.
 */

import { multe, unu, type Executor } from './db.js'
import { sumaTotal } from './bani.js'
import type {
  ProgramareDetaliu,
  VanzareDetaliu,
  VanzareLinieDetaliu,
} from '../types/database.js'

// ---------------------------------------------------------------------------
// Programări
// ---------------------------------------------------------------------------

export const DIN_PROGRAMARI = 'SELECT * FROM v_programare_detaliu'

export function programariDetaliu(
  ex: Executor,
  where = '',
  values: unknown[] = [],
  ordine = 'ORDER BY incepe_la',
): Promise<ProgramareDetaliu[]> {
  return multe<ProgramareDetaliu>(ex, `${DIN_PROGRAMARI} ${where} ${ordine}`, values)
}

export function programareDetaliu(ex: Executor, id: string): Promise<ProgramareDetaliu> {
  return unu<ProgramareDetaliu>(ex, `${DIN_PROGRAMARI} WHERE id = $1`, [id], 'Programarea')
}

// ---------------------------------------------------------------------------
// Încasări
// ---------------------------------------------------------------------------

export const DIN_VANZARI = 'SELECT * FROM v_vanzare_detaliu'

/**
 * Aduce liniile pentru un set întreg de încasări, cu o singură interogare.
 *
 * Cerute pe rând, o listă de cincizeci de bonuri ar face cincizeci și una de
 * interogări. Aduse în bloc și împărțite pe antet, fac două — indiferent câte
 * bonuri sunt.
 *
 * Totalul se adună aici, nu în SQL: aceeași funcție de rotunjire ca a
 * interfeței, deci totalul afișat pe ecran și cel calculat de server nu au cum
 * să difere cu un ban.
 */
export async function atasaLinii(
  ex: Executor,
  antete: VanzareDetaliu[],
): Promise<VanzareDetaliu[]> {
  if (antete.length === 0) return antete

  const linii = await multe<VanzareLinieDetaliu>(
    ex,
    `SELECT * FROM v_vanzare_linie_detaliu WHERE vanzare_id = ANY($1) ORDER BY programare_id NULLS LAST, id`,
    [antete.map((v) => v.id)],
  )

  const peVanzare = new Map<string, VanzareLinieDetaliu[]>()
  for (const linie of linii) {
    const grup = peVanzare.get(linie.vanzare_id)
    if (grup) grup.push(linie)
    else peVanzare.set(linie.vanzare_id, [linie])
  }

  for (const antet of antete) {
    antet.linii = peVanzare.get(antet.id) ?? []
    antet.total = sumaTotal(antet.linii.map((l) => l.total_linie))
  }
  return antete
}

export async function vanzariDetaliu(
  ex: Executor,
  where = '',
  values: unknown[] = [],
  ordine = 'ORDER BY efectuat_la DESC',
): Promise<VanzareDetaliu[]> {
  const antete = await multe<VanzareDetaliu>(ex, `${DIN_VANZARI} ${where} ${ordine}`, values)
  return atasaLinii(ex, antete)
}

export async function vanzareDetaliu(ex: Executor, id: string): Promise<VanzareDetaliu> {
  const antet = await unu<VanzareDetaliu>(ex, `${DIN_VANZARI} WHERE id = $1`, [id], 'Vânzarea')
  const [cuLinii] = await atasaLinii(ex, [antet])
  return cuLinii!
}

// ---------------------------------------------------------------------------
// Clienți
// ---------------------------------------------------------------------------

export const DIN_CLIENTI = 'SELECT * FROM v_client_detaliu'

// ---------------------------------------------------------------------------
// Punctul de lucru implicit
// ---------------------------------------------------------------------------

/**
 * Punctul de lucru pe care îl completează serverul.
 *
 * Clinica are o singură locație și interfața nu o mai cere în niciun formular.
 * Se preferă unul activ; dacă niciunul nu este, oricare — o clinică al cărei
 * punct a fost dezactivat din greșeală trebuie să poată lucra mai departe, nu
 * să primească eroare la fiecare programare.
 */
export async function punctImplicit(ex: Executor): Promise<string> {
  const rand = await unu<{ id: string }>(
    ex,
    `SELECT id FROM punct_lucru ORDER BY activ DESC, creat_la LIMIT 1`,
    [],
    'Punctul de lucru',
  )
  return rand.id
}
