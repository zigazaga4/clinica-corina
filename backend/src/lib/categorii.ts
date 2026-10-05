/**
 * Categoriile scrise ca text liber — ale cheltuielilor și ale produselor.
 */

import { unuSauNimic, type Executor } from './db.js'
import type { Articol } from '../types/database.js'

/**
 * Lista de prețuri din care se vinde (cerința clinicii, 5 oct. 2026): pe o
 * vânzare intră DOAR produsele clienților. „Produse colaboratori” rămâne în
 * nomenclator, dar crema nu pleacă la o clientă cu prețul colaboratorilor.
 * Aceeași regulă stă în interfață (frontend/src/domain/categorii.ts).
 */
export const CATEGORIE_CLIENTI = 'Produse clienți'

/** Produsul se poate trece pe o vânzare: este pe lista clienților (fără să conteze majusculele). */
export function seVindeClientilor(articol: Pick<Articol, 'tip' | 'categorie'>): boolean {
  return (
    articol.tip === 'produs' &&
    articol.categorie !== null &&
    articol.categorie.toLocaleLowerCase('ro') === CATEGORIE_CLIENTI.toLocaleLowerCase('ro')
  )
}

/** Tabelele cu o coloană `categorie` text liber (și `creat_la`). */
export type TabelCuCategorie = 'cheltuiala' | 'articol'

/**
 * Categoria, scrisă ca data trecută.
 *
 * „chirie” și „Chirie” ar fi fost două felii în graficul cheltuielilor;
 * „produse clienti” și „Produse clienți” ar fi fost două liste de prețuri în
 * nomenclator. Dacă există deja o categorie care diferă doar prin majuscule,
 * se folosește aceea — cea mai veche.
 *
 * `tabel` vine din cod, niciodată din cerere.
 */
export async function categoriaFolosita(
  ex: Executor,
  tabel: TabelCuCategorie,
  categorie: string,
): Promise<string> {
  const existenta = await unuSauNimic<{ categorie: string }>(
    ex,
    `SELECT categorie FROM ${tabel} WHERE lower(categorie) = lower($1)
     ORDER BY creat_la LIMIT 1`,
    [categorie],
  )
  return existenta?.categorie ?? categorie
}
