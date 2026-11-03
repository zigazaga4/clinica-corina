/**
 * /statistici — încasările, cheltuielile și profitul, în spatele unei parole.
 *
 *   GET  /statistici/acces   — orice rol. Există parola? (ca interfața să știe
 *                              dacă cere parola sau o propune spre alegere)
 *   POST /statistici/acces   — orice rol. Parola bună -> deblocarea.
 *   PUT  /statistici/parola  — administrator. Alege sau schimbă parola.
 *   GET  /statistici         — cere deblocarea. Raportul pe o perioadă.
 *   GET  /statistici/mele    — orice rol, FĂRĂ parolă. Doar cifrele persoanei autentificate.
 *   GET  /statistici/persoana/:id — cere deblocarea. Cifrele oricărei persoane.
 *
 * Despre parolă și deblocare: `middleware/acces-statistici.ts`. Despre ce
 * înseamnă fiecare cifră: `lib/raport-statistici.ts`.
 */

import argon2 from 'argon2'
import { Router, type Request, type Response } from 'express'
import pool, { tranzactie, unu, type Executor } from '../lib/db.js'
import { eroareConflict, eroareValidare, ruta } from '../lib/erori.js'
import { adresaCererii, scrieJurnal } from '../lib/jurnal.js'
import { cheieAdresa, LIMITA_ADRESA, LIMITA_CONT, limitator } from '../lib/limitare.js'
import { construiesteRaportPersoana } from '../lib/raport-persoana.js'
import { construiesteRaport, filtruRaportDin } from '../lib/raport-statistici.js'
import {
  cereAccesStatistici,
  emiteAccesStatistici,
  parolaStatistici,
} from '../middleware/acces-statistici.js'
import { AuthRequest, cont, requireAuth, requireRole } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

/** Cea mai scurtă parolă primită — aceeași regulă ca la parolele conturilor. */
const LUNGIME_MINIMA = 8

/*
  Ghicitul parolei se limitează ca la autentificare, pe perechea adresă + cont:
  colega care greșește parola nu încuie statisticile pentru toată clinica, iar
  cine încearcă parole la rând se oprește după douăsprezece în zece minute.
*/
const cheieCont = (req: Request): string =>
  `${cheieAdresa(req)}|${(req as AuthRequest).cont?.id ?? ''}`

const limitaAdresa = limitator(LIMITA_ADRESA, cheieAdresa)
const limitaCont = limitator(LIMITA_CONT, cheieCont)

/** Textul unei parole din corp; lipsa este șirul gol. Parolele NU se curăță de spații. */
function parolaDin(valoare: unknown): string {
  return typeof valoare === 'string' ? valoare : ''
}

// ---------------------------------------------------------------------------
// GET /statistici/acces — orice rol
// ---------------------------------------------------------------------------

router.get('/acces', ruta(async (_req: AuthRequest, res: Response) => {
  res.json({ parola_setata: (await parolaStatistici(pool)) !== null })
}))

// ---------------------------------------------------------------------------
// POST /statistici/acces — orice rol, cu parola statisticilor
// ---------------------------------------------------------------------------

router.post('/acces', limitaAdresa, limitaCont, ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const parola = parolaDin((req.body as { parola?: unknown } | undefined)?.parola)
  if (!parola) throw eroareValidare('Scrie parola statisticilor.', 'parola')

  const rand = await parolaStatistici(pool)
  if (!rand) {
    throw eroareValidare(
      'Parola statisticilor nu a fost aleasă încă. Un administrator o alege la prima deschidere.',
      'parola',
    )
  }

  const potrivita = await argon2.verify(rand.parola_hash, parola).catch(() => false)
  if (!potrivita) throw eroareValidare('Parola statisticilor nu este corectă.', 'parola')

  // Parola bună iartă greșelile de dinainte, pe cont — ca la autentificare.
  limitaCont.resetKey(cheieCont(req))

  /*
    Cine a deschis statisticile, și când. Proprietarul care vrea să știe cine
    s-a uitat la cifre găsește răspunsul în jurnal, lângă autentificări.
  */
  await scrieJurnal(pool, {
    utilizator_id: autor.id,
    actiune: 'autentificare',
    entitate: 'statistici',
    adresa_ip: adresaCererii(req),
  })

  res.json(emiteAccesStatistici(autor.id, req.user!.sesiune_id, rand.parola_hash))
}))

// ---------------------------------------------------------------------------
// PUT /statistici/parola — administrator
// ---------------------------------------------------------------------------

/**
 * Prima dată: fără parola curentă — nu există una. Apoi: numai cu ea.
 *
 * Rolul de administrator singur NU ajunge ca să schimbe o parolă existentă.
 * Contul de administrator poate fi și el folosit de mai mulți; dacă ar putea
 * rescrie parola fără s-o știe pe cea veche, parola statisticilor n-ar mai
 * apăra nimic de cine are contul. O parolă uitată se șterge de pe server
 * (`npm run parola-statistici`), după care se alege din nou.
 */
