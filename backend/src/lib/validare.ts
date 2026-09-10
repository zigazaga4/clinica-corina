/**
 * Verificările făcute înainte de a atinge baza.
 *
 * Constrângerile din `sql/01_schema.sql` sunt plasa de siguranță și rămân
 * ultimul cuvânt. Ele nu știu însă să spună de ce au refuzat: un `23514` pe
 * `articol_durata_ck` ajunge la recepție ca „date invalide”, fără să lămurească
 * pe nimeni. Verificate întâi aici, aceleași reguli întorc mesajul care spune
 * ce anume trebuie schimbat, și pe ce câmp.
 *
 * Regulile sunt aceleași cu cele reproduse în implementarea din memorie a
 * aplicației: ce trece de formular trebuie să treacă și pe server.
 */

import { eroareValidare } from './erori.js'
import type { TipArticol } from '../types/database.js'

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** NOT NULL pe o coloană text înseamnă, în formular, „nu poate fi gol”. */
export function ceruteText(
  valoare: unknown,
  camp: string,
  eticheta: string,
): string {
  const text = typeof valoare === 'string' ? valoare.trim() : ''
  if (text === '') throw eroareValidare(`${eticheta} este obligatoriu.`, camp)
  return text
}

/** Normalizează un text opțional: șirul gol devine NULL, ca în bază. */
export function textOptional(valoare: unknown): string | null {
  const text = typeof valoare === 'string' ? valoare.trim() : ''
  return text === '' ? null : text
}

// ---------------------------------------------------------------------------
// Numere
// ---------------------------------------------------------------------------

/** Un număr trimis prin JSON, refuzând textul care doar seamănă a număr. */
export function numarCerut(valoare: unknown, camp: string, eticheta: string): number {
  const n = typeof valoare === 'number' ? valoare : Number(valoare)
  if (!Number.isFinite(n)) throw eroareValidare(`${eticheta} trebuie să fie un număr.`, camp)
  return n
}

/** CHECK (pret >= 0) */
export function verificaPret(pret: number, camp = 'pret_lista'): number {
  if (!Number.isFinite(pret) || pret < 0) {
    throw eroareValidare('Prețul nu poate fi negativ.', camp)
  }
  return pret
}

/** CHECK (cantitate > 0) */
export function verificaCantitate(cantitate: number): number {
  if (!Number.isFinite(cantitate) || cantitate <= 0) {
    throw eroareValidare('Cantitatea trebuie să fie mai mare ca zero.', 'cantitate')
  }
  return cantitate
}

// ---------------------------------------------------------------------------
// utilizator
// ---------------------------------------------------------------------------

export function verificaFormatEmail(email: string): string {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw eroareValidare('Adresa de e-mail nu are un format valid.', 'email')
  }
  return email.trim()
}

/** Regula minimă de parolă, aplicată înainte de Argon2id. */
export function verificaParola(parola: unknown): string {
  if (typeof parola !== 'string' || parola.length < 8) {
    throw eroareValidare('Parola trebuie să aibă cel puțin 8 caractere.', 'parola')
  }
  return parola
}

// ---------------------------------------------------------------------------
// articol
// ---------------------------------------------------------------------------

export function verificaTipArticol(valoare: unknown): TipArticol {
  if (valoare !== 'serviciu' && valoare !== 'produs') {
    throw eroareValidare('Tipul articolului poate fi doar „serviciu” sau „produs”.', 'tip')
  }
  return valoare
}

/**
 * CONSTRAINT articol_durata_ck:
 *   (tip = 'serviciu' AND durata_minute IS NOT NULL AND durata_minute > 0)
 *   OR (tip = 'produs' AND durata_minute IS NULL)
 *
 * Durata se verifică așa cum a fost TRIMISĂ, nu după normalizare: o durată pusă
 * pe un produs este o greșeală a apelantului, nu o valoare de curățat în tăcere.
 */
export function verificaDurataArticol(tip: TipArticol, durata_minute: number | null): void {
  if (tip === 'serviciu') {
    if (durata_minute === null || durata_minute <= 0) {
      throw eroareValidare(
        'Un serviciu trebuie să aibă o durată exprimată în minute, mai mare ca zero.',
        'durata_minute',
      )
    }
    if (!Number.isInteger(durata_minute)) {
      throw eroareValidare('Durata se exprimă în minute întregi.', 'durata_minute')
    }
  } else if (durata_minute !== null) {
    throw eroareValidare('Un produs nu are durată.', 'durata_minute')
  }
}

// ---------------------------------------------------------------------------
// programare
// ---------------------------------------------------------------------------

/** Un moment ISO 8601 valid, refuzat devreme ca să nu ajungă text în bază. */
export function momentCerut(valoare: unknown, camp: string, eticheta: string): string {
  const text = ceruteText(valoare, camp, eticheta)
  if (Number.isNaN(new Date(text).getTime())) {
    throw eroareValidare(`${eticheta} nu este o dată validă.`, camp)
  }
  return text
}

/** CONSTRAINT programare_interval_ck CHECK (se_termina_la > incepe_la) */
export function verificaIntervalProgramare(incepe_la: string, se_termina_la: string): void {
  if (new Date(se_termina_la).getTime() <= new Date(incepe_la).getTime()) {
    throw eroareValidare('Ora de sfârșit trebuie să fie după ora de început.', 'se_termina_la')
  }
}

export const STARI_PROGRAMARE = ['programat', 'onorat', 'anulat', 'neprezentat'] as const

export function verificaStare(valoare: unknown): (typeof STARI_PROGRAMARE)[number] {
  if (!STARI_PROGRAMARE.includes(valoare as never)) {
    throw eroareValidare(
      `Starea poate fi doar una dintre: ${STARI_PROGRAMARE.join(', ')}.`,
      'stare',
    )
  }
  return valoare as (typeof STARI_PROGRAMARE)[number]
}
