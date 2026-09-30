/**
 * Aritmetica sumelor de bani.
 *
 * Baza de date ține `numeric(12,2)` și calculează `total_linie` ca
 * `round(cantitate * pret_unitar, 2)`. JavaScript folosește virgulă mobilă
 * binară, deci 0.1 + 0.2 !== 0.3. Toate calculele de bani din interfață trec
 * prin funcțiile de aici, ca previzualizarea unui total să coincidă cu ce va
 * scrie serverul în baza de date.
 *
 * PostgreSQL rotunjește „half away from zero” (2.5 -> 3), spre deosebire de
 * Math.round care rotunjește „half up” (-2.5 -> -2). Diferența apare la
 * corecțiile cu valori negative, deci o reproducem exact.
 */

const SCARA = 100

/** Rotunjire la 2 zecimale, identică cu `round(numeric, 2)` din PostgreSQL. */
export function rotunjeste(valoare: number): number {
  if (!Number.isFinite(valoare)) return 0
  const semn = valoare < 0 ? -1 : 1
  // Epsilon-ul corectează reprezentările de forma 1.005 -> 1.00499999999
  return (semn * Math.round(Math.abs(valoare) * SCARA + Number.EPSILON * SCARA)) / SCARA
}

/** Totalul unei linii: exact formula coloanei generate `total_linie`. */
export function totalLinie(cantitate: number, pret_unitar: number): number {
  return rotunjeste(cantitate * pret_unitar)
}

/** Suma unei liste de valori, rotunjită o singură dată la final. */
export function sumaTotal(valori: readonly number[]): number {
  return rotunjeste(valori.reduce((acc, v) => acc + v, 0))
}

const formatorRON = new Intl.NumberFormat('ro-RO', {
  style: 'currency',
  currency: 'RON',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatorSimplu = new Intl.NumberFormat('ro-RO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** „1.234,50 RON” — pentru afișare în liste și totaluri. */
export function formateazaBani(valoare: number): string {
  return formatorRON.format(rotunjeste(valoare))
}

/** „1.234,50” — fără monedă, pentru coloane care au moneda în antet. */
export function formateazaSuma(valoare: number): string {
  return formatorSimplu.format(rotunjeste(valoare))
}

/** „2,5” / „3” — cantitățile au numeric(10,3), deci până la 3 zecimale. */
export function formateazaCantitate(valoare: number): string {
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(valoare)
}

/**
 * Un număr, în forma în care intră într-un câmp de formular: „1234,5”.
 *
 * Virgulă zecimală, fiindcă asta tastează recepția, și FĂRĂ separator de mii:
 * „1.234,50” ar arăta mai frumos, dar `parseNumar` l-ar citi înapoi greșit.
 * Perechea exactă a lui `parseNumar`.
 */
export function numarInCamp(valoare: number): string {
  return String(valoare).replace('.', ',')
}

/**
 * Citește un număr dintr-un câmp de formular, acceptând atât virgula cât și
 * punctul ca separator zecimal — tastatura numerică românească dă virgulă.
 * Întoarce null pentru text care nu este număr, ca formularul să poată
 * distinge „gol” de „zero”.
 */
export function parseNumar(text: string): number | null {
  const curatat = text.trim().replace(/\s/g, '').replace(',', '.')
  if (curatat === '') return null
  const n = Number(curatat)
  return Number.isFinite(n) ? n : null
}
