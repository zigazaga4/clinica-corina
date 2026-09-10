/**
 * Aritmetica sumelor de bani.
 *
 * Baza ține `numeric(12,2)` și calculează `total_linie` ca
 * `round(cantitate * pret_unitar, 2)`. Odată citite în JavaScript, sumele sunt
 * virgulă mobilă binară, unde 0.1 + 0.2 nu face 0.3. Totalul unui bon se adună
 * aici, cu aceeași rotunjire ca a bazei, ca suma afișată să fie exact suma
 * scrisă.
 *
 * PostgreSQL rotunjește „half away from zero” (2.5 -> 3), spre deosebire de
 * `Math.round`, care duce -2.5 la -2. Diferența apare la corecțiile negative,
 * deci se reproduce întocmai. Funcțiile sunt gemene cu `src/lib/money.ts` din
 * aplicație — un total calculat dincolo trebuie să iasă identic cu unul
 * calculat aici.
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
