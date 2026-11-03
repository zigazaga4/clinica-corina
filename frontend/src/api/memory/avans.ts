/**
 * Avansul pe abonament, în memorie — gemenul lui `backend/src/lib/avans.ts`.
 *
 * Banii luați pe un abonament înainte de ședințe stau pe o linie de vânzare cu
 * `tratament_id` și fără `programare_id`. Când o ședință a abonamentului devine
 * onorată, suma ei se mută pe o linie a ședinței, în ACELAȘI bon; scoasă din
 * „onorat”, ședința își dă banii înapoi. Regulile sunt cele de pe server:
 *
 *   - o ședință se stinge numai dintr-o SINGURĂ linie de avans care o acoperă
 *     întreagă (cea mai veche întâi); restul care nu ajunge rămâne avans;
 *   - suma bonului nu se schimbă niciodată, deci nici ziua în care au intrat banii.
 */

import { uuid } from '@/lib/id'
import { rotunjeste, totalLinie } from '@/lib/money'
import type { Programare, Uuid, VanzareLinie } from '@/domain/types'
import { incasareaProgramarii } from './hydrate'
import { scrieJurnal } from './journal'
import { magazin } from './store'

/** Liniile de avans ale unui abonament, cele mai vechi plăți întâi. */
function liniiDeAvans(tratament_id: Uuid): VanzareLinie[] {
  const linii: { linie: VanzareLinie; achitat_la: string }[] = []
  for (const linie of magazin.vanzare_linie.values()) {
    if (linie.tratament_id !== tratament_id || linie.programare_id !== null) continue
    const achitat_la = magazin.vanzare.get(linie.vanzare_id)?.achitat_la
    if (!achitat_la) continue
    linii.push({ linie, achitat_la })
  }
  linii.sort((a, b) => a.achitat_la.localeCompare(b.achitat_la) || a.linie.id.localeCompare(b.linie.id))
  return linii.map((l) => l.linie)
}

/**
 * Stinge din avans ședințele onorate și neplătite ale unui abonament, cea mai
 * veche întâi. Întoarce ședințele stinse.
 *
 * `doarSedintele` limitează la ședințele unei programări care tocmai a fost
 * marcată onorată: restul abonamentului nu are de ce să fie atins atunci.
 */
export function stingeDinAvans(
  tratament_id: Uuid,
  autor_id: Uuid,
  doarSedintele?: readonly Uuid[],
): Uuid[] {
  const sedinte: Programare[] = []
  for (const p of magazin.programare.values()) {
    if (p.tratament_id !== tratament_id || p.stare !== 'onorat' || !(p.pret > 0)) continue
    if (doarSedintele && !doarSedintele.includes(p.id)) continue
    if (incasareaProgramarii(p.id) !== null) continue
    sedinte.push(p)
  }
  sedinte.sort(
    (a, b) =>
      a.incepe_la.localeCompare(b.incepe_la) || a.creat_la.localeCompare(b.creat_la) || a.id.localeCompare(b.id),
  )

  const stinse: Uuid[] = []
  for (const sedinta of sedinte) {
    const pret = rotunjeste(sedinta.pret)
    const linie = liniiDeAvans(tratament_id).find((l) => rotunjeste(l.total_linie) >= pret)
    if (!linie) continue

    const rest = rotunjeste(linie.total_linie - pret)
    if (rest <= 0) {
      linie.programare_id = sedinta.id
    } else {
      // „O bucată, cât s-a luat”: linia de avans rămâne cu restul.
      linie.cantitate = 1
      linie.pret_unitar = rest
      linie.total_linie = totalLinie(1, rest)
      const pentruSedinta: VanzareLinie = {
        id: uuid(),
        vanzare_id: linie.vanzare_id,
        articol_id: linie.articol_id,
        cantitate: 1,
        pret_unitar: pret,
        total_linie: totalLinie(1, pret),
        programare_id: sedinta.id,
        tratament_id,
      }
      magazin.vanzare_linie.set(pentruSedinta.id, pentruSedinta)
    }

    scrieJurnal({
      utilizator_id: autor_id,
      actiune: 'modificare',
      entitate: 'vanzare',
      entitate_id: linie.vanzare_id,
      date_noi: { avans_stins_de_sedinta: sedinta.id, suma: pret, ramas_in_avans: rest },
    })
    stinse.push(sedinta.id)
  }
  return stinse
}

/**
 * Dă banii înapoi abonamentului pentru ședințele care nu mai sunt „onorat”.
 *
 * Doar liniile care au venit din avans (`tratament_id` pus): o ședință plătită
 * direct, la casă, rămâne plătită oricum. Întoarce ședințele ale căror bani
 * s-au întors.
 */
export function elibereazaAvansul(programare_ids: readonly Uuid[], autor_id: Uuid): Uuid[] {
  const eliberate: Uuid[] = []
  for (const linie of magazin.vanzare_linie.values()) {
    if (linie.programare_id === null || linie.tratament_id === null) continue
    if (!programare_ids.includes(linie.programare_id)) continue
    eliberate.push(linie.programare_id)
    scrieJurnal({
      utilizator_id: autor_id,
      actiune: 'modificare',
      entitate: 'vanzare',
      entitate_id: linie.vanzare_id,
      date_noi: {
        avans_eliberat_de_sedinta: linie.programare_id,
        suma: rotunjeste(linie.total_linie),
      },
    })
    linie.programare_id = null
  }
  return eliberate
}
