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
 *
 * O vânzare de produse poate rămâne NEACHITATĂ (`achitat_la` NULL): clienta ia
 * cremele acum și plătește săptămâna viitoare. Suma intră în `de_incasat` al
 * ei, iar `PATCH { achitat: true }` o trece plătită în momentul apăsării.
 */

import { Router, Response, type RequestHandler } from 'express'
import pool, { alege, multe, tranzactie, unu, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii, impacheteaza, paginareDin, textDin } from '../lib/filtre.js'
import {
  inregistreazaIncasare,
  pregatesteLinie,
  programariDeStins,
  verificaSedinteleLiniilor,
} from '../lib/incasari.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { atasaLinii, DIN_VANZARI, punctImplicit, vanzareDetaliu, vanzariDetaliu } from '../lib/proiectii.js'
import { momentCerut, textOptional } from '../lib/validare.js'
import { cereAccesStatistici } from '../middleware/acces-statistici.js'
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
 * `achitat` din corpul cererii: lipsă = neschimbat, altfel neapărat boolean.
 *
 * Strict, nu „orice e adevărat”: un `"false"` venit ca text ar fi trecut drept
 * plătită exact vânzarea pe care cineva voia s-o lase datorie.
 */
function achitatDin(valoare: unknown): boolean | undefined {
  if (valoare === undefined) return undefined
  if (typeof valoare !== 'boolean') {
    throw eroareValidare('„Achitat” trebuie să fie da sau nu.', 'achitat')
  }
  return valoare
}

/**
 * O vânzare care stinge ședințe nu poate rămâne neachitată.
 *
 * Ședința se socotește plătită după linia care o indică (`v_programare_detaliu`),
 * iar o linie pe un bon neplătit ar fi spus deodată „achitată” pe ședință și
 * „de plată” pe bon. Pentru o ședință neplătită drumul este altul: ea rămâne
 * „de plată” la onorare și se încasează de pe fișă.
 *
 * Se verifică DUPĂ scriere, în tranzacție: prinde deopotrivă bonul nou, bonul
 * debifat și bonul neachitat căruia i se adaugă o ședință.
 */
