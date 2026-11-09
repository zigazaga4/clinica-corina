/**
 * Ce știe aplicația să arate — comutatoare, nu cod șters.
 *
 * Fork-ul pentru Corina Burcut (9 nov. 2026) pornește SIMPLU: calendar, clienți,
 * procedurile cu culorile lor. Tot ce ține de bani — prețuri, plăți, restanțe,
 * produse, statistici, cheltuieli — și abonamentele în mai multe ședințe sunt
 * ascunse, nu scoase: „vedem dacă mai vrea ceva adăugat” înseamnă că se pornesc
 * înapoi dintr-o variabilă, nu se rescriu.
 *
 * Fiecare comutator se citește din mediul de construire (`.env.production`,
 * `.env.local` sau variabila de repo la CI):
 *
 *   VITE_FUNCTIE_COSTURI=true       prețuri, încasări, produse, statistici, cheltuieli
 *   VITE_FUNCTIE_TRATAMENTE=true    serviciile în mai multe ședințe (abonamente)
 *
 * Lipsă sau altceva decât `true`/`1` = oprit.
 *
 * Ascunderea e DOAR în interfață. Serverul rămâne același: un serviciu nou
 * primește preț 0 și o programare nu cere plată, deci în datele ei nu apar
 * restanțe, iar cifrele ar rămâne zero chiar dacă cineva ar deschide un ecran
 * ascuns.
 */

export interface Functii {
  /** Prețuri, plăți, restanțe, produse, Statistici, cheltuieli, „Ședințe pe persoane”. */
  costuri: boolean
  /** Serviciile în mai multe ședințe, cu pagina „Tratamente” și progresul pe fișă. */
  tratamente: boolean
}

const pornit = (valoare: string | undefined): boolean => valoare === 'true' || valoare === '1'

/**
 * Starea curentă. Un obiect, nu un context: comutatoarele se hotărăsc la
 * construire și nu se mai schimbă cât rulează aplicația, deci nu au nevoie de
 * re-randare. Testele îl schimbă prin `seteazaFunctii`.
 */
export const functii: Functii = {
  costuri: pornit(import.meta.env.VITE_FUNCTIE_COSTURI),
  tratamente: pornit(import.meta.env.VITE_FUNCTIE_TRATAMENTE),
}

/** Doar pentru teste și pentru demonstrații: schimbă comutatoarele pe loc. */
export function seteazaFunctii(schimbari: Partial<Functii>): void {
  Object.assign(functii, schimbari)
}
