/**
 * Jurnalul operațiunilor — §3, tabela `jurnal_operatiuni`.
 *
 * Contractul cere la art. 3.1.D „jurnal al operațiunilor asupra datelor, cu
 * utilizatorul și momentul efectuării”, iar specificația precizează că jurnalul
 * este append-only: fără UPDATE, fără DELETE.
 *
 * Scrierea se face în ACEEAȘI tranzacție cu operațiunea jurnalizată. Altfel ar
 * exista drumuri prin care o modificare reușește iar urma ei se pierde — exact
 * rândurile pe care le caută cineva peste șase luni, când întreabă cine a
 * schimbat prețul.
 */

import type { Request } from 'express'
import pool, { type Executor } from './db.js'

export type ActiuneJurnal =
  | 'creare'
  | 'modificare'
  | 'stergere'
  | 'arhivare'
  | 'autentificare'

export interface IntrareJurnal {
  utilizator_id: string | null
  actiune: ActiuneJurnal
  /** Numele tabelei afectate, exact ca în bază: 'client', 'programare', … */
  entitate: string
  entitate_id?: string | null
  date_vechi?: Record<string, unknown> | null
  date_noi?: Record<string, unknown> | null
  adresa_ip?: string | null
}

export async function scrieJurnal(ex: Executor, intrare: IntrareJurnal): Promise<void> {
  await ex.query(
    `INSERT INTO jurnal_operatiuni
       (utilizator_id, actiune, entitate, entitate_id, date_vechi, date_noi, adresa_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      intrare.utilizator_id,
      intrare.actiune,
      intrare.entitate,
      intrare.entitate_id ?? null,
      intrare.date_vechi ?? null,
      intrare.date_noi ?? null,
      intrare.adresa_ip ?? null,
    ],
  )
}

/** Varianta în afara unei tranzacții, pentru operațiuni dintr-o singură scriere. */
export const scrieJurnalDirect = (intrare: IntrareJurnal) => scrieJurnal(pool, intrare)

/**
 * Adresa de la care s-a operat.
 *
 * `inet` refuză un șir gol, iar în spatele unui reverse proxy `req.ip` este
 * adresa proxy-ului; `x-forwarded-for` poartă adevăratul apelant, primul din
 * listă. Ce nu se poate afla rămâne NULL — o adresă inventată ar face jurnalul
 * să pară mai credibil decât este.
 */
export function adresaCererii(req: Request): string | null {
  const inaintat = req.headers['x-forwarded-for']
  const brut = Array.isArray(inaintat) ? inaintat[0] : inaintat
  const adresa = (brut?.split(',')[0] ?? req.ip ?? '').trim()
  if (!adresa) return null
  // Express dă adresele IPv4 în formă mapată IPv6; `inet` le acceptă pe ambele,
  // dar `::ffff:127.0.0.1` este mai greu de citit decât `127.0.0.1`.
  return adresa.startsWith('::ffff:') ? adresa.slice(7) : adresa
}

// ---------------------------------------------------------------------------
// Ce anume s-a schimbat
// ---------------------------------------------------------------------------

const IGNORATE = new Set(['actualizat_la'])

/**
 * Reține DOAR câmpurile modificate, așa cum cere specificația pentru
 * `date_vechi` / `date_noi`.
 *
 * Un jurnal care copiază rândul întreg la fiecare salvare devine imposibil de
 * citit: cine caută „cine a schimbat telefonul clientului” ar trebui să compare
 * manual două obiecte de cincisprezece câmpuri. `actualizat_la` se exclude — se
 * schimbă la orice UPDATE și nu spune nimic.
 */
export function diferenta(
  inainte: Record<string, unknown>,
  dupa: Record<string, unknown>,
): { date_vechi: Record<string, unknown>; date_noi: Record<string, unknown> } | null {
  const date_vechi: Record<string, unknown> = {}
  const date_noi: Record<string, unknown> = {}
  let modificari = 0

  for (const cheie of Object.keys(dupa)) {
    if (IGNORATE.has(cheie)) continue
    if (egale(inainte[cheie], dupa[cheie])) continue
    date_vechi[cheie] = inainte[cheie] ?? null
    date_noi[cheie] = dupa[cheie] ?? null
    modificari++
  }

  return modificari > 0 ? { date_vechi, date_noi } : null
}

/**
 * Comparație suficientă pentru ce iese dintr-un rând de bază.
 *
 * `Date` intră pe ramura de obiecte: două momente egale sunt instanțe diferite,
 * iar `===` le-ar declara mereu schimbate — fiecare salvare ar umple jurnalul
 * cu „a modificat data” pe rânduri neatinse.
 */
function egale(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  // numeric ajunge uneori text, alteori număr, în funcție de calea de scriere.
  return String(a) === String(b)
}

/** Instantaneu al unui rând proaspăt creat, pentru `date_noi`. */
export function instantaneu(rand: Record<string, unknown>): Record<string, unknown> {
  const { actualizat_la: _ignorat, ...restul } = rand
  return restul
}
