/**
 * Limitarea încercărilor de parolă — comună autentificării și statisticilor.
 *
 * De ce se numără ce se numără, și pe ce chei, este explicat pe larg în
 * `routes/auth.ts`, lângă limitatoarele autentificării. Aici stă doar unealta,
 * ca a doua ușă cu parolă — cea a statisticilor — să nu primească o copie a
 * ei care să apuce să difere.
 */

import type { Request, Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

export const FEREASTRA_MS = 10 * 60_000

/** Câte încercări EȘUATE tolerăm într-o fereastră, pe fiecare dimensiune. */
export const LIMITA_CONT = 12
export const LIMITA_ADRESA = 60

/** Construiește un limitator peste cheia dată. Se numără DOAR încercările eșuate. */
export function limitator(limita: number, cheie: (req: Request) => string) {
  return rateLimit({
    windowMs: FEREASTRA_MS,
    limit: limita,

    /*
      Se numără DOAR ce a eșuat. O zi de lucru normală înseamnă zeci de
      autentificări reușite — ele nu trebuie să apropie pe nimeni de limită,
      altfel protecția s-ar întoarce împotriva clinicii tocmai în zilele
      aglomerate.
    */
    skipSuccessfulRequests: true,

    keyGenerator: cheie,

    standardHeaders: 'draft-7',
    legacyHeaders: false,

    /*
      Răspunsul păstrează forma contractului — `{ mesaj }` — nu HTML-ul sau
      `{ error }` cu care vine biblioteca. Interfața despachetează un singur
      câmp; orice altceva ajunge la operatoare drept „Cererea a eșuat (429)”.
      Compunerea se face aici, nu în `trateazaErori`, pentru că `EroareApi` nu
      are cod pentru 429; `Retry-After` îl pune biblioteca.
    */
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        mesaj: 'Prea multe încercări eșuate. Așteaptă câteva minute și încearcă din nou.',
      })
    },
  })
}

/*
  `ipKeyGenerator` normalizează IPv6 la subrețea: fără el, cine are un /64 —
  adică orice abonat obișnuit — capătă o găleată nouă la fiecare cerere, doar
  schimbând ultimele cifre ale adresei.
*/
export const cheieAdresa = (req: Request): string => ipKeyGenerator(req.ip ?? '')
