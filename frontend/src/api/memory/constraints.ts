/**
 * Constrângerile bazei de date, reproduse în memorie.
 *
 * Fiecare funcție de aici corespunde unei constrângeri din DDL-ul de la §8.
 * Sunt reproduse pentru că altfel interfața ar fi construită împotriva unui
 * server mai permisiv decât cel real: formularul de programare ar părea că
 * funcționează, iar la prima rulare pe PostgreSQL ar primi 23P01 de la
 * `programare_fara_suprapunere` fără ca nimeni să fi proiectat acel mesaj.
 *
 * Numele constrângerii NU pleacă spre interfață, nici aici, nici de pe server:
 * `utilizator_email_uk` nu spune nimic recepției și, în schimb, desenează
 * oricui întreabă harta tabelelor. Serverul îl ține în jurnalul lui, unde
 * folosește la depanare. Afară pleacă doar mesajul, câmpul vinovat și datele
 * de care are nevoie ecranul (câte programări, care programare).
 */

import { eroareConflict, eroareNegasit, eroareValidare } from '@/api/errors'
import { seSuprapun } from '@/lib/dates'
import type { Articol, StareProgramare, TipArticol, Timestamptz, Uuid } from '@/domain/types'
import { magazin } from './store'

// ---------------------------------------------------------------------------
// Integritate referențială (FOREIGN KEY)
// ---------------------------------------------------------------------------

/** Rândul referit trebuie să existe, altfel FK-ul ar eșua la INSERT. */
export function ceruta<T>(map: Map<Uuid, T>, id: Uuid, nume: string): T {
  const rand = map.get(id)
  if (!rand) throw eroareNegasit(nume)
  return rand
}

// ---------------------------------------------------------------------------
// utilizator
// ---------------------------------------------------------------------------

/** CREATE UNIQUE INDEX utilizator_email_uk ON utilizator (lower(email)) */
export function verificaEmailUnic(email: string, exceptaId?: Uuid): void {
  const normalizat = email.trim().toLowerCase()
  for (const u of magazin.utilizator.values()) {
    if (u.id === exceptaId) continue
    if (u.email.trim().toLowerCase() === normalizat) {
      throw eroareConflict('Există deja un cont cu această adresă de e-mail.', {
        camp: 'email',
      })
    }
  }
}

export function verificaFormatEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw eroareValidare('Adresa de e-mail nu are un format valid.', 'email')
  }
}

/** Regula minimă de parolă. Serverul o va aplica înainte de Argon2id. */
export function verificaParola(parola: string): void {
  if (parola.length < 8) {
    throw eroareValidare('Parola trebuie să aibă cel puțin 8 caractere.', 'parola')
  }
}

// ---------------------------------------------------------------------------
// punct_lucru
// ---------------------------------------------------------------------------

