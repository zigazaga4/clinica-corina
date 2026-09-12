/**
 * Regulile tratamentului — un serviciu făcut în mai multe ședințe.
 *
 * Două rute au nevoie de ele: `/tratamente`, care le arată și le închide, și
 * `/programari`, care la fiecare ședință nouă trebuie să știe în ce tratament
 * intră și cât din prețul lui îi revine. Puse aici, o singură dată, cele două
 * nu pot ajunge să socotească diferit aceeași ședință.
 *
 * Nimic nu se ține la zi de mână. Câte ședințe s-au făcut, cât s-a încasat și
 * cât mai e de împărțit sunt coloane ale vederii `v_tratament_detaliu`, numărate
 * din programări la fiecare citire.
 */

import { multe, unu, unuSauNimic, type Executor } from './db.js'
import { eroareConflict, eroareValidare } from './erori.js'
import { adresaCererii, instantaneu, scrieJurnal } from './jurnal.js'
import { textOptional, verificaNumarSedinte, verificaPret } from './validare.js'
import type { Articol, Tratament, TratamentDetaliu } from '../types/database.js'
import type { Request } from 'express'

export const DIN_TRATAMENTE = 'SELECT * FROM v_tratament_detaliu'

export function tratamenteDetaliu(
  ex: Executor,
  where = '',
  values: unknown[] = [],
  ordine = 'ORDER BY creat_la DESC',
): Promise<TratamentDetaliu[]> {
  return multe<TratamentDetaliu>(ex, `${DIN_TRATAMENTE} ${where} ${ordine}`, values)
}

export function tratamentDetaliu(ex: Executor, id: string): Promise<TratamentDetaliu> {
  return unu<TratamentDetaliu>(ex, `${DIN_TRATAMENTE} WHERE id = $1`, [id], 'Tratamentul')
}

/**
 * Tratamentul ÎN CURS al unui client pentru un serviciu, dacă există.
 *
 * Cel mult unul: indexul parțial `tratament_in_curs_uk` o garantează. Blocat
 * `FOR UPDATE` când urmează o ședință nouă în el, ca două recepții care
 * programează în același timp să numere locurile pe rând, nu deodată.
 */
export async function tratamentInCurs(
  ex: Executor,
  client_id: string,
  articol_id: string,
  blocheaza = false,
): Promise<Tratament | null> {
  return unuSauNimic<Tratament>(
    ex,
    `SELECT * FROM tratament
     WHERE client_id = $1 AND articol_id = $2 AND incheiat_la IS NULL
     ${blocheaza ? 'FOR UPDATE' : ''}`,
    [client_id, articol_id],
  )
}

/**
 * Prețul cu care se deschide un tratament nou pentru acest client.
 *
 * Aceeași regulă ca „prețul reținut” al ședinței simple: ce s-a convenit
 * ultima dată cu omul pentru acest serviciu dictează, altfel nomenclatorul.
 * Aici „ultima dată” este tratamentul precedent, nu o ședință — și doar dacă
 * avea ACELAȘI număr de ședințe: 400 de lei conveniți pentru patru veniri nu
 * spun nimic despre cât costă trei.
 */
export async function pretTotalPentru(
  ex: Executor,
  client_id: string,
  articol: Articol,
): Promise<{ pret_total: number; din_istoric: boolean }> {
  const precedent = await unuSauNimic<{ pret_total: number; numar_sedinte: number }>(
    ex,
    `SELECT pret_total, numar_sedinte FROM tratament
     WHERE client_id = $1 AND articol_id = $2
     ORDER BY creat_la DESC LIMIT 1`,
    [client_id, articol.id],
  )
  const pret_lista = Number(articol.pret_lista)
  if (
    !precedent
    || precedent.numar_sedinte !== articol.numar_sedinte
    || Number(precedent.pret_total) === pret_lista
  ) {
    return { pret_total: pret_lista, din_istoric: false }
  }
  return { pret_total: Number(precedent.pret_total), din_istoric: true }
}

export interface DateTratamentNou {
  client_id: string
  articol: Articol
  numar_sedinte?: unknown
  pret_total?: unknown
  nota?: unknown
  autor_id: string
  adresa_ip: string | null
}

/**
 * Deschide un tratament. Numărul de ședințe și prețul lipsă se iau din
 * nomenclator (prețul, prin memoria clientului) și se COPIAZĂ: o schimbare de
 * mâine în nomenclator nu rescrie ce s-a convenit azi.
 *
 * Refuză cu 409 dacă omul are deja unul în curs la același serviciu — ședința
 * nouă trebuie să intre în acela, nu să deschidă un al doilea.
 */
