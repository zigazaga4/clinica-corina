/**
 * Erorile API, în forma pe care o citește interfața.
 *
 * Clientul HTTP al aplicației despachetează exact trei câmpuri din corpul unui
 * răspuns nereușit:
 *
 *     { "mesaj": "...", "camp": "email", "detalii": { ... } }
 *
 * `mesaj` ajunge sub ochii operatoarei, `camp` colorează în roșu exact căsuța
 * vinovată din formular, iar `detalii` rămâne pentru diagnostic. Un răspuns de
 * forma `{ "error": "..." }` trece prin toate acestea nevăzut și utilizatorul
 * primește „Cererea a eșuat (400)” — corect, dar inutil.
 *
 * Aici sunt și traducerile constrângerilor PostgreSQL. Baza refuză cu 23505 sau
 * 23P01; omul de la recepție trebuie să citească de ce.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express'

export type CodEroare =
  | 'validare'        // 400 — date invalide
  | 'neautentificat'  // 401 — lipsă sau expirare token
  | 'interzis'        // 403 — rol insuficient
  | 'negasit'         // 404 — rândul nu există
  | 'conflict'        // 409 — constrângere de bază încălcată
  | 'server'          // 500 — orice altceva

const statusPentruCod: Record<CodEroare, number> = {
  validare: 400,
  neautentificat: 401,
  interzis: 403,
  negasit: 404,
  conflict: 409,
  server: 500,
}

export class EroareApi extends Error {
  readonly cod: CodEroare
  readonly status: number
  readonly camp: string | undefined
  readonly detalii: Record<string, unknown> | undefined

  constructor(
    cod: CodEroare,
    mesaj: string,
    optiuni?: { camp?: string; detalii?: Record<string, unknown> },
  ) {
    super(mesaj)
    this.name = 'EroareApi'
    this.cod = cod
    this.status = statusPentruCod[cod]
    this.camp = optiuni?.camp
    this.detalii = optiuni?.detalii
  }
}

export const eroareValidare = (mesaj: string, camp?: string) =>
  new EroareApi('validare', mesaj, camp ? { camp } : undefined)

export const eroareNeautentificat = (mesaj = 'Sesiune expirată. Autentifică-te din nou.') =>
  new EroareApi('neautentificat', mesaj)

export const eroareInterzis = (mesaj = 'Nu ai dreptul să efectuezi această operațiune.') =>
  new EroareApi('interzis', mesaj)

export const eroareNegasit = (ce = 'Înregistrarea') =>
  new EroareApi('negasit', `${ce} nu a fost găsită.`)

export const eroareConflict = (
  mesaj: string,
  optiuni?: { camp?: string; detalii?: Record<string, unknown> },
) => new EroareApi('conflict', mesaj, optiuni)

// ---------------------------------------------------------------------------
// Traducerea erorilor PostgreSQL
// ---------------------------------------------------------------------------

interface EroarePg {
  code?: string
  constraint?: string
  column?: string
  detail?: string
  table?: string
  message?: string
}

/**
 * Ce spune fiecare constrângere atunci când o încalci.
 *
 * Cheia este numele din DDL. Ținute aici, lângă traducere, mesajele nu se pot
 * rătăci de constrângerea pe care o explică — iar o constrângere adăugată în
 * `sql/01_schema.sql` fără rând aici cade pe mesajul generic, nu pe 500.
 */
const mesajeConstrangeri: Record<string, { mesaj: string; camp?: string }> = {
  utilizator_email_uk: {
    mesaj: 'Există deja un cont cu această adresă de e-mail.',
    camp: 'email',
  },
  punct_lucru_denumire_key: {
    mesaj: 'Există deja un punct de lucru cu această denumire.',
    camp: 'denumire',
  },
  programare_fara_suprapunere: {
    mesaj: 'Persoana selectată are deja o programare care se suprapune cu acest interval.',
    camp: 'incepe_la',
  },
  vanzare_linie_programare_uk: {
    mesaj: 'Una dintre ședințe este deja încasată.',
    camp: 'programare_ids',
  },
  articol_durata_ck: {
    mesaj: 'Un serviciu are durată în minute întregi, mai mare ca zero; un produs nu are durată.',
    camp: 'durata_minute',
  },
  programare_interval_ck: {
    mesaj: 'Ora de sfârșit trebuie să fie după ora de început.',
    camp: 'se_termina_la',
  },
  programare_articol_fk: {
    mesaj: 'Se pot programa doar articole de tip serviciu.',
    camp: 'articol_id',
  },
  abonament_sedinte_ck: {
    mesaj: 'Abonamentul nu mai are ședințe disponibile.',
  },
}

