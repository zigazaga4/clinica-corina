/**
 * /consimtaminte — acordurile GDPR semnate de clienți pe tabletă.
 *
 * Ruta are o formă neobișnuită pentru acest server, și dinadins: se poate
 * CREA și se poate CITI, dar nu se poate MODIFICA. Nu există PATCH, fiindcă
 * un acord semnat pe care cineva îl poate rescrie mai târziu nu mai
 * dovedește nimic. O greșeală se îndreaptă printr-o semnătură nouă, iar
 * amândouă rămân în fișă, cu data lor.
 *
 * Fișierul se ia separat, prin `/:id/document`. Listele vin din vederea
 * `v_consimtamant_detaliu`, care nu are coloana cu PDF-ul — altfel deschiderea
 * unei fișe cu douăzeci de acorduri ar fi tras câțiva megaocteți ca să
 * deseneze douăzeci de rânduri.
 */

import { createHash } from 'node:crypto'
import { Router, Response } from 'express'
import pool, { multe, unu, tranzactie, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { Conditii, impacheteaza, paginareDin, textDin } from '../lib/filtre.js'
import { adresaCererii, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { DIN_CONSIMTAMINTE } from '../lib/proiectii.js'
import { ceruteText, textOptional } from '../lib/validare.js'
import { requireAuth, requireRole, AuthRequest, cont } from '../middleware/auth.js'
import type { Consimtamant, ConsimtamantDetaliu, DateSemnatar } from '../types/database.js'

const router = Router()
router.use(requireAuth)

/**
 * Cât poate cântări un acord.
 *
 * Documentul are câteva pagini de text și o semnătură desenată; în practică
 * stă sub o sută de kiloocteți. Trei megaocteți lasă loc berechet pentru o
 * semnătură lungă sau un font mai gras, dar opresc pe cineva care ar încerca
 * să folosească tabela drept depozit de fișiere.
 */
const MARIME_MAXIMA = 3 * 1024 * 1024

/**
 * Verifică și despachetează PDF-ul primit.
 *
 * Se uită la primii octeți, nu doar la lungime: fără asta, orice șir base64
 * ar ajunge în coloană și s-ar descoperi abia peste un an, când cineva ar cere
 * acordul și ar primi un fișier pe care niciun cititor nu-l deschide.
 */
function documentDin(valoare: unknown): Buffer {
  if (typeof valoare !== 'string' || valoare.trim() === '') {
    throw eroareValidare('Lipsește documentul semnat.', 'document')
  }

  let octeti: Buffer
  try {
    octeti = Buffer.from(valoare, 'base64')
  } catch {
    throw eroareValidare('Documentul semnat nu a putut fi citit.', 'document')
  }

  if (octeti.length === 0) {
    throw eroareValidare('Documentul semnat este gol.', 'document')
  }
  if (octeti.length > MARIME_MAXIMA) {
    throw eroareValidare('Documentul semnat este prea mare.', 'document')
  }
  // `%PDF-` — semnătura de fișier. Orice altceva nu are ce căuta aici.
  if (octeti.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw eroareValidare('Fișierul trimis nu este un document PDF.', 'document')
  }

  return octeti
}

/**
 * Instantaneul fișei, așa cum a fost tipărit pe hârtie.
 *
 * Vine de la interfață, nu din bază, și asta este intenționat: în document
 * scrie ce avea interfața pe ecran în clipa semnării. Recitit din bază la
 * salvare, ar putea să nu mai fie același lucru — și atunci instantaneul ar
 * contrazice chiar documentul pe care pretinde că îl descrie.
 */
function semnatarDin(valoare: unknown): DateSemnatar {
  if (!valoare || typeof valoare !== 'object' || Array.isArray(valoare)) {
    throw eroareValidare('Lipsesc datele semnatarului.', 'date_semnatar')
  }
  const brut = valoare as Record<string, unknown>
  return {
    nume: ceruteText(brut['nume'], 'date_semnatar', 'Numele semnatarului'),
    telefon: textOptional(brut['telefon'], 'date_semnatar', 'Telefonul') ?? null,
    email: textOptional(brut['email'], 'date_semnatar', 'Adresa de e-mail') ?? null,
    adresa: textOptional(brut['adresa'], 'date_semnatar', 'Adresa') ?? null,
  }
}

// ---------------------------------------------------------------------------
// GET /consimtaminte — orice rol
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const p = paginareDin(req)

  const client = textDin(req.query['client_id'])
  if (client) unde.egal('client_id', client)

  const programare = textDin(req.query['programare_id'])
  if (programare) unde.egal('programare_id', programare)

  const doarFiltre = [...unde.values]
  const felie = `LIMIT ${unde.marcaj(p.pe_pagina)} OFFSET ${unde.marcaj(p.offset)}`

  const [randuri, numarate] = await Promise.all([
    multe<ConsimtamantDetaliu>(
      pool,
      `${DIN_CONSIMTAMINTE} ${unde.where} ORDER BY semnat_la DESC, id DESC ${felie}`,
      unde.values,
    ),
    multe<{ total: number }>(
      pool,
      `SELECT count(*)::bigint AS total FROM consimtamant ${unde.where}`,
      doarFiltre,
    ),
  ])

  res.json(impacheteaza(randuri, numarate[0]?.total ?? 0, p))
}))

