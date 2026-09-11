/**
 * Tabelele în memorie.
 *
 * Structura reproduce §3 din specificația tehnică, inclusiv coloanele pe care
 * API-ul nu le expune niciodată (`parola_hash`, `sesiune.token_hash`). Motivul:
 * dacă magazinul ar ține doar ce se vede, implementarea în memorie ar accepta
 * fluxuri pe care baza reală le respinge, iar interfața ar fi construită pe o
 * minciună comodă.
 *
 * Cheile sunt Map-uri după `id` — căutarea după cheie primară este O(1), iar
 * scanările cu filtru parcurg valorile, exact ca un seq scan.
 */

import type {
  Articol,
  Client,
  Consimtamant,
  JurnalOperatiune,
  NotaClient,
  Notita,
  Programare,
  PunctLucru,
  Utilizator,
  Uuid,
  Vanzare,
  VanzareLinie,
} from '@/domain/types'

/** `utilizator`, cu coloana de parolă pe care API-ul nu o întoarce niciodată. */
export interface RandUtilizator extends Utilizator {
  /**
   * În producție: amprentă Argon2id (§9). Aici păstrăm parola în clar, pentru
   * ca datele demo să fie utilizabile — nu există server care să verifice, iar
   * o amprentă falsă ar da doar impresia de securitate.
   */
  parola_hash: string
}

/** `sesiune` — refresh tokens active. */
export interface RandSesiune {
  id: Uuid
  utilizator_id: Uuid
  token_hash: string
  emisa_la: string
  expira_la: string
  revocata_la: string | null
  dispozitiv: string | null
}

/**
 * `consimtamant`, cu PDF-ul pe care API-ul nu îl întoarce în liste.
 *
 * Ca la `utilizator`: coloana grea stă în magazin, fiindcă stă și în bază.
 * Dacă ar lipsi de aici, ruta `/:id/document` nu ar avea ce sluji în modul de
 * demonstrație, iar butonul „Vezi acordul” ar fi părut stricat.
 */
export interface RandConsimtamant extends Consimtamant {
  document: Uint8Array
}

export interface Magazin {
  utilizator: Map<Uuid, RandUtilizator>
  punct_lucru: Map<Uuid, PunctLucru>
  articol: Map<Uuid, Articol>
  client: Map<Uuid, Client>
  nota_client: Map<Uuid, NotaClient>
  consimtamant: Map<Uuid, RandConsimtamant>
  programare: Map<Uuid, Programare>
  notita: Map<Uuid, Notita>
  vanzare: Map<Uuid, Vanzare>
  vanzare_linie: Map<Uuid, VanzareLinie>
  sesiune: Map<Uuid, RandSesiune>
  jurnal_operatiuni: JurnalOperatiune[]
  /** Echivalentul secvenței `bigserial` a jurnalului. */
  urmatorId_jurnal: number
}

function magazinGol(): Magazin {
  return {
    utilizator: new Map(),
    punct_lucru: new Map(),
    articol: new Map(),
    client: new Map(),
    nota_client: new Map(),
    consimtamant: new Map(),
    programare: new Map(),
    notita: new Map(),
    vanzare: new Map(),
    vanzare_linie: new Map(),
    sesiune: new Map(),
    jurnal_operatiuni: [],
    urmatorId_jurnal: 1,
  }
}

export const magazin: Magazin = magazinGol()

/** Golește toate tabelele. Folosit de teste și de resetarea datelor demo. */
export function goleste(): void {
  const proaspat = magazinGol()
  for (const cheie of Object.keys(proaspat) as (keyof Magazin)[]) {
    // Reatribuire pe obiectul existent: referințele deja importate rămân valide.
    ;(magazin as unknown as Record<string, unknown>)[cheie] = proaspat[cheie]
  }
}

// ---------------------------------------------------------------------------
// Generator pseudo-aleator determinist
// ---------------------------------------------------------------------------

/**
 * mulberry32 — mic, rapid, și mai ales REPRODUCTIBIL.
 *
 * Datele demo trebuie să arate identic la fiecare pornire: altfel o captură de
 * ecran trimisă Beneficiarului nu mai corespunde cu ce vede el pe ecran, iar
 * un test care depinde de al treilea client din listă devine intermitent.
 */
export function generator(samanta: number): () => number {
  let a = samanta >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Element aleator dintr-o listă nevidă. */
export function alege<T>(rnd: () => number, lista: readonly T[]): T {
  return lista[Math.floor(rnd() * lista.length)] as T
}

/** Întreg în intervalul [min, max], ambele capete incluse. */
export function intreg(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1))
}

/** Adevărat cu probabilitatea dată. */
export function sansa(rnd: () => number, probabilitate: number): boolean {
  return rnd() < probabilitate
}
