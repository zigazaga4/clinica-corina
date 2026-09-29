import type { NotitaDetaliu, ProgramareDetaliu, Timestamptz, Uuid } from '@/domain/types'
import { esteInZiua } from '@/lib/dates'
import { grupeazaPeProgramari } from './vizite'

/**
 * Ce încape într-o celulă de calendar: o programare sau o notiță.
 *
 * Grila, luna și agenda le desenează diferit, dar le AȘAZĂ la fel — după oră,
 * în coloane când se suprapun. Uniunea de aici există ca așezarea să fie
 * scrisă o singură dată și să nu știe cu ce are de-a face. Fiecare vedere
 * deosebește felul abia în clipa în care alege ce componentă randează.
 *
 * O programare cu mai multe servicii este UN element: `programare` este primul
 * ei rând (ora, clientul, persoana, starea — aceleași pe toate), `servicii`
 * sunt toate rândurile ei. Desenate separat, cele trei servicii ale aceleiași
 * veniri ar fi stat unul lângă altul ca trei programări suprapuse.
 */
export type ElementCalendar =
  | { fel: 'programare'; programare: ProgramareDetaliu; servicii: ProgramareDetaliu[] }
  | { fel: 'notita'; notita: NotitaDetaliu }

/** Ce au în comun cele două: un identificator și două capete de interval. */
export interface IntervalCalendar {
  id: Uuid
  incepe_la: Timestamptz
  se_termina_la: Timestamptz
}

export function intervalul(element: ElementCalendar): IntervalCalendar {
  return element.fel === 'programare' ? element.programare : element.notita
}

/** Programările (cu serviciile lor strânse la un loc) și notițele, în ordinea în care încep. */
export function elementeCalendar(
  programari: ProgramareDetaliu[],
  notite: NotitaDetaliu[],
): ElementCalendar[] {
  const elemente: ElementCalendar[] = [
    ...grupeazaPeProgramari(programari).map(
      (servicii): ElementCalendar => ({ fel: 'programare', programare: servicii[0]!, servicii }),
    ),
    ...notite.map((notita): ElementCalendar => ({ fel: 'notita', notita })),
  ]
  return elemente.sort((a, b) => intervalul(a).incepe_la.localeCompare(intervalul(b).incepe_la))
}

/** Elementele care încep în ziua dată. */
export function dinZiua<T extends IntervalCalendar>(randuri: T[], zi: Date): T[] {
  return randuri.filter((r) => esteInZiua(r.incepe_la, zi))
}
