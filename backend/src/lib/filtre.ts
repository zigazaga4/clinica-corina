/**
 * Construcția clauzelor WHERE și a paginării.
 *
 * Fiecare listă din API filtrează pe alte coloane, dar toate o fac la fel:
 * adaugă o condiție dacă parametrul a venit, sar peste el dacă lipsește, și
 * numără cu grijă `$1, $2, $3`. Scris de mână în fiecare rută, tiparul acela a
 * produs deja patru copii aproape identice, fiecare cu propriul `values.length`
 * de ținut minte.
 *
 * Aici se scrie o dată. Ruta spune ce filtrează, nu cum se numerotează.
 */

import type { Request } from 'express'
import { eroareValidare } from './erori.js'

export class Conditii {
  private readonly parti: string[] = []
  private readonly valori: unknown[] = []

  /** Adaugă valoarea și întoarce marcajul ei — `$3`, `$4`, … */
  marcaj(valoare: unknown): string {
    this.valori.push(valoare)
    return `$${this.valori.length}`
  }

  /** Condiție scrisă de mână, cu marcajele deja obținute din `marcaj`. */
  brut(sql: string): this {
    this.parti.push(sql)
    return this
  }

  /** `coloana = valoare`, sărită dacă valoarea lipsește. */
  egal(coloana: string, valoare: unknown): this {
    if (valoare === undefined || valoare === null || valoare === '') return this
    return this.brut(`${coloana} = ${this.marcaj(valoare)}`)
  }

  /** `coloana = ANY(valori)`, sărită dacă lista e goală. */
  oricareDin(coloana: string, valori: readonly unknown[] | undefined): this {
    if (!valori || valori.length === 0) return this
    return this.brut(`${coloana} = ANY(${this.marcaj(valori)})`)
  }

  /** `coloana >= de_la`, sărită dacă lipsește. */
  deLa(coloana: string, moment: unknown): this {
    if (!moment) return this
    return this.brut(`${coloana} >= ${this.marcaj(moment)}`)
  }

  /** `coloana <= pana_la`, sărită dacă lipsește. */
  panaLa(coloana: string, moment: unknown): this {
    if (!moment) return this
    return this.brut(`${coloana} <= ${this.marcaj(moment)}`)
  }

  /** `WHERE …`, sau șirul gol când nu s-a filtrat nimic. */
  get where(): string {
    return this.parti.length ? `WHERE ${this.parti.join(' AND ')}` : ''
  }

  get values(): unknown[] {
    return this.valori
  }
}

// ---------------------------------------------------------------------------
// Parametri din query string
// ---------------------------------------------------------------------------

/** Un parametru care poate sosi o dată sau repetat: `?stare=a&stare=b`. */
export function listaDin(valoare: unknown): string[] | undefined {
  if (valoare === undefined || valoare === null) return undefined
  const brute = Array.isArray(valoare) ? valoare : [valoare]
  const curate = brute.filter((v): v is string => typeof v === 'string' && v !== '')
  return curate.length ? curate : undefined
}

export function textDin(valoare: unknown): string | undefined {
  return typeof valoare === 'string' && valoare.trim() !== '' ? valoare.trim() : undefined
}

/**
 * Textul căutat, cu metacaracterele LIKE făcute inofensive.
 *
 * `%` și `_` nu sunt litere pentru LIKE/ILIKE, ci „orice” și „un caracter
 * oarecare”: căutarea unui singur `%` întorcea toată tabela, paginată frumos,
 * ca și cum aceea ar fi fost lista căutată. Cine tastează `%` caută semnul
 * procent — de pildă într-o denumire de reducere — și trebuie să primească
 * rândurile care îl conțin, sau niciunul.
 *
 * Caracterul de evadare este backslash-ul, adică exact cel implicit al lui
 * LIKE; de aceea tiparul nu are nevoie de clauză `ESCAPE`.
 */
export function tiparLike(text: string): string {
  return text.replace(/[\\%_]/g, (semn) => `\\${semn}`)
}

/** `?activ=true` — absent înseamnă „fără filtru”, nu „false”. */
export function boolDin(valoare: unknown): boolean | undefined {
  if (valoare === 'true') return true
  if (valoare === 'false') return false
  return undefined
}

// ---------------------------------------------------------------------------
// Paginare
// ---------------------------------------------------------------------------

export interface Paginare {
  pagina: number
  pe_pagina: number
  offset: number
}

/**
 * Cea mai mare pagină pe care o servim.
 *
 * Nu de dragul unei limite, ci pentru că `OFFSET` este `bigint`: la o pagină de
 * ordinul 10^18 înmulțirea depășea tipul, iar baza răspundea `22003` — adică
 * 500 pe un număr scris greșit în bara de adrese. Un milion de pagini a câte
 * 200 de rânduri înseamnă 200 de milioane de rânduri, mai mult decât va avea
 * vreodată clinica.
 */
const PAGINA_MAXIMA = 1_000_000

/**
 * Un întreg din query string, sau o eroare care spune care parametru e de vină.
 *
 * `parseInt` citește prefixul și tace: din `1e3` scotea 1, din
 * `9007199254740993` un număr apropiat, dar altul. Amândouă întorceau altă
 * pagină decât cea cerută, fără ca cineva să afle. Aici se cere numărul întreg,
 * întreg — restul este cerere greșită.
 */
function intregDin(
  valoare: unknown,
  camp: string,
  eticheta: string,
  implicit: number,
): number {
  if (valoare === undefined || valoare === null) return implicit
  const text = String(Array.isArray(valoare) ? valoare[0] : valoare).trim()
  if (text === '') return implicit

  const n = Number(text)
  if (!Number.isInteger(n)) {
    throw eroareValidare(`${eticheta} trebuie să fie un număr întreg.`, camp)
  }
  return n
}

/**
 * Pagina cerută, cu limitele puse la loc sigur.
 *
 * Acceptă și `page`/`limit`: interfața trimite numele din contract, dar pagina
 * de test livrată cu serverul folosește perechea englezească, și nu are rost să
 * o stric pentru un alias.
 */
export function paginareDin(req: Request, pe_pagina_implicit = 25): Paginare {
  const q = req.query
  const numeleFolosit = (contract: string, alias: string) =>
    q[contract] !== undefined ? contract : alias

  const campPagina = numeleFolosit('pagina', 'page')
  const pagina = Math.max(1, intregDin(q[campPagina], campPagina, 'Pagina', 1))
  if (pagina > PAGINA_MAXIMA) {
    throw eroareValidare('Pagina cerută este prea mare.', campPagina)
  }

  const campPePagina = numeleFolosit('pe_pagina', 'limit')
  const cerute = intregDin(
    q[campPePagina],
    campPePagina,
    'Numărul de rezultate pe pagină',
    pe_pagina_implicit,
  )
  // Plafonul apără serverul de un `?pe_pagina=999999` care ar cere toată baza.
  const pe_pagina = Math.min(200, Math.max(1, cerute))

  return { pagina, pe_pagina, offset: (pagina - 1) * pe_pagina }
}

/** Anvelopa paginată din contract. */
export interface Paginat<T> {
  randuri: T[]
  total: number
  pagina: number
  pe_pagina: number
}

export function impacheteaza<T>(randuri: T[], total: number, p: Paginare): Paginat<T> {
  return { randuri, total, pagina: p.pagina, pe_pagina: p.pe_pagina }
}