// ---------------------------------------------------------------------------
// GET /consimtaminte/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await unu<ConsimtamantDetaliu>(
    pool, `${DIN_CONSIMTAMINTE} WHERE id = $1`, [req.params['id']], 'Acordul',
  ))
}))

// ---------------------------------------------------------------------------
// GET /consimtaminte/:id/document — PDF-ul propriu-zis, orice rol
// ---------------------------------------------------------------------------

/**
 * Singurul loc din server care citește coloana `document`.
 *
 * Se trimite ca `inline`, nu ca `attachment`: recepția vrea de obicei să se
 * uite peste el, nu să adune fișiere prin Descărcări. Numele propus conține
 * data semnării, ca un dosar salvat pe disc să rămână de recunoscut.
 */
router.get('/:id/document', ruta(async (req: AuthRequest, res: Response) => {
  /*
    `semnat_la` este `Date`, nu `string`.

    `lib/db.ts` cere driverului să întoarcă textual doar coloanele `date`
    (OID 1082); un `timestamptz` rămâne obiect `Date`. Peste tot altundeva nu
    se vede, fiindcă `res.json()` îl serializează singur în ISO — dar aici îl
    atingem cu mâna, iar tipul din `types/database.ts` spune `string`, ceea ce
    l-a făcut pe TypeScript să treacă peste un `.slice` care la rulare nu
    există. Convertit explicit, merge la fel și dintr-un capăt, și din celălalt.
  */
  const rand = await unu<
    Pick<Consimtamant, 'document' | 'amprenta'> & { semnat_la: string | Date }
  >(
    pool,
    `SELECT document, amprenta, semnat_la FROM consimtamant WHERE id = $1`,
    [req.params['id']],
    'Acordul',
  )

  const zi = new Date(rand.semnat_la).toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(rand.document.length))
  res.setHeader('Content-Disposition', `inline; filename="acord-gdpr-${zi}.pdf"`)
  /*
    Fără antet de cache — rămâne `no-store`, pus în bloc de `index.ts`.

    Documentul este pe cât de nemodificabil, pe atât de personal: nume, adresă,
    telefon și semnătura olografă a omului. Exact regula de acolo se aplică și
    aici, poate mai ales aici. Un `max-age` lung ar fi fost corect tehnic — nu
    se schimbă niciodată — și greșit în fond: ar lăsa acordul semnat pe discul
    unui calculator de la recepție, mult după ce s-a închis aplicația.
  */
  res.end(rand.document)
}))

