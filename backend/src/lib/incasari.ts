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

import { sumaTotal, totalLinie } from './bani.js'
import type { Executor } from './db.js'
import { unu } from './db.js'
import { eroareConflict, eroareValidare } from './erori.js'
import { punctImplicit, vanzareDetaliu } from './proiectii.js'
import { scrieJurnal } from './jurnal.js'
import { textOptional, verificaCantitate, verificaPret } from './validare.js'
import type { Articol, DateLinieVanzare, MetodaPlata, Programare, VanzareDetaliu } from '../types/database.js'

/** Metodele pe care le alege recepția la o încasare (cerința clinicii, 2026-10-01). */
export const METODE_PLATA_VANZARE = ['numerar', 'card'] as const

/**
 * `metoda_plata` din corpul cererii.
 *
 * Lipsă = nespecificată (NULL): aplicațiile instalate dinainte de alegere nu o
 * trimit, iar o încasare refuzată pentru asta ar fi lăsat clienta la recepție
 * fără bon până la actualizare. Interfața de acum o cere mereu.
 */
export function metodaPlataDin(valoare: unknown): MetodaPlata | null {
  if (valoare === undefined || valoare === null || valoare === '') return null
  if (!(METODE_PLATA_VANZARE as readonly unknown[]).includes(valoare)) {
    throw eroareValidare('Alege cum s-a plătit: numerar sau card.', 'metoda_plata')
  }
  return valoare as MetodaPlata
}

/** Maximul coloanei generate `total_linie numeric(12,2)`: 10 cifre înainte de virgulă. */
const LIMITA_TOTAL_LINIE = 9_999_999_999.99

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
 *
 * Produsul poate veni de pe ORICE listă de prețuri. Lista o alege recepția —
 * fila din Nomenclator de pe care vinde (cerința clinicii, 5 oct. 2026: de pe
 * „Produse colaboratori” se vinde din lista colaboratorilor). Serverul nu are
 * de unde ști dacă cel de pe bon e clientă sau colaborator: amândoi sunt
 * `client`.
 */