/** denumire text NOT NULL UNIQUE */
export function verificaDenumirePunctUnica(denumire: string, exceptaId?: Uuid): void {
  const normalizata = denumire.trim().toLowerCase()
  for (const p of magazin.punct_lucru.values()) {
    if (p.id === exceptaId) continue
    if (p.denumire.trim().toLowerCase() === normalizata) {
      throw eroareConflict('Există deja un punct de lucru cu această denumire.', {
        camp: 'denumire',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// articol
// ---------------------------------------------------------------------------

/**
 * CONSTRAINT articol_durata_ck:
 *   (tip = 'serviciu' AND durata_minute IS NOT NULL AND durata_minute > 0)
 *   OR (tip = 'produs' AND durata_minute IS NULL)
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

/** CHECK (pret_lista >= 0) */
export function verificaPret(pret: number, camp = 'pret_lista'): void {
  if (!Number.isFinite(pret) || pret < 0) {
    throw eroareValidare('Prețul nu poate fi negativ.', camp)
  }
}

// ---------------------------------------------------------------------------
// programare
// ---------------------------------------------------------------------------

/** CONSTRAINT programare_interval_ck CHECK (se_termina_la > incepe_la) */
export function verificaIntervalProgramare(
  incepe_la: Timestamptz,
  se_termina_la: Timestamptz,
): void {
  if (!(se_termina_la > incepe_la)) {
    throw eroareValidare(
      'Ora de sfârșit trebuie să fie după ora de început.',
      'se_termina_la',
    )
  }
}

/**
 * FOREIGN KEY (articol_id, articol_tip) REFERENCES articol (id, tip)
 *
 * Întoarce serviciul validat: apelanții au nevoie imediat după de durata și de
 * prețul lui, iar o a doua căutare pe aceeași cheie ar fi risipă.
 */
export function verificaArticolProgramabil(articol_id: Uuid): Articol {
  const articol = ceruta(magazin.articol, articol_id, 'Serviciul')
  if (articol.tip !== 'serviciu') {
    throw eroareValidare('Se pot programa doar articole de tip serviciu.', 'articol_id')
  }
  return articol
}

/**
 * CONSTRAINT programare_fara_suprapunere EXCLUDE USING gist (
 *   executant_id WITH =, tstzrange(incepe_la, se_termina_la) WITH &&
 * ) WHERE (stare <> 'anulat')
 *
 * Programările anulate sunt în afara constrângerii — locul se eliberează.
 */
export function verificaSuprapunere(
  executant_id: Uuid,
  incepe_la: Timestamptz,
  se_termina_la: Timestamptz,
  stare: StareProgramare,
  exceptaId?: Uuid,
): void {
  if (stare === 'anulat') return

  for (const p of magazin.programare.values()) {
    if (p.id === exceptaId) continue
    if (p.executant_id !== executant_id) continue
    if (p.stare === 'anulat') continue
    if (seSuprapun(incepe_la, se_termina_la, p.incepe_la, p.se_termina_la)) {
      const executant = magazin.utilizator.get(executant_id)
      throw eroareConflict(
        `${executant?.nume ?? 'Persoana selectată'} are deja o programare care se suprapune cu acest interval.`,
        { camp: 'incepe_la', programare_id: p.id },
      )
    }
  }
}

// ---------------------------------------------------------------------------
// vanzare_linie
// ---------------------------------------------------------------------------

/** CHECK (cantitate > 0) */
export function verificaCantitate(cantitate: number): void {
  if (!Number.isFinite(cantitate) || cantitate <= 0) {
    throw eroareValidare('Cantitatea trebuie să fie mai mare ca zero.', 'cantitate')
  }
}

// ---------------------------------------------------------------------------
// ON DELETE RESTRICT
// ---------------------------------------------------------------------------

/**
 * DELETE /clienti/:id este refuzată dacă există programări sau vânzări:
 * ambele chei străine către `client` sunt ON DELETE RESTRICT.
 */
export function verificaStergereClient(client_id: Uuid): void {
  let programari = 0
  for (const p of magazin.programare.values()) if (p.client_id === client_id) programari++

  let vanzari = 0
  for (const v of magazin.vanzare.values()) if (v.client_id === client_id) vanzari++

  if (programari > 0 || vanzari > 0) {
    const parti: string[] = []
    if (programari > 0) parti.push(`${programari} ${programari === 1 ? 'programare' : 'programări'}`)
    if (vanzari > 0) parti.push(`${vanzari} ${vanzari === 1 ? 'vânzare' : 'vânzări'}`)
    throw eroareConflict(
      `Clientul nu poate fi șters definitiv: are ${parti.join(' și ')}. Arhivează-l în schimb.`,
      { programari, vanzari },
    )
  }
}

// ---------------------------------------------------------------------------
// Validări comune de formular
// ---------------------------------------------------------------------------

/** NOT NULL pe o coloană text înseamnă, în interfață, „nu poate fi gol”. */
export function ceruteText(valoare: string | null | undefined, camp: string, eticheta: string): string {
  const text = (valoare ?? '').trim()
  if (text === '') throw eroareValidare(`${eticheta} este obligatoriu.`, camp)
  return text
}

/** Normalizează un text opțional: șirul gol devine NULL, ca în bază. */
export function textOptional(valoare: string | null | undefined): string | null {
  const text = (valoare ?? '').trim()
  return text === '' ? null : text
}
