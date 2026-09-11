/**
 * Aducerea fonturilor cu care se tipărește acordul.
 *
 * Stă separat de `pdf.ts` dinadins. Desenarea documentului nu are voie să
 * știe de unde vin octeții: primește fonturile ca parametru și, din aceleași
 * blocuri, scoate mereu același fișier. Aici, dimpotrivă, totul ține de
 * împachetare — `?url` este o vorbă pe care o înțelege numai Vite, iar
 * `fetch` are nevoie de o fereastră de browser. Ținute la un loc, nici
 * probele nu ar mai putea rula fără server, nici un script de mână nu ar mai
 * putea genera un acord de verificat.
 *
 * Fișierele NU intră în pachetul de JavaScript: rămân două fișiere aduse la
 * cerere. Sunt aproape un megaoctet împreună și nu folosesc la nimic până
 * când cineva chiar semnează ceva — iar atunci sunt pe disc, lângă aplicație.
 *
 * Fira Sans, fiindcă are „ș” și „ț” cu VIRGULĂ dedesubt, nu cu sedilă. Multe
 * fonturi au doar varianta turcească, iar „Ştefan” în loc de „Ștefan” pe un
 * act semnat este exact genul de greșeală pe care nimeni nu o observă la timp
 * și nimeni nu o mai poate repara după.
 */

import type { FonturiAcord } from './pdf'
import urlNormal from './fonturi/FiraSans-Regular.ttf?url'
import urlGras from './fonturi/FiraSans-Bold.ttf?url'

/** Aduse o singură dată; a doua semnătură din aceeași zi nu mai așteaptă. */
let pastrate: FonturiAcord | undefined

export async function incarcaFonturi(): Promise<FonturiAcord> {
  if (pastrate) return pastrate

  const ia = async (url: string) => {
    const raspuns = await fetch(url)
    if (!raspuns.ok) throw new Error(`Fontul nu a putut fi încărcat (${raspuns.status}).`)
    return new Uint8Array(await raspuns.arrayBuffer())
  }

  const [normal, gras] = await Promise.all([ia(urlNormal), ia(urlGras)])
  pastrate = { normal, gras }
  return pastrate
}
