/**
 * Etichetele afișate pentru valorile enumerate și tonul cromatic al fiecăreia.
 *
 * Un singur loc pentru text + culoare înseamnă că o stare de programare arată
 * la fel în calendar, în agenda zilei, în istoricul clientului și în jurnal,
 * fără ca vreo componentă să repete maparea.
 */

import type {
  ActiuneJurnal,
  MetodaPlata,
  RolUtilizator,
  StareProgramare,
  TipArticol,
} from './types'
import type { BadgeTone } from '@/ui/Badge'

export const etichetaRol: Record<RolUtilizator, string> = {
  administrator: 'Administrator',
  utilizator: 'Utilizator',
}

export const etichetaStareProgramare: Record<StareProgramare, string> = {
  programat: 'Programat',
  onorat: 'Onorat',
  anulat: 'Anulat',
  neprezentat: 'Neprezentat',
}

export const tonStareProgramare: Record<StareProgramare, BadgeTone> = {
  programat: 'info',
  onorat: 'success',
  anulat: 'neutral',
  neprezentat: 'danger',
}

export const etichetaTipArticol: Record<TipArticol, string> = {
  serviciu: 'Serviciu',
  produs: 'Produs',
}

export const tonTipArticol: Record<TipArticol, BadgeTone> = {
  serviciu: 'info',
  produs: 'warning',
}

export const etichetaMetodaPlata: Record<MetodaPlata, string> = {
  numerar: 'Numerar',
  card: 'Card',
}

/** Toate metodele, în ordinea în care apar pe butoane. */
export const METODE_PLATA: readonly MetodaPlata[] = ['numerar', 'card']

export const etichetaActiuneJurnal: Record<ActiuneJurnal, string> = {
  creare: 'Creare',
  modificare: 'Modificare',
  stergere: 'Ștergere',
  arhivare: 'Arhivare',
  autentificare: 'Autentificare',
}

export const tonActiuneJurnal: Record<ActiuneJurnal, BadgeTone> = {
  creare: 'success',
  modificare: 'info',
  stergere: 'danger',
  arhivare: 'warning',
  autentificare: 'neutral',
}

/** Numele tabelelor, așa cum apar în coloana `entitate` din jurnal. */
export const etichetaEntitate: Record<string, string> = {
  utilizator: 'Utilizator',
  punct_lucru: 'Punct de lucru',
  articol: 'Articol',
  client: 'Client',
  nota_client: 'Notă client',
  consimtamant: 'Acord GDPR',
  programare: 'Programare',
  notita: 'Notiță în calendar',
  tratament: 'Tratament',
  vanzare: 'Vânzare',
  vanzare_linie: 'Linie vânzare',
  cheltuiala: 'Cheltuială',
  statistici: 'Statistici',
  parola_statistici: 'Parola statisticilor',
  sesiune: 'Sesiune',
}

/** Traduce numele unei tabele în text citibil, cu revenire la valoarea brută. */
export function numeEntitate(entitate: string): string {
  return etichetaEntitate[entitate] ?? entitate
}
