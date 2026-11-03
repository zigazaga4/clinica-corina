/**
 * Avansul pe abonament — banii luați ÎNAINTE de ședințe.
 *
 * Cerința clinicii (2026-11-03): „i-am pus unei paciente un abonament, 1.000 de
 * lei, 4 ședințe. Ea n-a făcut ședința și vreau să pot să-i dau încasare. Dacă o
 * programez și o închid, mi se scade din abonament.” Până atunci banii intrau
 * doar pe o ședință onorată, deci un abonament plătit la început nu avea unde
 * să fie trecut fără să fie consumată o ședință.
 *
 * Cum stau lucrurile:
 *
 *   1. Încasarea pe abonament este un bon obișnuit, achitat acum, cu o linie la
 *      serviciul abonamentului, `tratament_id` pus și `programare_id` NULL.
 *      Acea linie este AVANSUL. Banii intră o singură dată, la `achitat_la` —
 *      Statisticile îi numără ca pe orice încasare.
 *
 *   2. Când o ședință a abonamentului devine „onorat”, avansul o stinge: partea
 *      ei se mută de pe linia de avans pe o linie a ședinței, în ACELAȘI bon.
 *      Dacă avansul acoperă mai mult, restul rămâne pe linia de avans, pentru
 *      ședințele următoare. Suma bonului nu se schimbă niciodată.
 *
 *   3. Scoasă din „onorat” (neprezentată, reprogramată, anulată), ședința își dă
 *      banii înapoi abonamentului: linia ei redevine avans.
 *
 * O ședință se stinge numai dintr-o SINGURĂ linie de avans care o acoperă
 * întreagă. Ședința are un singur loc pentru plată (`vanzare_linie_programare_uk`)
 * și un bon are o singură metodă, numerar sau card; o ședință plătită jumătate
 * cu un bon și jumătate cu altul n-ar avea nici unul, nici altul. Restul care nu
 * acoperă o ședință rămâne avans, vizibil pe abonament, iar ședința se încasează
 * ca de obicei.
 */

import { rotunjeste } from './bani.js'
import { multe, unu, type Executor } from './db.js'
import { eroareValidare } from './erori.js'
import { metodaPlataDin } from './incasari.js'
import { scrieJurnal } from './jurnal.js'
import { punctImplicit } from './proiectii.js'
import { tratamentDetaliu } from './tratamente.js'
import { numarCerut, textOptional, verificaPret } from './validare.js'
import type { Tratament } from '../types/database.js'

export interface DateAvans {
  tratament_id: string
  suma: unknown
  metoda_plata: unknown
  /** Momentul încasării; lipsă = acum. */
  efectuat_la: string
  nota?: unknown
  autor_id: string
  adresa_ip: string | null
}

/**
 * Scrie încasarea pe abonament și stinge, dacă sunt, ședințele deja onorate și
 * neplătite ale abonamentului. Apelantul este într-o tranzacție.
 *
 * Suma poate fi oricât, până la ce a mai rămas de încasat din prețul total:
 * peste, ar fi bani luați pentru ședințe pe care abonamentul nu le are.
 */
export async function incaseazaAvans(ex: Executor, date: DateAvans): Promise<void> {
  const tratament = await unu<Tratament & { arhivat_la: string | null }>(
    ex,
    `SELECT t.*, c.arhivat_la FROM tratament t JOIN client c ON c.id = t.client_id
     WHERE t.id = $1 FOR UPDATE OF t`,
    [date.tratament_id],
    'Tratamentul',
  )
  if (tratament.incheiat_la !== null) {
    throw eroareValidare(
      'Abonamentul este încheiat; redeschide-l înainte de a încasa pe el.',
      'suma',
    )
  }
  if (tratament.arhivat_la !== null) {
    throw eroareValidare('Clientul este arhivat; dezarhivează-l înainte de a-i scrie o încasare.', 'suma')
  }

  const suma = verificaPret(numarCerut(date.suma, 'suma', 'Suma'), 'suma')
  if (suma <= 0) throw eroareValidare('Suma încasată trebuie să fie mai mare ca zero.', 'suma')

  const metoda_plata = metodaPlataDin(date.metoda_plata)
  if (metoda_plata === null) throw eroareValidare('Alege cum s-a plătit: numerar sau card.', 'metoda_plata')

  // Ce a mai rămas de încasat din preț: totalul, minus ședințele plătite și avansul.
  const stare = await tratamentDetaliu(ex, date.tratament_id)
  const deIncasat = rotunjeste(Number(stare.pret_total) - Number(stare.incasat) - Number(stare.avans))
  if (suma > deIncasat) {
    throw eroareValidare(
      deIncasat > 0
        ? `Din abonament au mai rămas de încasat ${deIncasat} lei; suma trece peste.`
        : 'Abonamentul este deja încasat în întregime.',
      'suma',
    )
  }

  const { rows } = await ex.query<{ id: string }>(
    `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, programare_id, efectuat_la, nota, achitat_la, metoda_plata)
     VALUES ($1, $2, $3, NULL, $4, $5, $4, $6) RETURNING id`,
    [
      tratament.client_id,
      await punctImplicit(ex),
      date.autor_id,
      date.efectuat_la,
      textOptional(date.nota),
      metoda_plata,
    ],
  )
  const vanzare_id = rows[0]!.id

  await ex.query(
    `INSERT INTO vanzare_linie (vanzare_id, articol_id, cantitate, pret_unitar, programare_id, tratament_id)
     VALUES ($1, $2, 1, $3, NULL, $4)`,
    [vanzare_id, tratament.articol_id, suma, tratament.id],
  )

  await scrieJurnal(ex, {
    utilizator_id: date.autor_id,
    actiune: 'creare',
    entitate: 'vanzare',
    entitate_id: vanzare_id,
    date_noi: {
      client_id: tratament.client_id,
      efectuat_la: date.efectuat_la,
      metoda_plata,
      avans_pe_tratament: tratament.id,
      total: suma,
    },
    adresa_ip: date.adresa_ip,
  })

  await stingeDinAvans(ex, tratament.id, date.autor_id, date.adresa_ip)
}

