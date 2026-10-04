/**
 * Categoriile scrise ca text liber — ale cheltuielilor și ale produselor.
 */

import { unuSauNimic, type Executor } from './db.js'

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
