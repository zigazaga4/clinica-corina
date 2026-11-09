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

/**
 * Octetul nul nu are cum să ajungă într-o coloană `text`.
 *
 * PostgreSQL refuză toată cererea cu `22021`, pentru că nici un șir al lui nu
 * poate conține `0x00`. JSON, în schimb, îl acceptă scris `\u0000`, așa că
 * ajunge până aici fără să pară nimic. Oprit devreme, greșeala are un mesaj și
 * un câmp; lăsat să treacă, era 500 pe o cerere altfel corectă.
 */
function faraOctetNul(text: string, camp: string | undefined, eticheta: string): string {
  if (text.includes('\u0000')) {
    throw eroareValidare(`${eticheta} conține caractere nepermise.`, camp)
  }
  return text
}

/** NOT NULL pe o coloană text înseamnă, în formular, „nu poate fi gol”. */
export function ceruteText(
  valoare: unknown,
  camp: string,
  eticheta: string,
): string {
  const text = typeof valoare === 'string' ? valoare.trim() : ''
  if (text === '') throw eroareValidare(`${eticheta} este obligatoriu.`, camp)
  return faraOctetNul(text, camp, eticheta)
}

/** Normalizează un text opțional: șirul gol devine NULL, ca în bază. */
export function textOptional(
  valoare: unknown,
  camp?: string,
  eticheta = 'Textul',
): string | null {
  const text = typeof valoare === 'string' ? valoare.trim() : ''
  return text === '' ? null : faraOctetNul(text, camp, eticheta)
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

/**
 * Cât încape într-un `numeric(p,s)`.
 *
 * Coloana ține `p - s` cifre înaintea virgulei, DUPĂ rotunjirea la `s`
 * zecimale: `99999999,999` într-un `numeric(10,2)` se rotunjește la
 * 100.000.000,00 și crapă, deși scris arăta mai mic. Verificat pe valoarea
 * rotunjită, refuzul de aici cade exact unde ar cădea și cel al bazei — numai
 * că spune ce câmp și de ce, în loc de „numeric field overflow” cu 500.
 */
function pesteNumeric(valoare: number, precizie: number, scara: number): boolean {
  const factor = 10 ** scara
  return Math.abs(Math.round(valoare * factor) / factor) >= 10 ** (precizie - scara)
}

/**
 * Culoarea din calendar — a unei persoane sau a unui serviciu: #rrggbb, sau
 * null = înapoi la cea automată (la persoane) / fără culoare (la servicii).
 * Literele mari se aduc la mici, ca aceeași culoare să nu fie două valori.
 */
export function verificaCuloare(valoare: unknown): string | null {
  // Lipsă, null sau goală = fără culoare. Lipsa contează la creare; la
  // modificare, rutele sar peste câmpul netrimis înainte să ajungă aici.
  if (valoare === undefined || valoare === null || valoare === '') return null
  if (typeof valoare !== 'string' || !/^#[0-9a-f]{6}$/i.test(valoare)) {
    throw eroareValidare('Culoarea trebuie să fie de forma #a1b2c3.', 'culoare')
  }
  return valoare.toLowerCase()
}

/** CHECK (pret >= 0), plus limita coloanei `numeric(10,2)`. */
export function verificaPret(pret: number, camp = 'pret_lista'): number {
  // Infinit și NaN nu sunt prețuri negative, ci deloc prețuri: cu mesajul de
  // mai jos, cine trimite „Infinity” caută zadarnic minusul din formular.
  if (!Number.isFinite(pret)) {
    throw eroareValidare('Prețul trebuie să fie un număr finit.', camp)
  }
  if (pret < 0) {
    throw eroareValidare('Prețul nu poate fi negativ.', camp)
  }
  if (pesteNumeric(pret, 10, 2)) {
    throw eroareValidare('Prețul nu poate depăși 99.999.999,99.', camp)
  }
  return pret
}

/**
 * O sumă de bani strict pozitivă — CHECK (suma > 0) pe `numeric(10,2)`.
 *
 * O cheltuială de zero lei nu mută nimic din profit și este, aproape sigur, un
 * formular salvat înainte de a scrie suma.
 */
export function verificaSumaPozitiva(valoare: unknown, camp: string, eticheta: string): number {
  const suma = numarCerut(valoare, camp, eticheta)
  if (suma <= 0) throw eroareValidare(`${eticheta} trebuie să fie mai mare ca zero.`, camp)
  if (pesteNumeric(suma, 10, 2)) {
    throw eroareValidare(`${eticheta} nu poate depăși 99.999.999,99.`, camp)
  }
  return suma
}

/** CHECK (cantitate > 0), plus limita coloanei `numeric(10,3)`. */
export function verificaCantitate(cantitate: number): number {
  if (!Number.isFinite(cantitate)) {
    throw eroareValidare('Cantitatea trebuie să fie un număr finit.', 'cantitate')
  }
  if (cantitate <= 0) {
    throw eroareValidare('Cantitatea trebuie să fie mai mare ca zero.', 'cantitate')
  }
  if (pesteNumeric(cantitate, 10, 3)) {
    throw eroareValidare('Cantitatea nu poate depăși 9.999.999,999.', 'cantitate')
  }
  return cantitate
}

/**
 * Cât încape într-un `integer` — durate, număr de ședințe, orice contor.
 *
 * `5000000000` nu este o durată greșită pentru că ar fi negativă, ci pentru că
 * nu intră în patru octeți: baza răspundea `22003`, adică 500.
 */
export function verificaIntreg(valoare: number, camp: string, eticheta: string): number {
  if (!Number.isInteger(valoare)) {
    throw eroareValidare(`${eticheta} trebuie să fie un număr întreg.`, camp)
  }
  if (valoare > 2147483647 || valoare < -2147483648) {
    throw eroareValidare(`${eticheta} depășește valoarea maximă admisă.`, camp)
  }
  return valoare
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
    // `durata_minute` este `integer` în schemă: peste 2^31 baza răspundea 22003.
    verificaIntreg(durata_minute, 'durata_minute', 'Durata')
  } else if (durata_minute !== null) {
    throw eroareValidare('Un produs nu are durată.', 'durata_minute')
  }
}