/**
 * Transformă o eroare `pg` într-una cu mesaj de citit.
 *
 * Ce nu recunoaște lasă neatins, ca să ajungă la 500 și în consolă — o eroare
 * de bază tradusă greșit este mai rea decât una netradusă.
 */
export function dinEroarePostgres(e: unknown): unknown {
  if (e instanceof EroareApi) return e
  const err = e as EroarePg
  if (!err?.code) return e

  const cunoscuta = err.constraint ? mesajeConstrangeri[err.constraint] : undefined
  const detalii = { constrangere: err.constraint ?? null, cod_pg: err.code }

  switch (err.code) {
    // unique_violation / exclusion_violation — cineva a ajuns primul acolo.
    case '23505':
    case '23P01':
      return eroareConflict(cunoscuta?.mesaj ?? 'Există deja o înregistrare cu aceste date.', {
        camp: cunoscuta?.camp,
        detalii,
      })

    // foreign_key_violation — fie rândul referit lipsește, fie e ON DELETE RESTRICT.
    case '23503':
      return eroareConflict(
        cunoscuta?.mesaj ??
          'Înregistrarea este legată de altele și nu poate fi ștearsă sau modificată astfel.',
        { camp: cunoscuta?.camp, detalii },
      )

    case '23514': // check_violation
      return new EroareApi('validare', cunoscuta?.mesaj ?? 'Datele încalcă o regulă a bazei.', {
        camp: cunoscuta?.camp,
        detalii,
      })

    case '23502': // not_null_violation
      return new EroareApi('validare', `Câmpul „${err.column ?? '?'}” este obligatoriu.`, {
        camp: err.column,
        detalii,
      })

    // invalid_text_representation — un identificator care nu e UUID. Vine
    // dintr-o adresă greșită, deci este 404, nu 400: rândul chiar nu există.
    case '22P02':
      return eroareNegasit()

    default:
      return e
  }
}

// ---------------------------------------------------------------------------
// Legătura cu Express
// ---------------------------------------------------------------------------

/**
 * Împachetează un handler `async` ca respingerile lui să ajungă la middleware-ul
 * de erori.
 *
 * Express 4 nu așteaptă promisiunile: fără asta, orice `throw` dintr-un handler
 * asincron devine o respingere netratată, iar cererea rămâne agățată până la
 * timeout. Alternativa — `try/catch` în fiecare rută — este exact ce s-a scris
 * de treizeci de ori în varianta inițială, cu `500` pe tot ce trecea prin el.
 */
export function ruta(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

/** Middleware-ul final: singurul loc din server care compune un răspuns de eroare. */
export function trateazaErori(
  e: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(e)
    return
  }

  const eroare = dinEroarePostgres(e)

  if (eroare instanceof EroareApi) {
    res.status(eroare.status).json({
      mesaj: eroare.message,
      ...(eroare.camp ? { camp: eroare.camp } : {}),
      ...(eroare.detalii ? { detalii: eroare.detalii } : {}),
    })
    return
  }

  // Neprevăzută: în consolă cu tot cu stivă, către client doar atât cât trebuie.
  // Mesajul intern poate conține fragmente de SQL sau nume de coloane, care nu
  // au ce căuta pe ecranul recepției.
  console.error('[eroare netratată]', eroare)
  res.status(500).json({ mesaj: 'A apărut o eroare pe server. Încearcă din nou.' })
}