async function refuzaSedintePeDatorie(ex: Executor, vanzare_id: string): Promise<void> {
  const { rows } = await ex.query<{ refuzat: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM vanzare v JOIN vanzare_linie vl ON vl.vanzare_id = v.id
       WHERE v.id = $1 AND v.achitat_la IS NULL AND vl.programare_id IS NOT NULL
     ) AS refuzat`,
    [vanzare_id],
  )
  if (rows[0]?.refuzat) {
    throw eroareValidare(
      'O încasare de ședințe nu poate rămâne neachitată. Doar vânzările de produse se pot lăsa pe datorie.',
      'achitat',
    )
  }
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
  client_id: string,
  linii: DateLinieVanzare[],
): Promise<void> {
  // Ședințele trecute pe linii trec prin aceleași reguli ca la încasarea de pe
  // fișă: să fie ale clientului de pe bon, onorate, și neîncasate deja.
  await verificaSedinteleLiniilor(ex, client_id, linii, vanzare_id)

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
    /*
      Aici NU se verifică arhivarea, spre deosebire de `POST /vanzari`.

      Arhivarea oprește lucrul nou, nu încasarea a ceea ce s-a lucrat deja.
      Dacă cineva arhivează o fișă care mai are ședințe neachitate, banii
      trebuie să poată intra oricum: altfel datoria rămâne pe veci de neîncasat,
      iar singura ieșire ar fi dezarhivarea unei fișe pe care cineva a decis-o
      închisă.
    */
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
// GET /vanzari — orice rol, cu statisticile deblocate
//
// Lista tuturor încasărilor clinicii ESTE o statistică: cine o are adună
// singur cât a intrat. De aceea stă în spatele aceleiași parole ca restul
// banilor. Bonul singur (`/:id`), deschis de pe fișa unui client, rămâne liber.
// ---------------------------------------------------------------------------

/*
  Excepția: lista datoriilor (`achitat=false`) nu cere parola statisticilor.

  Nu spune cât a intrat — spune cine mai are de plătit, iar recepția are nevoie
  de ea zilnic, în Nomenclator → Produse, ca să bifeze „Achitat” când clienta
  vine cu banii. Fiecare datorie se vedea oricum, una câte una, pe fișa
  clientei; lista doar le adună la un loc.
*/
const accesListaVanzari: RequestHandler = (req, res, next) => {
  if (boolDin(req.query['achitat']) === false) return next()
  return cereAccesStatistici(req, res, next)
}

router.get('/', accesListaVanzari, ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const p = paginareDin(req)

  unde.deLa('efectuat_la', textDin(req.query['de_la']))
  unde.panaLa('efectuat_la', textDin(req.query['pana_la']))
  unde.egal('client_id', textDin(req.query['client_id']))
  unde.egal('punct_lucru_id', textDin(req.query['punct_lucru_id']))
  unde.egal('operator_id', textDin(req.query['operator_id']))

  // `achitat=false` = „cine îmi datorează produse?”; lipsă = toate.
  const achitat = boolDin(req.query['achitat'])
  if (achitat === true) unde.brut('achitat_la IS NOT NULL')
  if (achitat === false) unde.brut('achitat_la IS NULL')

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
      // `id` la coadă ca departajare: două bonuri din aceeași secundă altfel se
      // așază diferit la fiecare interogare, iar paginarea le arată de două ori
      // pe unele și deloc pe altele.
      `${DIN_VANZARI} ${unde.where} ORDER BY efectuat_la DESC, id ASC ${felie}`,
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
  // Lipsă = achitată: aplicațiile care nu știu încă de câmp scriu ca înainte.
  const achitat = achitatDin(corp.achitat) ?? true

  const vanzare = await tranzactie(async (ex: Executor) => {
    // Ca la programări: o fișă arhivată nu mai primește mișcări noi.
    const clientul = await unu<{ id: string; arhivat_la: Date | null }>(
      ex, `SELECT id, arhivat_la FROM client WHERE id = $1`, [corp.client_id], 'Clientul',
    )
    if (clientul.arhivat_la !== null) {
      throw eroareValidare(
        'Clientul este arhivat; dezarhivează-l înainte de a-i scrie o încasare.',
        'client_id',
      )
    }
    const operator_id = corp.operator_id ?? autor.id
    await unu(ex, `SELECT id FROM utilizator WHERE id = $1`, [operator_id], 'Operatorul')
    const punct_lucru_id = corp.punct_lucru_id ?? (await punctImplicit(ex))
    const efectuat_la = momentCerut(corp.efectuat_la, 'efectuat_la', 'Data încasării')

    const { rows } = await ex.query<Vanzare>(
      `INSERT INTO vanzare (client_id, punct_lucru_id, operator_id, programare_id, efectuat_la, nota, achitat_la)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        corp.client_id,
        punct_lucru_id,
        operator_id,
        corp.programare_id ?? null,
        efectuat_la,
        textOptional(corp.nota),
        // Plătită pe loc = plătită în momentul vânzării, nu al introducerii.
        achitat ? efectuat_la : null,
      ],
    )
    const antet = rows[0]!

    await scrieLinii(ex, antet.id, corp.client_id, linii)
    await refuzaSedintePeDatorie(ex, antet.id)

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'vanzare',
      entitate_id: antet.id,
      date_noi: {
        client_id: antet.client_id,
        efectuat_la: antet.efectuat_la,
        achitat_la: antet.achitat_la,
        numar_linii: linii.length,
      },
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

    /*
      Bifa „Achitat”.

      Trecută pe da, vânzarea se socotește plătită ACUM: banii intră când îi
      primește recepția, nu când au plecat cremele. Pe una deja plătită nu se
      atinge nimic — a doua apăsare nu are voie să mute data plății. Trecută pe
      nu, datoria revine pe fișa clientei.

      Fără bifă, dar cu data vânzării mutată: o plată făcută PE LOC o urmează.
      Altfel o vânzare corectată de pe 3 pe 2 septembrie ar fi rămas „achitată
      pe 3”, iar fișa ar fi spus „plătit altă zi” despre o plată pe loc.
    */
    const achitat = achitatDin(corp['achitat'])
    if (achitat === false && inainte.achitat_la !== null) {
      date['achitat_la'] = null
    } else if (achitat === true && inainte.achitat_la === null) {
      date['achitat_la'] = new Date().toISOString()
    } else if (
      date['efectuat_la'] !== undefined &&
      inainte.achitat_la !== null &&
      new Date(inainte.achitat_la).getTime() === new Date(inainte.efectuat_la).getTime()
    ) {
      date['achitat_la'] = date['efectuat_la']
    }

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
      // Clientul bonului DUPĂ modificare: dacă antetul tocmai a fost mutat pe
      // alt client, ședințele trebuie să fie ale aceluia, nu ale celui vechi.
      await scrieLinii(ex, id, dupa.client_id, linii)
    }

    await refuzaSedintePeDatorie(ex, id)

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

// ---------------------------------------------------------------------------
// DELETE /vanzari/:id — cu statisticile deblocate
//
// Ștergerea unei încasări schimbă banii clinicii, deci cere aceeași parolă ca
// lista lor. Liniile pleacă odată cu antetul (ON DELETE CASCADE), iar ședințele
// pe care le stingeau redevin „de plată” — exact ca la scoaterea lor din bon.
// Jurnalul păstrează bonul întreg, cu linii cu tot: ștergerea nu se poate
// desface, dar se poate reconstitui.
// ---------------------------------------------------------------------------

router.delete('/:id', cereAccesStatistici, ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!

  await tranzactie(async (ex: Executor) => {
    await unu<Vanzare>(ex, `SELECT id FROM vanzare WHERE id = $1 FOR UPDATE`, [id], 'Vânzarea')
    const bon = await vanzareDetaliu(ex, id)

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'stergere',
      entitate: 'vanzare',
      entitate_id: id,
      date_vechi: instantaneu(bon as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    await ex.query(`DELETE FROM vanzare WHERE id = $1`, [id])
  })

  res.status(204).end()
}))

export default router
