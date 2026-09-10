/**
 * Depozitul de token-uri.
 *
 * Este partajat de ambele implementări ale contractului: cea în memorie
 * validează token-urile pe care le-a emis, cea HTTP le pune în antetul
 * `Authorization`. Fiind un singur loc, ecranul de autentificare nu trebuie să
 * știe pe care implementare rulează.
 *
 * Token-urile se păstrează în `localStorage` pentru ca reîncărcarea ferestrei
 * — inevitabilă în dezvoltare, posibilă în Tauri la repornirea aplicației — să
 * nu ceară reautentificare. Pe server, `sesiune.expira_la` rămâne autoritatea
 * finală: un token păstrat local, dar expirat, este oricum respins.
 */

import type { Timestamptz } from '@/domain/types'

const CHEIE = 'clinica.sesiune'

export interface TokenuriSesiune {
  access_token: string
  refresh_token: string
  expira_la: Timestamptz
}

let inMemorie: TokenuriSesiune | null = null

/** localStorage lipsește în teste (jsdom îl are, dar nu în worker-ele Node). */
function depozit(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function citesteTokenuri(): TokenuriSesiune | null {
  if (inMemorie) return inMemorie
  const brut = depozit()?.getItem(CHEIE)
  if (!brut) return null
  try {
    inMemorie = JSON.parse(brut) as TokenuriSesiune
    return inMemorie
  } catch {
    // Conținut corupt sau dintr-o versiune veche a formatului.
    depozit()?.removeItem(CHEIE)
    return null
  }
}

export function scrieTokenuri(tokenuri: TokenuriSesiune): void {
  inMemorie = tokenuri
  depozit()?.setItem(CHEIE, JSON.stringify(tokenuri))
}

export function stergeTokenuri(): void {
  inMemorie = null
  depozit()?.removeItem(CHEIE)
}

/** A expirat access token-ul? Cu o marjă, ca să-l reînnoim înainte de eșec. */
export function aExpirat(tokenuri: TokenuriSesiune, marjaSecunde = 30): boolean {
  const expira = new Date(tokenuri.expira_la).getTime()
  return Number.isFinite(expira) && expira - marjaSecunde * 1000 <= Date.now()
}

/** Identifică dispozitivul în `sesiune.dispozitiv` — „platformă + versiune”. */
export function descriereDispozitiv(): string {
  const versiune = '0.1.0'
  if (typeof navigator === 'undefined') return `necunoscut / ${versiune}`
  const ua = navigator.userAgent
  const platforma = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'necunoscut'
  return `${platforma} / ${versiune}`
}
