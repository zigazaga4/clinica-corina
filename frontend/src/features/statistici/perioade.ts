/**
 * Perioadele Statisticilor: ce se alege, cu ce se compară, cum se împarte.
 *
 * Toată logica stă aici, o singură dată, și nu pe server: serverul primește
 * două intervale gata calculate și pasul barelor. Comparația „firească” diferă
 * de la o alegere la alta — luna aceasta până azi se compară cu aceleași zile
 * din luna trecută, nu cu ultimele 29 de zile — iar asta e o decizie de ecran,
 * nu de bază de date.
 */

import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  isSameMonth,
  isSameYear,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns'
import { ro } from 'date-fns/locale'
import type { DateOnly, PasStatistici } from '@/domain/types'

export type Preset =
  | 'azi'
  | 'saptamana'
  | 'luna'
  | 'luna_trecuta'
  | 'ultimele_12_luni'
  | 'anul'
  | 'anul_trecut'
  | 'interval'

export const PRESETURI: { valoare: Preset; eticheta: string }[] = [
  { valoare: 'azi', eticheta: 'Azi' },
  { valoare: 'saptamana', eticheta: 'Săptămâna aceasta' },
  { valoare: 'luna', eticheta: 'Luna aceasta' },
  { valoare: 'luna_trecuta', eticheta: 'Luna trecută' },
  { valoare: 'ultimele_12_luni', eticheta: 'Ultimele 12 luni' },
  { valoare: 'anul', eticheta: 'Anul acesta' },
  { valoare: 'anul_trecut', eticheta: 'Anul trecut' },
  { valoare: 'interval', eticheta: 'Alt interval…' },
]

export interface Perioada {
  de_la: DateOnly
  pana_la: DateOnly
}

export interface AlegerePerioada {
  preset: Preset
  /** Folosit doar la „Alt interval”. */
  interval: Perioada
}

export interface PerioadaCalculata {
  perioada: Perioada
  /** Perioada cu care se compară totalurile. */
  comparatie: Perioada
  pas: PasStatistici
}

const zi = (d: Date): DateOnly => format(d, 'yyyy-MM-dd')

/** Cât cuprinde o bară: zile cât încap citibil, apoi săptămâni, apoi luni. */
export function pasPentru(p: Perioada): PasStatistici {
  const zile = differenceInCalendarDays(parseISO(p.pana_la), parseISO(p.de_la)) + 1
  if (zile <= 45) return 'zi'
  if (zile <= 200) return 'saptamana'
  return 'luna'
}

/** Perioada aleasă, perioada cu care se compară și pasul barelor. */
export function calculeazaPerioada(alegere: AlegerePerioada, azi: Date = new Date()): PerioadaCalculata {
  const cu = (de_la: Date, pana_la: Date, comp_de_la: Date, comp_pana_la: Date): PerioadaCalculata => {
    const perioada = { de_la: zi(de_la), pana_la: zi(pana_la) }
    return {
      perioada,
      comparatie: { de_la: zi(comp_de_la), pana_la: zi(comp_pana_la) },
      pas: pasPentru(perioada),
    }
  }

  switch (alegere.preset) {
    case 'azi':
      return cu(azi, azi, addDays(azi, -1), addDays(azi, -1))

    case 'saptamana': {
      const lunea = startOfWeek(azi, { weekStartsOn: 1 })
      return cu(lunea, azi, addDays(lunea, -7), addDays(azi, -7))
    }

    // Până azi, comparată cu ACELEAȘI zile din luna trecută: pe 10 ale lunii,
    // o lună întreagă de comparat ar arăta orice lună ca pe un dezastru.
    // `subMonths` taie la sfârșitul lunii: 31 martie devine 28 februarie.
    case 'luna': {
      const inceput = startOfMonth(azi)
      return cu(inceput, azi, subMonths(inceput, 1), subMonths(azi, 1))
    }

    case 'luna_trecuta': {
      const inceput = startOfMonth(subMonths(azi, 1))
      return cu(inceput, endOfMonth(inceput), subMonths(inceput, 1), endOfMonth(subMonths(inceput, 1)))
    }

    case 'ultimele_12_luni': {
      const inceput = startOfMonth(subMonths(azi, 11))
      return cu(inceput, azi, subYears(inceput, 1), subYears(azi, 1))
    }

    case 'anul': {
      const inceput = startOfYear(azi)
      return cu(inceput, azi, subYears(inceput, 1), subYears(azi, 1))
    }

    case 'anul_trecut': {
      const inceput = startOfYear(subYears(azi, 1))
      return cu(inceput, endOfYear(inceput), subYears(inceput, 1), endOfYear(subYears(inceput, 1)))
    }

    // Un interval oarecare se compară cu tot atâtea zile, chiar dinaintea lui.
    case 'interval': {
      let de_la = parseISO(alegere.interval.de_la)
      let pana_la = parseISO(alegere.interval.pana_la)
      if (pana_la < de_la) [de_la, pana_la] = [pana_la, de_la]
      const zile = differenceInCalendarDays(pana_la, de_la) + 1
      return cu(de_la, pana_la, addDays(de_la, -zile), addDays(de_la, -1))
    }
  }
}