/**
 * Stinge din avans ședințele onorate și neplătite ale unui abonament, cea mai
 * veche întâi. Întoarce ședințele stinse.
 *
 * `doarSedintele` limitează la ședințele unei programări care tocmai a fost
 * marcată onorată: restul abonamentului nu are de ce să fie atins atunci.
 */
export async function stingeDinAvans(
  ex: Executor,
  tratament_id: string,
  autor_id: string,
  adresa_ip: string | null,
  doarSedintele?: readonly string[],
): Promise<string[]> {
  const sedinte = await multe<{ id: string; pret: number }>(
    ex,
    `SELECT p.id, p.pret FROM programare p
     WHERE p.tratament_id = $1 AND p.stare = 'onorat' AND p.pret > 0
       AND NOT EXISTS (SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id)
       AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
     ORDER BY p.incepe_la, p.creat_la, p.id
     FOR UPDATE OF p`,
    [tratament_id, doarSedintele ?? null],
  )

  const stinse: string[] = []
  for (const sedinta of sedinte) {
    const pret = rotunjeste(Number(sedinta.pret))
    // Citite din nou la fiecare ședință: cea de dinainte tocmai a scăzut o linie.
    const avansuri = await multe<{ id: string; vanzare_id: string; articol_id: string; total_linie: number }>(
      ex,
      `SELECT vl.id, vl.vanzare_id, vl.articol_id, vl.total_linie
       FROM vanzare_linie vl JOIN vanzare v ON v.id = vl.vanzare_id
       WHERE vl.tratament_id = $1 AND vl.programare_id IS NULL AND v.achitat_la IS NOT NULL
       ORDER BY v.achitat_la, vl.id
       FOR UPDATE OF vl`,
      [tratament_id],
    )
    const linie = avansuri.find((a) => rotunjeste(Number(a.total_linie)) >= pret)
    if (!linie) continue

    const rest = rotunjeste(Number(linie.total_linie) - pret)
    if (rest <= 0) {
      await ex.query(`UPDATE vanzare_linie SET programare_id = $2 WHERE id = $1`, [linie.id, sedinta.id])
    } else {
      // `cantitate = 1`: linia de avans este mereu „o bucată, cât s-a luat”.
      await ex.query(
        `UPDATE vanzare_linie SET cantitate = 1, pret_unitar = $2 WHERE id = $1`,
        [linie.id, rest],
      )
      await ex.query(
        `INSERT INTO vanzare_linie (vanzare_id, articol_id, cantitate, pret_unitar, programare_id, tratament_id)
         VALUES ($1, $2, 1, $3, $4, $5)`,
        [linie.vanzare_id, linie.articol_id, pret, sedinta.id, tratament_id],
      )
    }

    await scrieJurnal(ex, {
      utilizator_id: autor_id,
      actiune: 'modificare',
      entitate: 'vanzare',
      entitate_id: linie.vanzare_id,
      date_noi: { avans_stins_de_sedinta: sedinta.id, suma: pret, ramas_in_avans: rest },
      adresa_ip,
    })
    stinse.push(sedinta.id)
  }
  return stinse
}

/**
 * Dă banii înapoi abonamentului pentru ședințele care nu mai sunt „onorat”.
 *
 * Doar liniile care au venit din avans (`tratament_id` pus): o ședință plătită
 * direct, la casă, rămâne plătită oricum — corectura ei se face din bon, ca
 * înainte. Întoarce ședințele ale căror bani s-au întors.
 */
export async function elibereazaAvansul(
  ex: Executor,
  programare_ids: readonly string[],
  autor_id: string,
  adresa_ip: string | null,
): Promise<string[]> {
  if (programare_ids.length === 0) return []
  const linii = await multe<{ id: string; vanzare_id: string; programare_id: string; total_linie: number }>(
    ex,
    `SELECT id, vanzare_id, programare_id, total_linie FROM vanzare_linie
     WHERE programare_id = ANY($1::uuid[]) AND tratament_id IS NOT NULL
     FOR UPDATE`,
    [programare_ids],
  )
  for (const linie of linii) {
    await ex.query(`UPDATE vanzare_linie SET programare_id = NULL WHERE id = $1`, [linie.id])
    await scrieJurnal(ex, {
      utilizator_id: autor_id,
      actiune: 'modificare',
      entitate: 'vanzare',
      entitate_id: linie.vanzare_id,
      date_noi: {
        avans_eliberat_de_sedinta: linie.programare_id,
        suma: rotunjeste(Number(linie.total_linie)),
      },
      adresa_ip,
    })
  }
  return linii.map((l) => l.programare_id)
}
