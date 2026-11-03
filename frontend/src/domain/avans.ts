import { rotunjeste } from '@/lib/money'
import type { ProgramareDetaliu, TratamentDetaliu, VanzareLinie } from './types'

/*
  Avansul pe abonament (cerința clinicii, 3 nov. 2026): „i-am pus unei paciente
  un abonament, 1.000 de lei, 4 ședințe. Ea n-a făcut ședința, și vreau să pot
  să-i dau încasare. Dacă o programez și o închid, mi se scade din abonament.”

  Banii luați înainte de ședințe rămân pe abonament (`avans`) până când o ședință
  onorată îi consumă. Două întrebări se pun mereu, în mai multe ecrane — le
  răspund funcțiile de aici, ca ecranele să nu socotească fiecare altfel.
*/

/** Cât s-a încasat în total pe abonament: ședințele plătite și avansul neconsumat. */
export function incasatPeAbonament(t: Pick<TratamentDetaliu, 'incasat' | 'avans'>): number {
  return rotunjeste(t.incasat + t.avans)
}

/**
 * Cât mai poate primi abonamentul: prețul total minus ce s-a încasat deja.
 * Niciodată sub zero — un preț total scăzut după încasare nu face datorie de minus.
 */
export function maiDeIncasatPeAbonament(
  t: Pick<TratamentDetaliu, 'pret_total' | 'incasat' | 'avans'>,
): number {
  return Math.max(rotunjeste(t.pret_total - t.incasat - t.avans), 0)
}

/**
 * Ședința, onorată acum, s-ar plăti din avansul abonamentului ei?
 *
 * Aceeași regulă ca pe server (`stingeDinAvans`): avansul rămas trebuie să
 * acopere ședința ÎNTREAGĂ; un rest mai mic nu o stinge și ședința se încasează
 * ca de obicei.
 */
export function seStingeDinAvans(
  s: Pick<ProgramareDetaliu, 'achitat' | 'tratament_id' | 'tratament_avans' | 'pret'>,
): boolean {
  return !s.achitat && s.tratament_id != null && s.pret > 0 && s.tratament_avans >= s.pret
}

/*
  Comparațiile de mai jos sunt lejere (`== null`) dinadins: un server mai vechi
  decât aplicația nu trimite deloc `tratament_id`, iar „lipsește” înseamnă tot
  „nu e pe abonament” — nu „e pe un abonament necunoscut”.
*/

/** Linia este AVANS: bani luați pe abonament, încă neconsumați de nicio ședință. */
export function esteAvans(l: Pick<VanzareLinie, 'programare_id' | 'tratament_id'>): boolean {
  return l.tratament_id != null && l.programare_id == null
}

/** Linia este un produs vândut la recepție: nici ședință, nici avans. */
export function esteProdus(l: Pick<VanzareLinie, 'programare_id' | 'tratament_id'>): boolean {
  return l.tratament_id == null && l.programare_id == null
}