// ---------------------------------------------------------------------------
// POST /consimtaminte — orice rol
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>

  const client_id = ceruteText(corp['client_id'], 'client_id', 'Clientul')
  const versiune = ceruteText(corp['versiune'], 'versiune', 'Versiunea acordului')
  const programare_id = textOptional(corp['programare_id'], 'programare_id', 'Programarea') ?? null
  const dispozitiv = textOptional(corp['dispozitiv'], 'dispozitiv', 'Dispozitivul') ?? null
  const date_semnatar = semnatarDin(corp['date_semnatar'])
  const document = documentDin(corp['document'])
  const amprenta = createHash('sha256').update(document).digest('hex')

  const acord = await tranzactie(async (ex: Executor) => {
    // Clientul se verifică aici, nu se lasă pe seama cheii străine: mesajul
    // „Clientul nu a fost găsit.” spune ceva, iar 23503 tradus generic nu.
    await unu(ex, `SELECT id FROM client WHERE id = $1`, [client_id], 'Clientul')
    if (programare_id) {
      await unu(ex, `SELECT id FROM programare WHERE id = $1`, [programare_id], 'Programarea')
    }

    const { rows } = await ex.query<Consimtamant>(
      `INSERT INTO consimtamant
         (client_id, programare_id, versiune, document, marime, amprenta, date_semnatar,
          dispozitiv, creat_de)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        client_id,
        programare_id,
        versiune,
        document,
        document.length,
        amprenta,
        JSON.stringify(date_semnatar),
        dispozitiv,
        autor.id,
      ],
    )
    const rand = rows[0]!

    /*
      În jurnal intră tot rândul FĂRĂ documentul.

      `date_noi` este `jsonb`, iar un PDF de o sută de kiloocteți serializat
      acolo ar umfla jurnalul de câteva ori pe zi, pentru nimic: fișierul stă
      deja în tabela lui, iar amprenta din jurnal dovedește oricând că este
      același. Ecranul de jurnal ar fi devenit oricum nefolosibil.
    */
    const { document: _, ...faraFisier } = rand
    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'consimtamant',
      entitate_id: rand.id,
      date_noi: instantaneu(faraFisier as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    return unu<ConsimtamantDetaliu>(
      ex, `${DIN_CONSIMTAMINTE} WHERE id = $1`, [rand.id], 'Acordul',
    )
  })

  res.status(201).json(acord)
}))

// ---------------------------------------------------------------------------
// DELETE /consimtaminte/:id — doar administrator
// ---------------------------------------------------------------------------

/**
 * Există pentru greșeli, nu pentru curățenie.
 *
 * Un acord semnat din greșeală pe fișa altui client nu poate fi lăsat acolo,
 * dar nici nu poate fi mutat — semnătura este a persoanei care a ținut
 * creionul, nu a fișei. Singura cale curată este ștergerea celui greșit și o
 * semnătură nouă unde trebuia.
 *
 * De aceea este rezervat administratorului și lasă urmă în jurnal: rândul
 * dispare, dar faptul că a existat și cine l-a șters nu.
 */
router.delete('/:id', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']

  await tranzactie(async (ex: Executor) => {
    const acord = await unu<Omit<Consimtamant, 'document'>>(
      ex,
      `SELECT id, client_id, programare_id, versiune, marime, amprenta, date_semnatar,
              dispozitiv, semnat_la, creat_de
         FROM consimtamant WHERE id = $1`,
      [id],
      'Acordul',
    )

    // Jurnalul înaintea ștergerii: după, instantaneul nu s-ar mai putea lua.
    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'stergere',
      entitate: 'consimtamant',
      entitate_id: id!,
      date_vechi: instantaneu(acord as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    await ex.query(`DELETE FROM consimtamant WHERE id = $1`, [id])
  })

  res.status(204).end()
}))

export default router
