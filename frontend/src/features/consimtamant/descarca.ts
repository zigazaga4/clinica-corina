/**
 * Scoaterea acordului semnat din bază și așezarea lui pe disc.
 *
 * Documentul stă în baza de date, nu ca fișier. Ca să ajungă în mâna cuiva —
 * la un control, la cererea clientului — trebuie scris undeva. Aici sunt două
 * lumi diferite, și de aceea modulul are două drumuri:
 *
 *   - În aplicația instalată, pagina trăiește într-o fereastră de browser, iar
 *     un browser nu are voie să scrie fișiere. Scrierea o face partea de
 *     Windows a aplicației, prin `plugin-fs`, îngrădită din
 *     `capabilities/acorduri.json` NUMAI la dosarul Documente.
 *   - În browser (modul demonstrativ) nu există așa ceva, așa că se folosește
 *     descărcarea obișnuită, cu o legătură `download`.
 *
 * Dosarul este fix, nu ales de fiecare dată. La recepție, cu clientul în față,
 * o fereastră de „Salvează ca…” la fiecare acord este o piedică, iar acordurile
 * risipite prin dosare aleatorii nu se mai găsesc când chiar trebuie. Toate
 * ajung în „Documente / Acorduri GDPR”, cu numele clientului și data în titlu.
 *
 * Dacă „Documente” nu se lasă scris (pe un calculator din recepție s-a întâmplat,
 * 16 nov. 2026: dosar mutat în OneDrive, protecția Windows împotriva
 * ransomware-ului ș.a.), acordul nu se pierde: merge în „Descărcări”, iar la
 * nevoie pe drumul browserului. Abia dacă toate cad se arată eroarea — cu
 * motivul fiecăreia, ca să se poată repara.
 */

import { isTauri } from '@tauri-apps/api/core'

/** Dosarul în care se adună acordurile, sub „Documente”. */
export const DOSAR_ACORDURI = 'Acorduri GDPR'

/** Unde a ajuns fișierul și dacă mai poate fi deschis de noi. */
export interface Salvare {
  /** Calea sau numele arătat omului. */
  nume: string
  /** Calea întreagă, doar în aplicația instalată; browserul nu o cunoaște. */
  cale: string | null
  /** Unde a ajuns, pe înțeles: „Documente › Acorduri GDPR”, „Descărcări”. */
  loc: string
}

/** Motivul unui eșec, oricum ar fi aruncat: Tauri respinge cu text simplu. */
function motiv(cauza: unknown): string {
  if (cauza instanceof Error) return cauza.message
  if (typeof cauza === 'string') return cauza
  return String(cauza)
}

/** Descărcarea obișnuită a browserului, în dosarul de descărcări al omului. */
function descarcaPrinBrowser(pdf: Blob, nume: string): void {
  const adresa = URL.createObjectURL(pdf)
  const legatura = document.createElement('a')
  legatura.href = adresa
  legatura.download = nume
  document.body.appendChild(legatura)
  legatura.click()
  legatura.remove()
  // Adresa ține fișierul în memorie până e eliberată. Se așteaptă o clipă,
  // fiindcă descărcarea pornește după clic, nu în timpul lui.
  setTimeout(() => URL.revokeObjectURL(adresa), 10_000)
}

/**
 * Curăță numele fișierului.
 *
 * Windows refuză \ / : * ? " < > | în numele fișierelor, iar un client numit
 * „Ion/Maria” ar fi făcut scrierea să eșueze cu un mesaj de nedeslușit.
 * Punctele de la capăt sunt și ele scoase: Windows le taie singur și numele
 * ajunge altul decât cel arătat.
 */
export function numeCurat(text: string): string {
  return (
    text
      .replace(/[\\/:*?"<>|]/g, '-')
      // Caracterele de control nu au ce căuta într-un nume de fișier.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.+$/, '')
      .slice(0, 80) || 'acord'
  )
}

/** „Gabriela Nistor - 2026-09-11.pdf” — se sortează singur după dată. */
export function numeFisier(client: string, semnatLa: string): string {
  const d = new Date(semnatLa)
  const zi = Number.isNaN(d.getTime()) ? 'fara-data' : d.toISOString().slice(0, 10)
  return `${numeCurat(client)} - ${zi}.pdf`
}

/**
 * Scrie acordul pe disc și spune unde a ajuns.
 *
 * Modulele de Tauri se aduc abia acum, nu de sus: în browser nu există, iar
 * importate static ar fi intrat în pachetul paginii pentru toată lumea.
 */
export async function salveazaAcord(pdf: Blob, client: string, semnatLa: string): Promise<Salvare> {
  const nume = numeFisier(client, semnatLa)

  if (!isTauri()) {
    descarcaPrinBrowser(pdf, nume)
    return { nume, cale: null, loc: 'Descărcări' }
  }

  const [{ mkdir, writeFile }, { documentDir, downloadDir, join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  const octeti = new Uint8Array(await pdf.arrayBuffer())

  /*
    Căi ÎNTREGI, cu despărțitorul sistemului, nu „dosar/fișier” relativ la
    `baseDir`: pe Windows calea relativă ieșea cu „/” amestecat printre „\”, iar
    verificarea dosarelor permise a aplicației o putea refuza.
  */
  const incercari: { loc: string; dosar: () => Promise<string> }[] = [
    {
      loc: `Documente › ${DOSAR_ACORDURI}`,
      dosar: async () => join(await documentDir(), DOSAR_ACORDURI),
    },
    { loc: 'Descărcări', dosar: downloadDir },
  ]

  const esecuri: string[] = []
  for (const { loc, dosar } of incercari) {
    try {
      const cale = await dosar()
      // `recursive` face dosarul dacă lipsește și tace dacă există deja.
      await mkdir(cale, { recursive: true })
      const fisier = await join(cale, nume)
      await writeFile(fisier, octeti)
      return { nume, cale: fisier, loc }
    } catch (cauza) {
      esecuri.push(`${loc}: ${motiv(cauza)}`)
    }
  }

  // Ultima scăpare: descărcarea ferestrei, ca într-un browser.
  try {
    descarcaPrinBrowser(pdf, nume)
    return { nume, cale: null, loc: 'Descărcări' }
  } catch (cauza) {
    esecuri.push(`descărcare: ${motiv(cauza)}`)
  }
  throw new Error(`Fișierul nu a putut fi scris. ${esecuri.join(' · ')}`)
}

/** Deschide fișierul salvat în cititorul obișnuit de PDF. */
export async function deschideAcord(cale: string): Promise<void> {
  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(cale)
}