/**
 * CONSTRAINT articol_sedinte_ck / tratament.numar_sedinte CHECK (>= 1).
 *
 * „În câte ședințe se face”: un întreg de la 1 în sus. Un produs nu se face
 * în ședințe — pentru el valoarea rămâne 1 și nu se verifică aici.
 */
export function verificaNumarSedinte(valoare: unknown, camp = 'numar_sedinte'): number {
  const n = numarCerut(valoare, camp, 'Numărul de ședințe')
  verificaIntreg(n, camp, 'Numărul de ședințe')
  if (n < 1) {
    throw eroareValidare('Numărul de ședințe trebuie să fie cel puțin 1.', camp)
  }
  return n
}

// ---------------------------------------------------------------------------
// programare
// ---------------------------------------------------------------------------

/**
 * Formele ISO 8601 pe care le acceptăm, scrise ca atare.
 *
 * `YYYY-MM-DD`, opțional cu oră, secunde, zecimale și fus („Z”, „+03:00”,
 * „+0300”). Spațiul în loc de „T” este acceptat pentru că PostgreSQL îl
 * acceptă și el, iar cine lipește o valoare din psql nu greșește cu nimic.
 */
const ISO_8601 =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?\s?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?)?$/

/**
 * Adevărat doar pentru un moment ISO 8601 REAL, nu pentru orice text din care
 * V8 scoate o dată.
 *
 * `new Date("maine la 10")` întoarce 1 octombrie 2001 — parserul lăsat de
 * standard „la latitudinea implementării” încearcă să înțeleagă orice, și de
 * multe ori reușește. Validarea trecea, iar textul original — nu data ghicită —
 * pleca spre PostgreSQL, care îl refuza cu 22007: 500 pe o greșeală de tastare.
 * Aici se cere forma, apoi se verifică și calendarul, ca „2026-02-30” să nu
 * alunece tăcut în 2 martie.
 */
export function esteMomentIso(text: string): boolean {
  const parti = ISO_8601.exec(text)
  if (!parti) return false

  const [, an, luna, zi, ora, minut, secunda] = parti
  // Ziua se verifică prin construcție: cu 30 februarie, `Date.UTC` trece în
  // martie, iar luna sau ziua nu mai sunt cele scrise. Același test prinde și
  // luna 13 sau ziua 00, fără tabel de lungimi de lună și fără ani bisecți.
  const calendar = new Date(Date.UTC(Number(an), Number(luna) - 1, Number(zi)))
  if (calendar.getUTCMonth() !== Number(luna) - 1 || calendar.getUTCDate() !== Number(zi)) {
    return false
  }

  if (ora === undefined) return true
  return Number(ora) <= 23 && Number(minut) <= 59 && Number(secunda ?? '0') <= 59
}

/** Un moment ISO 8601 valid, refuzat devreme ca să nu ajungă text în bază. */
export function momentCerut(valoare: unknown, camp: string, eticheta: string): string {
  const text = ceruteText(valoare, camp, eticheta)
  if (!esteMomentIso(text)) {
    throw eroareValidare(`${eticheta} nu este o dată validă.`, camp)
  }
  return text
}

/**
 * O zi calendaristică, `YYYY-MM-DD`, fără oră.
 *
 * Coloanele `date` și perioadele statisticilor se citesc ca zile, nu ca
 * momente: „2026-09-05T00:00:00Z” ar ajunge pe 4 septembrie într-un fus aflat
 * la vest de Greenwich. Se cere forma scurtă, și calendarul trebuie să existe.
 */
export function dataCeruta(valoare: unknown, camp: string, eticheta: string): string {
  const text = ceruteText(valoare, camp, eticheta)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !esteMomentIso(text)) {
    throw eroareValidare(`${eticheta} nu este o dată validă (AAAA-LL-ZZ).`, camp)
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