/** Alegerea cu care se deschide ecranul. */
export function alegereImplicita(azi: Date = new Date()): AlegerePerioada {
  return { preset: 'luna', interval: { de_la: zi(startOfMonth(azi)), pana_la: zi(azi) } }
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** „29 septembrie 2026”, „1–29 septembrie 2026”, „1 ian. – 29 sept. 2026”. */
export function formateazaPerioada(p: Perioada): string {
  const a = parseISO(p.de_la)
  const b = parseISO(p.pana_la)
  if (p.de_la === p.pana_la) return format(a, 'd MMMM yyyy', { locale: ro })
  if (isSameMonth(a, b)) return `${format(a, 'd')}–${format(b, 'd MMMM yyyy', { locale: ro })}`
  if (isSameYear(a, b)) {
    return `${format(a, 'd MMM', { locale: ro })} – ${format(b, 'd MMM yyyy', { locale: ro })}`
  }
  return `${format(a, 'd MMM yyyy', { locale: ro })} – ${format(b, 'd MMM yyyy', { locale: ro })}`
}

/** Eticheta de sub o bară și titlul ferestrei ei de detaliu. */
export function eticheteBara(
  inceput: DateOnly,
  pas: PasStatistici,
  perioada: Perioada,
): { eticheta: string; titlu: string } {
  const d = parseISO(inceput)
  if (pas === 'luna') {
    const unAn = isSameYear(parseISO(perioada.de_la), parseISO(perioada.pana_la))
    return {
      eticheta: format(d, unAn ? 'LLL' : 'LLL yy', { locale: ro }),
      titlu: format(d, 'LLLL yyyy', { locale: ro }),
    }
  }
  if (pas === 'saptamana') {
    return {
      eticheta: format(d, 'd MMM', { locale: ro }),
      titlu: `Săptămâna din ${format(d, 'd MMMM', { locale: ro })}`,
    }
  }
  const oLuna = isSameMonth(parseISO(perioada.de_la), parseISO(perioada.pana_la))
  return {
    eticheta: format(d, oLuna ? 'd' : 'd MMM', { locale: ro }),
    titlu: format(d, 'EEEE, d MMMM', { locale: ro }),
  }
}

/** Ziua săptămânii, după numărul ISO: 1 = „Lu” … 7 = „Du”. */
export function numeZiSaptamana(ziIso: number, lung = false): string {
  // 5 ianuarie 2026 a fost luni; ziua cerută e la `ziIso - 1` zile după.
  const d = addDays(new Date(2026, 0, 5), ziIso - 1)
  return format(d, lung ? 'EEEE' : 'EEEEEE', { locale: ro })
}
