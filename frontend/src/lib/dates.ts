/**
 * Lucrul cu timpul.
 *
 * Regula: `Timestamptz` circulă întotdeauna ca string ISO în UTC — asta trimite
 * și asta primește serverul. Conversia în ora locală se face DOAR la afișare și
 * la citirea dintr-un `<input type="datetime-local">`, prin funcțiile de aici.
 * Nicio componentă nu construiește singură un `new Date(...)` dintr-un câmp de
 * formular; altfel o clinică ar vedea alte ore decât cele scrise în bază.
 */

import {
  addDays,
  addMinutes,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ro } from 'date-fns/locale'
import type { DateOnly, Timestamptz } from '@/domain/types'

/** Luni este prima zi a săptămânii în România. */
const OPTIUNI_SAPTAMANA = { locale: ro, weekStartsOn: 1 as const }

export { addDays, addMinutes, differenceInMinutes, isSameDay, isToday }

// ---------------------------------------------------------------------------
// Conversii
// ---------------------------------------------------------------------------

/** String ISO din server -> obiect Date. */
export function laData(t: Timestamptz): Date {
  return parseISO(t)
}

/** Obiect Date -> string ISO UTC, forma acceptată de server. */
export function laTimestamptz(d: Date): Timestamptz {
  return d.toISOString()
}

/** Momentul curent, în forma pe care o trimitem serverului. */
export function acum(): Timestamptz {
  return new Date().toISOString()
}

/**
 * Valoarea pentru `<input type="datetime-local">`, în ORA LOCALĂ.
 * `toISOString()` ar da UTC și ar deplasa ora afișată cu decalajul fusului.
 */
export function laInputDatetime(t: Timestamptz | Date): string {
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

/** Inversa: ce a scris utilizatorul în ora locală -> ISO UTC. */
export function dinInputDatetime(valoare: string): Timestamptz {
  return new Date(valoare).toISOString()
}

/** Valoarea pentru `<input type="date">`. */
export function laInputDate(t: Timestamptz | Date): DateOnly {
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'yyyy-MM-dd')
}

// ---------------------------------------------------------------------------
// Formatare pentru afișare
// ---------------------------------------------------------------------------

/** „07.09.2026” */
export function formateazaData(t: Timestamptz | Date | null): string {
  if (!t) return '—'
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'dd.MM.yyyy', { locale: ro })
}

/** „07.09.2026, 14:30” */
export function formateazaDataOra(t: Timestamptz | Date | null): string {
  if (!t) return '—'
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'dd.MM.yyyy, HH:mm', { locale: ro })
}

/** „14:30” */
export function formateazaOra(t: Timestamptz | Date | null): string {
  if (!t) return '—'
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'HH:mm', { locale: ro })
}

/** „luni, 7 septembrie 2026” — antetul unei zile din calendar. */
export function formateazaZiLunga(t: Timestamptz | Date): string {
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'EEEE, d MMMM yyyy', { locale: ro })
}

/** „septembrie 2026” — antetul vederii pe lună. */
export function formateazaLuna(t: Timestamptz | Date): string {
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'LLLL yyyy', { locale: ro })
}

/** „Lu”, „Ma”, … — capul de tabel al calendarului. */
export function formateazaZiScurt(t: Date): string {
  return format(t, 'EEEEEE', { locale: ro })
}

/** „7 sept.” — eticheta unei zile în vederea pe săptămână. */
export function formateazaZiScurta(t: Timestamptz | Date): string {
  const d = typeof t === 'string' ? parseISO(t) : t
  return format(d, 'd MMM', { locale: ro })
}

/** „14:30 – 15:15” — intervalul unei programări. */
export function formateazaInterval(inceput: Timestamptz, sfarsit: Timestamptz): string {
  return `${formateazaOra(inceput)} – ${formateazaOra(sfarsit)}`
}

/** „45 min” / „1 h 30 min” — durata unui serviciu. */
export function formateazaDurata(minute: number | null): string {
  if (minute === null || minute <= 0) return '—'
  const ore = Math.floor(minute / 60)
  const min = minute % 60
  if (ore === 0) return `${min} min`
  if (min === 0) return `${ore} h`
  return `${ore} h ${min} min`
}

/** Vârsta în ani întregi, pentru fișa clientului. */
export function varsta(data_nasterii: DateOnly | null): number | null {
  if (!data_nasterii) return null
  const nastere = parseISO(data_nasterii)
  const azi = new Date()
  let ani = azi.getFullYear() - nastere.getFullYear()
  const luna = azi.getMonth() - nastere.getMonth()
  if (luna < 0 || (luna === 0 && azi.getDate() < nastere.getDate())) ani -= 1
  return ani >= 0 ? ani : null
}

// ---------------------------------------------------------------------------
// Intervale pentru calendar
// ---------------------------------------------------------------------------

export type VedereCalendar = 'zi' | 'saptamana' | 'luna'

export interface IntervalVizibil {
  inceput: Date
  sfarsit: Date
  /** Zilele afișate în grilă, în ordine. */
  zile: Date[]
}

/**
 * Intervalul acoperit de o vedere de calendar, ancorat pe o dată.
 *
 * Vederea pe lună întoarce ÎNTOTDEAUNA 42 de zile (6 săptămâni complete), ca
 * grila să nu-și schimbe înălțimea de la o lună la alta — un salt vizibil și
 * enervant la navigarea rapidă între luni.
 */
export function intervalPentruVedere(ancora: Date, vedere: VedereCalendar): IntervalVizibil {
  if (vedere === 'zi') {
    const inceput = startOfDay(ancora)
    return { inceput, sfarsit: endOfDay(ancora), zile: [inceput] }
  }

  if (vedere === 'saptamana') {
    const inceput = startOfWeek(ancora, OPTIUNI_SAPTAMANA)
    const sfarsit = endOfWeek(ancora, OPTIUNI_SAPTAMANA)
    return { inceput, sfarsit, zile: seriaDeZile(inceput, 7) }
  }

  const inceputGrila = startOfWeek(startOfMonth(ancora), OPTIUNI_SAPTAMANA)
  const zile = seriaDeZile(inceputGrila, 42)
  return {
    inceput: inceputGrila,
    sfarsit: endOfDay(zile[41] as Date),
    zile,
  }
}

function seriaDeZile(inceput: Date, cate: number): Date[] {
  return Array.from({ length: cate }, (_, i) => addDays(inceput, i))
}

/** Pasul de navigare înainte/înapoi, potrivit vederii curente. */
export function deplaseazaAncora(ancora: Date, vedere: VedereCalendar, pas: -1 | 1): Date {
  if (vedere === 'zi') return addDays(ancora, pas)
  if (vedere === 'saptamana') return addDays(ancora, 7 * pas)
  const d = new Date(ancora)
  d.setMonth(d.getMonth() + pas)
  return d
}

export { startOfDay, endOfDay, startOfMonth, endOfMonth }

/**
 * Se suprapun două intervale? Reproduce operatorul `&&` din constrângerea
 * `programare_fara_suprapunere`: capetele care se ating NU se suprapun,
 * deci o programare 14:00–15:00 și una 15:00–16:00 sunt valide împreună.
 */
export function seSuprapun(
  aInceput: Timestamptz,
  aSfarsit: Timestamptz,
  bInceput: Timestamptz,
  bSfarsit: Timestamptz,
): boolean {
  return aInceput < bSfarsit && bInceput < aSfarsit
}

/** Este momentul în interiorul zilei date? Folosit la gruparea pe zile. */
export function esteInZiua(t: Timestamptz, zi: Date): boolean {
  return isSameDay(parseISO(t), zi)
}
