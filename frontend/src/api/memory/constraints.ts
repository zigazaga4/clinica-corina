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
import type { Articol, TipArticol, Timestamptz, Uuid } from '@/domain/types'
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

/**
 * CONSTRAINT articol_sedinte_ck:
 *   numar_sedinte >= 1 AND (tip = 'serviciu' OR numar_sedinte = 1)
 * și tratament.numar_sedinte CHECK (>= 1).
 *
 * Ca la durată, valoarea se verifică așa cum a fost TRIMISĂ: un produs „în
 * patru ședințe” este o greșeală a apelantului, nu o valoare de curățat.
 */
export function verificaNumarSedinte(
  valoare: number,
  tip: TipArticol = 'serviciu',
  camp = 'numar_sedinte',
): number {
  if (!Number.isInteger(valoare) || valoare < 1) {
    throw eroareValidare('Numărul de ședințe trebuie să fie un întreg, cel puțin 1.', camp)
  }
  if (tip === 'produs' && valoare !== 1) {
    throw eroareValidare('Un produs nu se face în ședințe.', camp)
  }
  return valoare
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

/*
  `programare_fara_suprapunere` nu mai există (2026-10-01): aceeași persoană
  poate avea mai multe programări la aceeași oră, ca pe server.
*/

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

/**
 * Ștergerea unui articol: doar nefolosit (ON DELETE RESTRICT pe programare,
 * vanzare_linie și tratament). Același mesaj ca pe server
 * (backend/src/routes/articole.ts, `mesajArticolFolosit`).
 */
export function verificaStergereArticol(articol_id: Uuid, tip: TipArticol): void {
  let programari = 0
  for (const p of magazin.programare.values()) if (p.articol_id === articol_id) programari++
  let linii = 0
  for (const l of magazin.vanzare_linie.values()) if (l.articol_id === articol_id) linii++
  let tratamente = 0
  for (const t of magazin.tratament.values()) if (t.articol_id === articol_id) tratamente++

  if (programari > 0 || linii > 0 || tratamente > 0) {
    const parti: string[] = []
    if (linii > 0) parti.push(`pe ${linii} ${linii === 1 ? 'bon' : 'bonuri'}`)
    if (programari > 0) parti.push(`în ${programari} ${programari === 1 ? 'programare' : 'programări'}`)
    if (tratamente > 0) parti.push(`în ${tratamente} ${tratamente === 1 ? 'tratament' : 'tratamente'}`)
    const cine = tip === 'produs' ? 'Produsul' : 'Serviciul'
    throw eroareConflict(
      `${cine} apare ${parti.join(', ')} și nu poate fi șters — istoricul are nevoie de el. ` +
        'Dezactivează-l în schimb: dispare din liste, iar rândurile vechi își păstrează denumirea.',
      { programari, linii, tratamente },
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

/**
 * O zi calendaristică `YYYY-MM-DD`, care chiar există — ca `dataCeruta` de pe
 * server. „2026-02-30” nu alunecă tăcut în 2 martie, iar un moment cu oră nu
 * trece drept zi.
 */
export function dataCeruta(valoare: string | null | undefined, camp: string, eticheta: string): string {
  const text = ceruteText(valoare, camp, eticheta)
  const parti = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const zi = parti ? new Date(Date.UTC(Number(parti[1]), Number(parti[2]) - 1, Number(parti[3]))) : null
  if (!parti || !zi || zi.getUTCMonth() !== Number(parti[2]) - 1 || zi.getUTCDate() !== Number(parti[3])) {
    throw eroareValidare(`${eticheta} nu este o dată validă (AAAA-LL-ZZ).`, camp)
  }
  return text
}

/**
 * CHECK (suma > 0) pe `numeric(10,2)` — o cheltuială de zero lei nu mută
 * nimic din profit și este, aproape sigur, un formular salvat prea devreme.
 */
export function verificaSumaPozitiva(suma: number, camp: string, eticheta: string): number {
  if (!Number.isFinite(suma)) throw eroareValidare(`${eticheta} trebuie să fie un număr.`, camp)
  if (suma <= 0) throw eroareValidare(`${eticheta} trebuie să fie mai mare ca zero.`, camp)
  if (Math.abs(Math.round(suma * 100) / 100) >= 1e8) {
    throw eroareValidare(`${eticheta} nu poate depăși 99.999.999,99.`, camp)
  }
  return suma
}
