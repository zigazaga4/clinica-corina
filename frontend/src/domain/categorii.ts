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

/**
 * Lista de prețuri din care se vinde (cerința clinicii, 5 oct. 2026): la
 * vânzare se aleg DOAR produsele clienților. „Produse colaboratori” rămâne în
 * Nomenclator ca listă de prețuri, dar nu ajunge pe bonul unei cliente — altfel
 * crema ar pleca la prețul colaboratorilor. Aceeași regulă stă pe server
 * (backend/src/lib/categorii.ts).
 */
export const CATEGORIE_CLIENTI = 'Produse clienți'

/** Aceeași categorie, scrisă eventual cu alte majuscule — ca `lower()` pe server. */
export function aceeasiCategorie(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return a.toLocaleLowerCase('ro') === b.toLocaleLowerCase('ro')
}

/** Produsul se poate trece pe o vânzare nouă: este pe lista clienților. */
export function seVindeClientilor(articol: Pick<Articol, 'tip' | 'categorie'>): boolean {
  return articol.tip === 'produs' && aceeasiCategorie(articol.categorie, CATEGORIE_CLIENTI)
}

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
