import type { Articol } from './types'

/*
  Categoriile produselor — listele de prețuri ale clinicii.

  Nu există o listă fixă și nici o rută separată: categoriile sunt cele scrise
  pe produse, iar nomenclatorul vine oricum întreg (zeci de rânduri) pentru
  selectoare. Din el se citesc aici, la fel în filtrul din Nomenclator, în
  formularul produsului și în lista de la vânzare.
*/

/** Eticheta produselor fără categorie — grup în liste, opțiune în filtre. */
export const FARA_CATEGORIE = 'Fără categorie'

/** Categoriile folosite de produsele date, fiecare o dată, în ordine alfabetică. */
export function categoriileProduselor(articole: readonly Pick<Articol, 'categorie'>[]): string[] {
  const unice = new Set<string>()
  for (const a of articole) if (a.categorie) unice.add(a.categorie)
  return [...unice].sort((a, b) => a.localeCompare(b, 'ro'))
}

/** Ordinea grupurilor: alfabetic, iar produsele fără categorie la urmă. */
export function comparaCategorii(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, 'ro')
}