export async function deschideTratament(ex: Executor, date: DateTratamentNou): Promise<Tratament> {
  const { articol } = date
  if (articol.tip !== 'serviciu') {
    throw eroareValidare('Un tratament se face dintr-un serviciu, nu dintr-un produs.', 'articol_id')
  }

  /*
    Blocaj consultativ pe perechea (client, serviciu), înaintea căutării.

    Fără el, două cereri simultane — recepția și telefonul — ar găsi amândouă
    „niciun tratament în curs” și ar încerca amândouă să deschidă unul; a doua
    ar cădea pe `tratament_in_curs_uk` cu un 409 sec, deși voia doar să pună
    o ședință în tratamentul pe care prima tocmai l-a deschis. Cu blocajul,
    a doua așteaptă și îl găsește.
  */
  await ex.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [date.client_id, articol.id])

  const existent = await tratamentInCurs(ex, date.client_id, articol.id)
  if (existent) {
    throw eroareConflict(
      'Clientul are deja un tratament în curs pentru acest serviciu; ședințele noi intră în el.',
      { camp: 'articol_id', detalii: { tratament_id: existent.id } },
    )
  }

  const numar_sedinte = date.numar_sedinte == null
    ? articol.numar_sedinte
    : verificaNumarSedinte(date.numar_sedinte)
  const pret_total = date.pret_total == null
    ? (await pretTotalPentru(ex, date.client_id, articol)).pret_total
    : verificaPret(Number(date.pret_total), 'pret_total')

  const { rows } = await ex.query<Tratament>(
    `INSERT INTO tratament (client_id, articol_id, articol_tip, numar_sedinte, pret_total, nota, creat_de)
     VALUES ($1, $2, 'serviciu', $3, $4, $5, $6) RETURNING *`,
    [date.client_id, articol.id, numar_sedinte, pret_total, textOptional(date.nota, 'nota', 'Nota'), date.autor_id],
  )
  const rand = rows[0]!

  await scrieJurnal(ex, {
    utilizator_id: date.autor_id,
    actiune: 'creare',
    entitate: 'tratament',
    entitate_id: rand.id,
    date_noi: instantaneu(rand as unknown as Record<string, unknown>),
    adresa_ip: date.adresa_ip,
  })

  return rand
}

/**
 * Tratamentul în care intră o ședință nouă, cu locul ei și partea ei de preț.
 *
 * Trei drumuri, în ordinea în care le încearcă:
 *   1. `tratament_id` trimis explicit — se verifică să fie al clientului, pentru
 *      același serviciu și încă în curs;
 *   2. nimic trimis — tratamentul în curs al clientului la acest serviciu,
 *      dacă are unul (chiar deschis de mână, pentru un serviciu care de obicei
 *      se face dintr-o venire); altfel unul nou, dacă serviciul se face în mai
 *      multe ședințe;
 *   3. serviciu dintr-o singură venire, fără tratament deschis — nu intră în
 *      niciun tratament.
 *
 * Refuză o ședință peste numărul convenit: a noua într-un tratament de opt nu
 * e „încă una”, e o greșeală sau o înțelegere nouă — care se scrie pe
 * tratament (mai multe ședințe) sau se începe după încheierea lui.
 */
export async function tratamentulSedintei(
  ex: Executor,
  cerere: {
    client_id: string
    articol: Articol
    tratament_id: unknown
    autor_id: string
    req: Request
  },
): Promise<{ tratament: TratamentDetaliu; pret: number } | null> {
  const { client_id, articol } = cerere
  let tratament: Tratament | null = null

  if (typeof cerere.tratament_id === 'string' && cerere.tratament_id !== '') {
    tratament = await unu<Tratament>(
      ex, `SELECT * FROM tratament WHERE id = $1 FOR UPDATE`, [cerere.tratament_id], 'Tratamentul',
    )
    if (tratament.client_id !== client_id) {
      throw eroareValidare('Tratamentul ales aparține altui client.', 'tratament_id')
    }
    if (tratament.articol_id !== articol.id) {
      throw eroareValidare('Tratamentul ales este pentru alt serviciu.', 'tratament_id')
    }
    if (tratament.incheiat_la !== null) {
      throw eroareValidare(
        'Tratamentul este încheiat; redeschide-l sau începe unul nou.', 'tratament_id',
      )
    }
  } else {
    await ex.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [client_id, articol.id])
    tratament = await tratamentInCurs(ex, client_id, articol.id, true)
    if (!tratament && articol.numar_sedinte > 1) {
      tratament = await deschideTratament(ex, {
        client_id, articol, autor_id: cerere.autor_id, adresa_ip: adresaCererii(cerere.req),
      })
    }
  }

  if (!tratament) return null

  const detaliu = await tratamentDetaliu(ex, tratament.id)
  if (detaliu.sedinte_ramase <= 0) {
    throw eroareConflict(
      `Tratamentul are deja toate cele ${detaliu.numar_sedinte} ședințe programate sau făcute. ` +
        'Mărește numărul de ședințe pe tratament sau încheie-l și începe altul.',
      { camp: 'tratament_id', detalii: { tratament_id: detaliu.id } },
    )
  }

  return { tratament: detaliu, pret: Number(detaliu.pret_urmatoarea) }
}

/**
 * Încheie tratamentul singur când s-au onorat toate ședințele lui.
 *
 * Se cheamă după orice schimbare de stare a unei ședințe. Numărătoarea e a
 * vederii; aici doar se pune data. Drumul invers — o ședință readusă din
 * „onorat” — NU redeschide tratamentul: a fost încheiat cu bună știință sau
 * s-a încheiat de la sine, iar recepția îl redeschide de mână dacă vrea.
 */
export async function incheieDacaEComplet(
  ex: Executor,
  tratament_id: string | null,
  autor_id: string,
  adresa_ip: string | null,
): Promise<void> {
  if (tratament_id === null) return
  const t = await tratamentDetaliu(ex, tratament_id)
  if (t.incheiat_la !== null || t.sedinte_onorate < t.numar_sedinte) return

  const { rows } = await ex.query<{ incheiat_la: string }>(
    `UPDATE tratament SET incheiat_la = now() WHERE id = $1 AND incheiat_la IS NULL RETURNING incheiat_la`,
    [tratament_id],
  )
  if (rows.length === 0) return

  await scrieJurnal(ex, {
    utilizator_id: autor_id,
    actiune: 'modificare',
    entitate: 'tratament',
    entitate_id: tratament_id,
    date_vechi: { incheiat_la: null },
    date_noi: { incheiat_la: rows[0]!.incheiat_la, motiv: 'toate ședințele onorate' },
    adresa_ip,
  })
}
