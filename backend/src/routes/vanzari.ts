/**
 * /vanzari — încasările.
 *
 * În interfață ecranul se numește „Încasări”, fiindcă asta caută cineva acolo:
 * ce bani au intrat. Rutele și tabelele au rămas `vanzare` / `vanzari`, ca în
 * §3 și §7 ale specificației — o redenumire ar fi cerut migrare de bază pentru
 * un cuvânt de pe un buton.
 *
 * Bonul se citește aici ÎNTREG, cu tot cu ședințele pe care le-a stins. Fișa
 * clientului îl arată altfel — acolo ședința este evenimentul, iar bonul care
 * doar o plătește nu are ce adăuga. Un bon din care lipsesc ședințele ar fi
 * însă un bon fals, iar aici se numără banii.
 */

import { Router, Response } from 'express'
import pool, { alege, multe, tranzactie, unu, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { Conditii, impacheteaza, paginareDin, textDin } from '../lib/filtre.js'
import { inregistreazaIncasare, pregatesteLinie, programariDeStins } from '../lib/incasari.js'
import { adresaCererii, diferenta, scrieJurnal } from '../lib/jurnal.js'
import { atasaLinii, DIN_VANZARI, punctImplicit, vanzareDetaliu, vanzariDetaliu } from '../lib/proiectii.js'
import { momentCerut, textOptional } from '../lib/validare.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import type {
  CreateVanzareRequest,
  DateLinieVanzare,
  IncasareRequest,
  Vanzare,
  VanzareDetaliu,
} from '../types/database.js'

const router = Router()
router.use(requireAuth)

const CAMPURI_ANTET = [
  'client_id', 'punct_lucru_id', 'operator_id', 'programare_id', 'efectuat_la', 'nota',
] as const

/** Liniile trimise de interfață, verificate ca listă înainte de a fi citite una câte una. */
function liniiCerute(valoare: unknown, obligatorii: boolean): DateLinieVanzare[] {
  if (valoare === undefined) {
    if (obligatorii) throw eroareValidare('Adaugă cel puțin un serviciu sau produs.', 'linii')
    return []
  }
  if (!Array.isArray(valoare)) throw eroareValidare('Liniile trebuie trimise ca listă.', 'linii')
  if (obligatorii && valoare.length === 0) {
    throw eroareValidare('Adaugă cel puțin un serviciu sau produs.', 'linii')
  }
  return valoare as DateLinieVanzare[]
}

/**
 * Scrie setul de linii al unei încasări.
 *
 * Toate se validează înainte ca vreuna să fie scrisă: pe server este o
 * tranzacție, deci un articol inexistent pe ultima linie nu are voie să lase
 * bonul cu primele trei.
 */
