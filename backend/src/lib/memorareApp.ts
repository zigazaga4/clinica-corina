import path from 'path'

/*
  Cât timp își ține browserul minte fișierele interfeței web (`/app`).

  Trei feluri de fișiere, trei reguli:

    - `assets/*` — poartă o amprentă în nume (`index-a1b2c3.js`) și nu se
      schimbă niciodată la același nume. Un an, fără întrebări (`immutable`
      oprește chiar și verificarea la reîncărcarea cu F5).

    - `index.html` — singurul fișier cu nume fix care alege ce scripturi pornesc.
      `no-store`, nu `no-cache`: `no-cache` înseamnă „întreabă serverul înainte
      să folosești copia”, dar butonul Înapoi, „redeschide fila închisă” și
      restaurarea sesiunii sar peste întrebare și iau copia așa cum e. Rezultat
      măsurat în Chrome: după o actualizare, omul ajungea pe pagina veche, cu
      scripturile vechi, până la Ctrl+Shift+R. Pagina are 2 KB; să fie adusă de
      fiecare dată costă mai puțin decât o singură întrebare către API.

    - orice alt fișier cu nume fix (pictograme, manifest): `no-cache`. Până acum
      primeau un an ca restul, deci o pictogramă schimbată rămânea veche pe
      telefoanele care o văzuseră o dată. Costul întrebării e un răspuns 304, gol.
*/

export const MEMORARE_INDEX = 'no-store'
const MEMORARE_CU_AMPRENTA = 'public, max-age=31536000, immutable'
const MEMORARE_FARA_AMPRENTA = 'no-cache'

/**
 * Antetul `Cache-Control` pentru un fișier din dosarul interfeței.
 *
 * @param dosarApp   rădăcina interfeței (`public/app`)
 * @param caleFisier calea fișierului servit, cum o dă `express.static`
 */
export function antetMemorareApp(dosarApp: string, caleFisier: string): string {
  const parti = path.relative(dosarApp, caleFisier).split(path.sep)
  if (parti[0] === 'assets') return MEMORARE_CU_AMPRENTA
  if (parti.length === 1 && parti[0] === 'index.html') return MEMORARE_INDEX
  return MEMORARE_FARA_AMPRENTA
}
