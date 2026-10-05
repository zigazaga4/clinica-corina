import type { Uuid, VanzareDetaliu, VanzareLinieDetaliu } from './types'

/**
 * Cine a câștigat o linie de vânzare — după asta se socotește salariul
 * (cerința clinicii, 2026-10-05: „Adriana e onorată în soft și făcută de Anda;
 * vreau să-mi apară Anda”).
 *
 * Ședința este a celui care a făcut-o, oricine ar fi introdus plata la recepție.
 * Produsul, care n-are executant, este al celui care l-a vândut: operatorul.
 * Serverul filtrează după aceeași regulă (`persoana_id` pe GET /vanzari).
 */
export function persoanaLiniei(
  vanzare: Pick<VanzareDetaliu, 'operator_id' | 'operator_nume'>,
  linie: Pick<VanzareLinieDetaliu, 'executant_id' | 'executant_nume'>,
): { id: Uuid; nume: string } {
  return linie.executant_id
    ? { id: linie.executant_id, nume: linie.executant_nume ?? '—' }
    : { id: vanzare.operator_id, nume: vanzare.operator_nume }
}

/** Numele celor care au lucrat la o vânzare, fără repetări, în ordinea liniilor. */
export function facutaDe(vanzare: VanzareDetaliu): string[] {
  const nume = vanzare.linii.map((l) => persoanaLiniei(vanzare, l).nume)
  return nume.length > 0 ? [...new Set(nume)] : [vanzare.operator_nume]
}
