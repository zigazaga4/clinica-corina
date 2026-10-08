import { rotunjeste } from '@/lib/money'
import type { Articol, Tratament } from './types'

/*
  Reducerea la abonamente (cerința clinicii, 8 oct. 2026): „eu de obicei mai
  fac 50% reducere la toate abonamentele și vreau să-mi apară un total de plată
  pe care să-l pun eu … total abonament și total cât am încasa de la el”.

  Trei numere și o singură regulă: totalul abonamentului (prețul de listă),
  reducerea în procente și totalul de plată (ce s-a convenit). Oricare dintre
  ultimele două se scrie, celălalt se calculează. Partea unei ședințe vine din
  totalul de plată.
*/

/** Reducerea, în procente, a totalului de plată față de listă; null = fără listă. */
export function procentReducere(lista: number, total: number): number | null {
  if (!(lista > 0)) return null
  return rotunjeste((1 - total / lista) * 100)
}

/** Totalul de plată după o reducere de `procent`% din listă (niciodată sub zero). */
export function totalCuReducere(lista: number, procent: number): number {
  return Math.max(rotunjeste(lista * (1 - procent / 100)), 0)
}

/** Partea unei ședințe dintr-un abonament de `total` lei în `sedinte` ședințe. */
export function parteaSedintei(total: number, sedinte: number): number {
  return sedinte > 0 ? rotunjeste(total / sedinte) : 0
}

/**
 * Prețul de listă al unui abonament de `numar_sedinte` ședințe. La numărul din
 * nomenclator, chiar prețul de acolo; la alt număr, partea lui (900 de lei
 * pentru 8 => 1125 pentru 10). Același calcul ca `pretListaPentru` pe server.
 */
export function pretListaPentru(
  articol: Pick<Articol, 'pret_lista' | 'numar_sedinte'>,
  numar_sedinte: number,
): number {
  if (numar_sedinte === articol.numar_sedinte) return articol.pret_lista
  return rotunjeste((articol.pret_lista / articol.numar_sedinte) * numar_sedinte)
}

/** Reducerea unui tratament, dacă are una: „50% din 900,00 RON”. */
export function reducereaTratamentului(
  tratament: Pick<Tratament, 'pret_lista' | 'pret_total'>,
): { procent: number; lista: number } | null {
  const { pret_lista, pret_total } = tratament
  if (pret_lista === null || !(pret_lista > pret_total)) return null
  const procent = procentReducere(pret_lista, pret_total)
  return procent === null ? null : { procent, lista: pret_lista }
}

const formatorProcent = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 })

/** „50%” / „55,56%”. */
export function formateazaProcent(procent: number): string {
  return `${formatorProcent.format(procent)}%`
}