export async function pregatesteLinie(
  ex: Executor,
  linie: DateLinieVanzare,
): Promise<LiniePregatita> {
  const articol = await unu<Articol>(
    ex, `SELECT * FROM articol WHERE id = $1`, [linie.articol_id], 'Articolul',
  )
  const cantitate = verificaCantitate(Number(linie.cantitate))
  /*
    `== null` prinde și `undefined`, și `null`.

    Cu `=== undefined`, un formular care trimite câmpul de preț gol ca `null`
    nu cădea pe prețul din nomenclator, ci ajungea la `Number(null)`, adică
    zero: marfa pleca pe gratis, cu bon de 201 și total 0. Lipsa prețului
    înseamnă „ia-l din nomenclator”, indiferent cum a fost scrisă.
  */
  const pret_unitar = verificaPret(
    linie.pret_unitar == null ? articol.pret_lista : Number(linie.pret_unitar),
    'pret_unitar',
  )

  /*
    Produsul se verifică separat de factorii lui.

    `total_linie` este coloană generată, `numeric(12,2)`. Fiecare factor poate
    încăpea în limita lui — 1000 de bucăți, 99.999.999,99 lei — și totuși
    produsul să nu încapă. Verificat doar pe factori, cazul acesta trecea de
    validare și cădea abia în bază, cu 500 și fără să spună care câmp e de vină:
    niciunul singur nu era.
  */
  const total = totalLinie(cantitate, pret_unitar)
  if (total > LIMITA_TOTAL_LINIE) {
    throw eroareValidare(
      `Totalul liniei (${total}) depășește maximul acceptat de ${LIMITA_TOTAL_LINIE}.`,
      'cantitate',
    )
  }

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
  /** Numerar sau card; NULL = nespecificată. */
  metoda_plata?: MetodaPlata | null
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

  // Achitată în momentul ei, `$5` de două ori: încasarea este chiar plata, iar
  // cea trecută seara pentru dimineață a intrat dimineața, nu la introducere.
  const { rows } = await ex.query<{ id: string }>(
    `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, programare_id, efectuat_la, nota, achitat_la, metoda_plata)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $7) RETURNING id`,
    [
      date.client_id,
      punct_lucru_id,
      date.autor_id,
      // Legătura pe antet rămâne pentru compatibilitate cu §3, dar numai când
      // încasarea acoperă exact o ședință. Adevărul este pe linii.
      date.programari.length === 1 ? date.programari[0]!.id : null,
      date.efectuat_la,
      textOptional(date.nota),
      date.metoda_plata ?? null,
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
      metoda_plata: date.metoda_plata ?? null,
      programari_incasate: liniiSedinte.length,
      linii_produse: liniiProduse.length,
      /*
        `sumaTotal`, nu `reduce`: adunarea directă a zecimalelor lasă urma
        virgulei mobile. Două ședințe de 0,10 și 0,20 lei ajungeau în jurnal ca
        0.30000000000000004, în timp ce răspunsul către interfață arăta 0,30 —
        adică tocmai registrul care ar trebui să fie de încredere spunea altceva
        decât bonul. Toate celelalte totaluri trec deja pe aici.
      */
      total: sumaTotal(
        [...liniiSedinte, ...liniiProduse].map((l) => totalLinie(l.cantitate, l.pret_unitar)),
      ),
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

/**
 * Aceleași trei reguli, pentru liniile scrise direct pe un bon.
 *
 * `programariDeStins` apăra doar `POST /vanzari/incasare`. Dar o linie de bon
 * poate purta ea însăși un `programare_id`, iar pe acel drum nu verifica nimeni
 * nimic: se putea trece ședința altui client, neîntâmplată încă, pe o factură
 * de un leu, iar ea rămânea „achitată”. Banii nu dispăreau dintr-un cont — ei
 * dispăreau din lista de încasat, care e mai rău, fiindcă nimeni nu se uită
 * după ce nu mai apare.
 *
 * Singura apărare rămasă era `vanzare_linie_programare_uk`, care oprește a doua
 * plată a aceleiași ședințe, dar nu spune nimic despre a cui este.
 *
 * La modificarea unui bon, propriile lui linii nu contează drept „deja
 * încasat”: altfel rescrierea unui bon și-ar bloca singură ședințele.
 */
export async function verificaSedinteleLiniilor(
  ex: Executor,
  client_id: string,
  linii: readonly DateLinieVanzare[],
  vanzareCurenta: string | null = null,
): Promise<void> {
  const ids = linii
    .map((l) => l.programare_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) return

  if (new Set(ids).size !== ids.length) {
    throw eroareValidare('Aceeași ședință apare de două ori pe bon.', 'linii')
  }

  const { rows } = await ex.query<Programare & { achitata: boolean }>(
    `SELECT p.*, EXISTS (
       SELECT 1 FROM vanzare_linie vl
       WHERE vl.programare_id = p.id AND ($2::uuid IS NULL OR vl.vanzare_id <> $2)
     ) AS achitata
     FROM programare p WHERE p.id = ANY($1)
     ORDER BY p.incepe_la
     FOR UPDATE OF p`,
    [ids, vanzareCurenta],
  )

  if (rows.length !== new Set(ids).size) {
    throw eroareValidare('Una dintre ședințe nu mai există.', 'linii')
  }
  for (const p of rows) {
    if (p.client_id !== client_id) {
      throw eroareValidare('Una dintre ședințe aparține altui client.', 'linii')
    }
    if (p.stare !== 'onorat') {
      throw eroareValidare('Se pot încasa doar ședințele marcate ca onorate.', 'linii')
    }
    if (p.achitata) {
      throw eroareConflict('Una dintre ședințe este deja încasată.', {
        camp: 'linii',
        detalii: { programare_id: p.id },
      })
    }
  }
}
