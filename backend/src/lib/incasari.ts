/**
 * Scrierea unei încasări.
 *
 * Există două drumuri prin care intră banii, și amândouă trec pe aici:
 *
 *   1. bifa „Achitat acum” la marcarea unei ședințe ca onorată
 *      (`PATCH /programari/:id/stare`),
 *   2. încasarea de pe fișă, care stinge mai multe ședințe cu o singură plată
 *      (`POST /vanzari/incasare`).
 *
 * Lăsate să-și scrie fiecare rândurile, cele două ajung să producă bonuri de
 * forme diferite pentru aceeași realitate — unul cu prețul din nomenclator,
 * altul cu cel convenit — și abia raportul de la sfârșit de lună o arată.
 */

import { totalLinie } from './bani.js'
import type { Executor } from './db.js'
import { unu } from './db.js'
import { eroareConflict, eroareValidare } from './erori.js'
import { punctImplicit, vanzareDetaliu } from './proiectii.js'
import { scrieJurnal } from './jurnal.js'
import { textOptional, verificaCantitate, verificaPret } from './validare.js'
import type { Articol, DateLinieVanzare, Programare, VanzareDetaliu } from '../types/database.js'

interface LiniePregatita {
  articol_id: string
  cantitate: number
  pret_unitar: number
  programare_id: string | null
}

/**
 * Validează o linie și îi fixează prețul, fără să o scrie.
 *
 * Prețul lipsă se completează din `articol.pret_lista` și apoi se COPIAZĂ pe
 * linie: o scumpire de mâine nu are voie să rescrie ce s-a încasat azi.
 */
export async function pregatesteLinie(
  ex: Executor,
  linie: DateLinieVanzare,
): Promise<LiniePregatita> {
  const articol = await unu<Articol>(
    ex, `SELECT * FROM articol WHERE id = $1`, [linie.articol_id], 'Articolul',
  )
  const cantitate = verificaCantitate(Number(linie.cantitate))
  const pret_unitar = verificaPret(
    linie.pret_unitar === undefined ? articol.pret_lista : Number(linie.pret_unitar),
    'pret_unitar',
  )

  return {
    articol_id: articol.id,
    cantitate,
    pret_unitar,
    programare_id: linie.programare_id ?? null,
  }
}

export interface DateIncasare {
  autor_id: string
  client_id: string
  /** Ședințele stinse de această plată, deja verificate de apelant. */
  programari: Programare[]
  /** Produsele cumpărate odată cu ea. */
  produse: DateLinieVanzare[]
  efectuat_la: string
  nota?: string | null
  adresa_ip?: string | null
}

/**
 * Scrie antetul, câte o linie pentru fiecare ședință stinsă, și liniile de
 * produs.
 *
 * Apelantul trebuie să fie deja într-o tranzacție: un antet fără linii nu
 * înseamnă nimic, iar o ședință stinsă de o linie a cărei încasare a eșuat ar
 * rămâne plătită de nimeni.
 */
export async function inregistreazaIncasare(
  ex: Executor,
  date: DateIncasare,
): Promise<VanzareDetaliu> {
  // Totul se validează înaintea primei scrieri: un produs inexistent nu are
  // voie să lase ședințele pe jumătate stinse.
  const liniiProduse: LiniePregatita[] = []
  for (const produs of date.produse) liniiProduse.push(await pregatesteLinie(ex, produs))

  const punct_lucru_id = date.programari[0]?.punct_lucru_id ?? (await punctImplicit(ex))

  const { rows } = await ex.query<{ id: string }>(
    `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, programare_id, efectuat_la, nota)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      date.client_id,
      punct_lucru_id,
      date.autor_id,
      // Legătura pe antet rămâne pentru compatibilitate cu §3, dar numai când
      // încasarea acoperă exact o ședință. Adevărul este pe linii.
      date.programari.length === 1 ? date.programari[0]!.id : null,
      date.efectuat_la,
      textOptional(date.nota),
    ],
  )
  const vanzare_id = rows[0]!.id

  const liniiSedinte: LiniePregatita[] = date.programari.map((p) => ({
    articol_id: p.articol_id,
    cantitate: 1,
    // Prețul convenit la programare, nu cel din nomenclatorul de azi.
    pret_unitar: Number(p.pret),
    programare_id: p.id,
  }))

  for (const linie of [...liniiSedinte, ...liniiProduse]) {
    await ex.query(
      `INSERT INTO vanzare_linie (vanzare_id, articol_id, cantitate, pret_unitar, programare_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [vanzare_id, linie.articol_id, linie.cantitate, linie.pret_unitar, linie.programare_id],
    )
  }

  await scrieJurnal(ex, {
    utilizator_id: date.autor_id,
    actiune: 'creare',
    entitate: 'vanzare',
    entitate_id: vanzare_id,
    date_noi: {
      client_id: date.client_id,
      efectuat_la: date.efectuat_la,
      programari_incasate: liniiSedinte.length,
      linii_produse: liniiProduse.length,
      total: [...liniiSedinte, ...liniiProduse]
        .reduce((s, l) => s + totalLinie(l.cantitate, l.pret_unitar), 0),
    },
    adresa_ip: date.adresa_ip ?? null,
  })

  return vanzareDetaliu(ex, vanzare_id)
}

/**
 * Ședințele pe care o plată chiar are voie să le stingă.
 *
 * Cele trei verificări sunt motivul pentru care încasarea este operațiune
 * proprie și nu un `POST /vanzari` cu linii compuse în interfață: fără ele s-ar
 * putea încasa ședința altui client, una care nu a avut loc, sau una plătită
 * deja. `FOR UPDATE` le ține blocate până la COMMIT, ca două recepții care
 * apasă în același timp să nu producă două bonuri pentru aceeași ședință.
 */
export async function programariDeStins(
  ex: Executor,
  client_id: string,
  programare_ids: readonly string[],
): Promise<Programare[]> {
  if (programare_ids.length === 0) return []

  const { rows } = await ex.query<Programare & { achitata: boolean }>(
    `SELECT p.*, EXISTS (
       SELECT 1 FROM vanzare_linie vl WHERE vl.programare_id = p.id
     ) AS achitata
     FROM programare p WHERE p.id = ANY($1)
     ORDER BY p.incepe_la
     FOR UPDATE OF p`,
    [programare_ids],
  )

  if (rows.length !== new Set(programare_ids).size) {
    throw eroareValidare('Una dintre ședințe nu mai există.', 'programare_ids')
  }
  for (const p of rows) {
    if (p.client_id !== client_id) {
      throw eroareValidare('Una dintre ședințe aparține altui client.', 'programare_ids')
    }
    if (p.stare !== 'onorat') {
      throw eroareValidare('Se pot încasa doar ședințele marcate ca onorate.', 'programare_ids')
    }
    if (p.achitata) {
      // 409, nu 400: datele trimise erau valide, altcineva a ajuns înaintea ta.
      throw eroareConflict('Una dintre ședințe este deja încasată.', {
        camp: 'programare_ids',
        detalii: { programare_id: p.id },
      })
    }
  }

  return rows
}
