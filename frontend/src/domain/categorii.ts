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

/** Fila produselor fără categorie, lângă listele cu nume („Alte produse”). */
export const ALTE_PRODUSE = 'Alte produse'

/**
 * Lista din care pornește o vânzare deschisă de pe fișa clientei sau din
 * „Încasări”. Din Nomenclator, vânzarea pornește din lista filei (cerința
 * clinicii, 5 oct. 2026: de pe „Produse colaboratori” se vinde din lista
 * colaboratorilor), iar în formular lista se poate schimba.
 */
export const CATEGORIE_CLIENTI = 'Produse clienți'

/** Aceeași categorie, scrisă eventual cu alte majuscule — ca `lower()` pe server. */
export function aceeasiCategorie(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return a.toLocaleLowerCase('ro') === b.toLocaleLowerCase('ro')
}

/**
 * Listele de prețuri ale produselor date: categoriile, alfabetic, și la urmă
 * `null` — produsele fără categorie — doar dacă există.
 */
export function listeleDePreturi(articole: readonly Pick<Articol, 'categorie'>[]): (string | null)[] {
  const categorii = categoriileProduselor(articole)
  return articole.some((a) => a.categorie === null) ? [...categorii, null] : categorii
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