router.put(
  '/parola',
  requireRole('administrator'),
  limitaAdresa,
  limitaCont,
  ruta(async (req: AuthRequest, res: Response) => {
    const autor = cont(req)
    const corp = (req.body ?? {}) as { parola_noua?: unknown; parola_curenta?: unknown }
    const parola_noua = parolaDin(corp.parola_noua)
    const parola_curenta = parolaDin(corp.parola_curenta)

    if (parola_noua.length < LUNGIME_MINIMA) {
      throw eroareValidare(
        `Parola statisticilor trebuie să aibă cel puțin ${LUNGIME_MINIMA} caractere.`,
        'parola_noua',
      )
    }

    const acces = await tranzactie(async (ex: Executor) => {
      const existenta = await parolaStatistici(ex, true)

      // Parola curentă ÎNTÂI. Altfel cine găsește o sesiune de administrator
      // lăsată deschisă ar fi putut încerca, pe rând, parole ale contului —
      // mesajul de mai jos i-ar fi spus care e cea bună.
      if (existenta) {
        if (!parola_curenta) {
          throw eroareValidare('Scrie parola curentă a statisticilor.', 'parola_curenta')
        }
        const potrivita = await argon2.verify(existenta.parola_hash, parola_curenta).catch(() => false)
        if (!potrivita) {
          throw eroareValidare('Parola curentă a statisticilor nu este corectă.', 'parola_curenta')
        }
      }

      /*
        Nu aceeași cu parola contului care o alege. Rostul ei este tocmai să fie
        altceva decât ce știe oricine intră cu acest cont — egală cu aceea, ar fi
        o ușă a doua cu aceeași cheie.
      */
      const { parola_hash: parolaContului } = await unu<{ parola_hash: string }>(
        ex, `SELECT parola_hash FROM utilizator WHERE id = $1`, [autor.id], 'Contul',
      )
      if (await argon2.verify(parolaContului, parola_noua).catch(() => false)) {
        throw eroareValidare(
          'Alege o parolă diferită de cea a contului tău — altfel oricine intră cu contul vede și statisticile.',
          'parola_noua',
        )
      }

      const parola_hash = await argon2.hash(parola_noua)

      if (existenta) {
        await ex.query(
          `UPDATE parola_statistici
           SET parola_hash = $1, actualizat_de = $2, actualizat_la = now() WHERE id`,
          [parola_hash, autor.id],
        )
      } else {
        // Doi administratori care o aleg în aceeași clipă: primul câștigă, al
        // doilea află că între timp a apărut una și trebuie s-o știe.
        const { rowCount } = await ex.query(
          `INSERT INTO parola_statistici (id, parola_hash, actualizat_de)
           VALUES (true, $1, $2) ON CONFLICT (id) DO NOTHING`,
          [parola_hash, autor.id],
        )
        if (rowCount === 0) {
          throw eroareConflict('Parola statisticilor tocmai a fost aleasă de altcineva. Scrie-o pe aceea.', {
            camp: 'parola_curenta',
          })
        }
      }

      // Nimic din parolă în jurnal — nici măcar hash-ul. Doar faptul.
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: existenta ? 'modificare' : 'creare',
        entitate: 'parola_statistici',
        adresa_ip: adresaCererii(req),
      })

      return emiteAccesStatistici(autor.id, req.user!.sesiune_id, parola_hash)
    })

    limitaCont.resetKey(cheieCont(req))
    res.json(acces)
  }),
)

// ---------------------------------------------------------------------------
// GET /statistici — cere deblocarea
// ---------------------------------------------------------------------------

router.get('/', cereAccesStatistici, ruta(async (req: AuthRequest, res: Response) => {
  res.json(await construiesteRaport(filtruRaportDin(req.query as Record<string, unknown>)))
}))

// ---------------------------------------------------------------------------
// GET /statistici/mele — orice rol, FĂRĂ parola statisticilor
// ---------------------------------------------------------------------------

/**
 * „Statisticile mele”: ședințele și banii persoanei care întreabă, și numai ai
 * ei (cerința clinicii, 3 nov. 2026 — Anda își vede doar încasările ei).
 *
 * Nu cere parola statisticilor, iar persoana NU vine din cerere: este contul
 * autentificat. Nu există un parametru prin care cineva să ceară cifrele alteia
 * — pentru asta există ruta de mai jos, în spatele parolei.
 */
router.get('/mele', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await construiesteRaportPersoana(
    filtruRaportDin(req.query as Record<string, unknown>),
    cont(req).id,
  ))
}))

// ---------------------------------------------------------------------------
// GET /statistici/persoana/:id — cere deblocarea
// ---------------------------------------------------------------------------

/** Aceleași cifre, pentru oricare persoană: proprietarul le vede pe toate, pe rând. */
router.get('/persoana/:id', cereAccesStatistici, ruta(async (req: AuthRequest, res: Response) => {
  res.json(await construiesteRaportPersoana(
    filtruRaportDin(req.query as Record<string, unknown>),
    req.params['id']!,
  ))
}))

export default router