async function scrieLinii(
  ex: Executor,
  vanzare_id: string,
  linii: DateLinieVanzare[],
): Promise<void> {
  const pregatite = []
  for (const linie of linii) pregatite.push(await pregatesteLinie(ex, linie))

  for (const l of pregatite) {
    await ex.query(
      `INSERT INTO vanzare_linie (vanzare_id, articol_id, cantitate, pret_unitar, programare_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [vanzare_id, l.articol_id, l.cantitate, l.pret_unitar, l.programare_id],
    )
  }
}

// ---------------------------------------------------------------------------
// POST /vanzari/incasare — orice rol
//
// Înaintea lui `/:id`, ca „incasare” să nu fie citit ca identificator.
// ---------------------------------------------------------------------------

/**
 * Stinge într-o singură plată ședințele rămase de achitat ale unui client.
 *
 * Prețurile NU vin din cerere: se iau din `programare.pret`, adică din ce s-a
 * convenit la programare. Altfel interfața ar putea încasa altă sumă decât cea
 * agreată, iar clienta ar avea dreptate să se supere.
 */
router.post('/incasare', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as IncasareRequest

  const incasare = await tranzactie(async (ex: Executor) => {
    await unu(ex, `SELECT id FROM client WHERE id = $1`, [corp.client_id], 'Clientul')

    const programari = await programariDeStins(ex, corp.client_id, corp.programare_ids ?? [])
    const produse = liniiCerute(corp.linii, false)

    if (programari.length === 0 && produse.length === 0) {
      throw eroareValidare('Alege cel puțin o ședință sau un produs.', 'programare_ids')
    }

    return inregistreazaIncasare(ex, {
      autor_id: autor.id,
      client_id: corp.client_id,
      programari,
      produse,
      efectuat_la: corp.efectuat_la
        ? momentCerut(corp.efectuat_la, 'efectuat_la', 'Data încasării')
        : new Date().toISOString(),
      nota: corp.nota ?? null,
      adresa_ip: adresaCererii(req),
    })
  })

  res.status(201).json(incasare)
}))

// ---------------------------------------------------------------------------
// GET /vanzari — orice rol
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const p = paginareDin(req)

  unde.deLa('efectuat_la', textDin(req.query['de_la']))
  unde.panaLa('efectuat_la', textDin(req.query['pana_la']))
  unde.egal('client_id', textDin(req.query['client_id']))
  unde.egal('punct_lucru_id', textDin(req.query['punct_lucru_id']))
  unde.egal('operator_id', textDin(req.query['operator_id']))

  // Filtrarea pe articol privește liniile: antetul singur nu știe ce s-a vândut.
  const articol_id = textDin(req.query['articol_id'])
  if (articol_id) {
    unde.brut(
      `EXISTS (SELECT 1 FROM vanzare_linie vl
               WHERE vl.vanzare_id = v_vanzare_detaliu.id
                 AND vl.articol_id = ${unde.marcaj(articol_id)})`,
    )
  }

  const doarFiltre = [...unde.values]
  const felie = `LIMIT ${unde.marcaj(p.pe_pagina)} OFFSET ${unde.marcaj(p.offset)}`

  const [antete, numarate] = await Promise.all([
    multe<VanzareDetaliu>(
      pool,
      `${DIN_VANZARI} ${unde.where} ORDER BY efectuat_la DESC ${felie}`,
      unde.values,
    ),
    multe<{ total: number }>(
      pool,
      `SELECT count(*)::bigint AS total FROM v_vanzare_detaliu ${unde.where}`,
      doarFiltre,
    ),
  ])

  res.json(impacheteaza(await atasaLinii(pool, antete), numarate[0]?.total ?? 0, p))
}))

// ---------------------------------------------------------------------------
// GET /vanzari/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await vanzareDetaliu(pool, req.params['id']!))
}))

// ---------------------------------------------------------------------------
// POST /vanzari — orice rol. Antet + linii, într-o singură tranzacție.
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as CreateVanzareRequest
  const linii = liniiCerute(corp.linii, true)

  const vanzare = await tranzactie(async (ex: Executor) => {
    await unu(ex, `SELECT id FROM client WHERE id = $1`, [corp.client_id], 'Clientul')
    const operator_id = corp.operator_id ?? autor.id
    await unu(ex, `SELECT id FROM utilizator WHERE id = $1`, [operator_id], 'Operatorul')
    const punct_lucru_id = corp.punct_lucru_id ?? (await punctImplicit(ex))

    const { rows } = await ex.query<Vanzare>(
      `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, programare_id, efectuat_la, nota)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        corp.client_id,
        punct_lucru_id,
        operator_id,
        corp.programare_id ?? null,
        momentCerut(corp.efectuat_la, 'efectuat_la', 'Data încasării'),
        textOptional(corp.nota),
      ],
    )
    const antet = rows[0]!

    await scrieLinii(ex, antet.id, linii)

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'vanzare',
      entitate_id: antet.id,
      date_noi: { client_id: antet.client_id, efectuat_la: antet.efectuat_la, numar_linii: linii.length },
      adresa_ip: adresaCererii(req),
    })

    return vanzareDetaliu(ex, antet.id)
  })

  res.status(201).json(vanzare)
}))

// ---------------------------------------------------------------------------
// PATCH /vanzari/:id — orice rol. Corectează antetul sau liniile.
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>

  const vanzare = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Vanzare>(
      ex, `SELECT * FROM vanzare WHERE id = $1 FOR UPDATE`, [id], 'Vânzarea',
    )

    const date = alege(corp, CAMPURI_ANTET)
    if (date['efectuat_la'] !== undefined) {
      date['efectuat_la'] = momentCerut(date['efectuat_la'], 'efectuat_la', 'Data încasării')
    }
    if (date['nota'] !== undefined) date['nota'] = textOptional(date['nota'])

    let dupa = inainte
    if (Object.keys(date).length > 0) {
      const coloane = Object.keys(date)
      const { rows } = await ex.query<Vanzare>(
        `UPDATE vanzare SET ${coloane.map((c, i) => `"${c}" = $${i + 1}`).join(', ')}
         WHERE id = $${coloane.length + 1} RETURNING *`,
        [...coloane.map((c) => date[c]), id],
      )
      dupa = rows[0]!
    }

    /*
      Liniile trimise ÎNLOCUIESC integral setul existent.

      Se șterg abia după ce noile linii au trecut de validare, în aceeași
      tranzacție: o linie invalidă nu are voie să lase bonul gol. Ștergerea
      eliberează și ședințele pe care le stingeau liniile vechi — dacă cineva
      scoate o ședință dintr-un bon, ea redevine „de plată”, ceea ce este exact
      răspunsul corect.
    */
    if (corp['linii'] !== undefined) {
      const linii = liniiCerute(corp['linii'], true)
      await ex.query(`DELETE FROM vanzare_linie WHERE vanzare_id = $1`, [id])
      await scrieLinii(ex, id, linii)
    }

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif || corp['linii'] !== undefined) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'vanzare',
        entitate_id: id,
        date_vechi: dif?.date_vechi ?? null,
        date_noi: {
          ...(dif?.date_noi ?? {}),
          ...(corp['linii'] !== undefined
            ? { linii_inlocuite: (corp['linii'] as unknown[]).length }
            : {}),
        },
        adresa_ip: adresaCererii(req),
      })
    }

    return vanzareDetaliu(ex, id)
  })

  res.json(vanzare)
}))

export default router
