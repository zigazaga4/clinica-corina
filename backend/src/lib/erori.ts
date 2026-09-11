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
 * În `detalii` intră numai lucruri care au sens pentru cine citește ecranul
 * (câte programări împiedică ștergerea, de pildă). Numele constrângerilor și
 * codurile SQLSTATE sunt hartă a bazei: pleacă în consola serverului, prin
 * `interne`, nu pe fir.
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
  | 'prea_mare'       // 413 — corpul cererii depășește limita
  | 'server'          // 500 — orice altceva

const statusPentruCod: Record<CodEroare, number> = {
  validare: 400,
  neautentificat: 401,
  interzis: 403,
  negasit: 404,
  conflict: 409,
  prea_mare: 413,
  server: 500,
}

export class EroareApi extends Error {
  readonly cod: CodEroare
  readonly status: number
  readonly camp: string | undefined
  readonly detalii: Record<string, unknown> | undefined
  /** Diagnostic pentru consola serverului. NU pleacă spre client. */
  readonly interne: Record<string, unknown> | undefined

  constructor(
    cod: CodEroare,
    mesaj: string,
    optiuni?: {
      camp?: string
      detalii?: Record<string, unknown>
      interne?: Record<string, unknown>
    },
  ) {
    super(mesaj)
    this.name = 'EroareApi'
    this.cod = cod
    this.status = statusPentruCod[cod]
    this.camp = optiuni?.camp
    this.detalii = optiuni?.detalii
    this.interne = optiuni?.interne
  }
}

export const eroareValidare = (mesaj: string, camp?: string) =>
  new EroareApi('validare', mesaj, camp ? { camp } : undefined)

export const eroareNeautentificat = (mesaj = 'Sesiune expirată. Autentifică-te din nou.') =>
  new EroareApi('neautentificat', mesaj)

export const eroareInterzis = (mesaj = 'Nu ai dreptul să efectuezi această operațiune.') =>
  new EroareApi('interzis', mesaj)

/**
 * Participiul se acordă cu substantivul primit, nu cu „înregistrarea”.
 *
 * `ce` vine din rută — „Clientul”, „Programarea”, „Punctul de lucru” — și
 * ajunge nemodificat în mesaj. Cu terminația fixă „găsită” ieșea „Clientul nu a
 * fost găsită.”, adică exact genul de româna stricată pe care o citește
 * recepția de zece ori pe zi. Articolul hotărât spune genul: „-ul” și „-le”
 * sunt masculin sau neutru, restul feminin.
 */
const acordulLuiGasit = (ce: string): string =>
  /(ul|le)$/i.test(ce.trim().split(/\s+/)[0] ?? '') ? 'găsit' : 'găsită'

export const eroareNegasit = (ce = 'Înregistrarea') =>
  new EroareApi('negasit', `${ce} nu a fost ${acordulLuiGasit(ce)}.`)

export const eroareConflict = (
  mesaj: string,
  optiuni?: {
    camp?: string
    detalii?: Record<string, unknown>
    interne?: Record<string, unknown>
  },
) => new EroareApi('conflict', mesaj, optiuni)

/** 413 — corpul cererii nu încape. Vine din `express.json()`, nu din rute. */
export const eroarePreaMare = (mesaj = 'Datele trimise sunt prea mari.') =>
  new EroareApi('prea_mare', mesaj)

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
  utilizator_nume_uk: {
    mesaj: 'Există deja un cont cu acest nume. Autentificarea se face după nume, deci două conturi nu pot purta același nume.',
    camp: 'nume',
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
 * Cererea din care a plecat interogarea refuzată.
 *
 * Numai cât trebuie ca să aflăm CINE a trimis valoarea pe care baza a respins-o:
 * un filtru din query string, un câmp din corp, sau identificatorul din adresă.
 * De asta atârnă și codul de stare, și `camp`.
 */
interface ContextCerere {
  query?: unknown
  body?: unknown
  originalUrl?: string
  path?: string
  url?: string
}

/** Literalul refuzat de bază: `pg` îl citează în mesaj — `… uuid: "nu-e-uuid"`. */
function valoareaRefuzata(mesaj: string | undefined): string | undefined {
  return /"([^"]+)"/.exec(mesaj ?? '')?.[1]
}

/**
 * Pragul din explicația unui `numeric field overflow`.
 *
 * Mesajul nu spune ce coloană a crăpat, dar detaliul spune cât încăpea:
 * „must round to an absolute value less than 10^8”. Cu pragul în mână putem
 * căuta în corpul cererii numărul care îl depășește — de obicei chiar acela e
 * câmpul de înroșit.
 */
function limitaDinDetaliu(detaliu: string | undefined): number | undefined {
  const potrivire = /less than 10\^(\d+)/.exec(detaliu ?? '')
  return potrivire ? Number(`1e${potrivire[1]}`) : undefined
}

/** Numele parametrului din query string care poartă exact această valoare. */
function campDinQuery(
  cerere: ContextCerere | undefined,
  valoare: string | undefined,
): string | undefined {
  const q = cerere?.query
  if (valoare === undefined || !q || typeof q !== 'object') return undefined
  for (const [nume, brut] of Object.entries(q as Record<string, unknown>)) {
    const valori = Array.isArray(brut) ? brut : [brut]
    if (valori.some((v) => typeof v === 'string' && v === valoare)) return nume
  }
  return undefined
}

/**
 * Caută valoarea prin corpul cererii și întoarce numele câmpului care o poartă.
 *
 * Coboară și în liniile unui bon: `linii[0].cantitate` este `cantitate` pentru
 * formular, care nu are altă căsuță de înroșit. Indicii de vector nu sunt nume
 * de câmp, deci nu se întorc niciodată.
 */
function campDinCorp(
  date: unknown,
  potrivit: (valoare: unknown) => boolean,
  adancime = 4,
): string | undefined {
  if (!date || typeof date !== 'object' || adancime === 0) return undefined
  for (const [nume, valoare] of Object.entries(date as Record<string, unknown>)) {
    if (valoare !== null && typeof valoare === 'object') {
      const gasit = campDinCorp(valoare, potrivit, adancime - 1)
      if (gasit) return gasit
    } else if (!/^\d+$/.test(nume) && potrivit(valoare)) {
      return nume
    }
  }
  return undefined
}

/** Adresa cerută, fără query string — acolo stau identificatorii din cale. */
function caleaCererii(cerere: ContextCerere | undefined): string {
  const brut = cerere?.originalUrl ?? cerere?.path ?? cerere?.url ?? ''
  const fara = brut.split('?')[0] ?? ''
  try {
    return decodeURIComponent(fara)
  } catch {
    return fara
  }
}

/**
 * Transformă o eroare `pg` într-una cu mesaj de citit.
 *
 * Ce nu recunoaște lasă neatins, ca să ajungă la 500 și în consolă — o eroare
 * de bază tradusă greșit este mai rea decât una netradusă.
 *
 * Clasa 22 (data exception) înseamnă întotdeauna „ce ai trimis tu nu intră în
 * coloana asta”: dată scrisă omenește, număr peste precizia coloanei, octet nul
 * într-un text. Netraduse, toate ieșeau 500 — adică „serverul s-a stricat”
 * pentru greșeli ale apelantului, pe care nimeni nu le putea corecta din mesaj.
 */
export function dinEroarePostgres(e: unknown, cerere?: ContextCerere): unknown {
  if (e instanceof EroareApi) return e
  const err = e as EroarePg
  if (!err?.code) return e

  const cunoscuta = err.constraint ? mesajeConstrangeri[err.constraint] : undefined
  // Numele constrângerii și SQLSTATE-ul sunt pentru jurnalul serverului. Pe
  // ecranul recepției n-au ce căuta, iar în mâna cuiva din afară cu atât mai
  // puțin: schema bazei se citește din ele constrângere cu constrângere.
  const interne = { constrangere: err.constraint ?? null, cod_pg: err.code }

  switch (err.code) {
    // unique_violation / exclusion_violation — cineva a ajuns primul acolo.
    case '23505':
    case '23P01':
      return eroareConflict(cunoscuta?.mesaj ?? 'Există deja o înregistrare cu aceste date.', {
        camp: cunoscuta?.camp,
        interne,
      })

    // foreign_key_violation — fie rândul referit lipsește, fie e ON DELETE RESTRICT.
    case '23503':
      return eroareConflict(
        cunoscuta?.mesaj ??
          'Înregistrarea este legată de altele și nu poate fi ștearsă sau modificată astfel.',
        { camp: cunoscuta?.camp, interne },
      )

    case '23514': // check_violation
      return new EroareApi('validare', cunoscuta?.mesaj ?? 'Datele încalcă o regulă a bazei.', {
        camp: cunoscuta?.camp,
        interne,
      })

    case '23502': // not_null_violation
      return new EroareApi('validare', `Câmpul „${err.column ?? '?'}” este obligatoriu.`, {
        camp: err.column,
        interne,
      })

    /*
      invalid_text_representation — un identificator care nu e UUID.

      Din CALE, rămâne 404: adresa arată către un rând care nu poate exista, iar
      contractul o cere așa. Din filtru sau din corp este însă altceva — cererea
      e greșit formulată, nu ținta lipsă — și un 404 acolo trimite operatoarea
      să caute o înregistrare ștearsă, în loc să-i arate căsuța de corectat.
    */
    case '22P02': {
      const valoare = valoareaRefuzata(err.message)
      if (valoare && !caleaCererii(cerere).includes(valoare)) {
        const camp =
          campDinQuery(cerere, valoare) ??
          campDinCorp(cerere?.body, (v) => typeof v === 'string' && v === valoare)
        if (camp) {
          return new EroareApi(
            'validare',
            `Valoarea trimisă pentru „${camp}” nu este un identificator valid.`,
            { camp, interne },
          )
        }
      }
      return eroareNegasit()
    }

    // numeric_value_out_of_range — numărul nu încape în coloană: fie depășește
    // int4, fie precizia unui `numeric(p,s)`.
    case '22003': {
      const valoare = valoareaRefuzata(err.message)
      const limita = limitaDinDetaliu(err.detail)
      const camp =
        campDinQuery(cerere, valoare) ??
        campDinCorp(cerere?.body, (v) => valoare !== undefined && String(v) === valoare) ??
        (limita === undefined
          ? undefined
          : campDinCorp(cerere?.body, (v) => {
              const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
              return Number.isFinite(n) && Math.abs(n) >= limita
            }))
      return new EroareApi(
        'validare',
        camp
          ? `Valoarea trimisă pentru „${camp}” depășește limita admisă.`
          : 'O valoare numerică trimisă depășește limita admisă.',
        { camp, interne },
      )
    }

    /*
      Datele calendaristice refuzate de bază: format invalid (22007), câmp în
      afara intervalului (22008) sau decalaj de fus imposibil (22009).

      Ajung aici mai ales filtrele — `?de_la=ieri` merge direct în interogare,
      fără să treacă prin validarea corpului.
    */
    case '22007':
    case '22008':
    case '22009': {
      const valoare = valoareaRefuzata(err.message)
      const camp =
        campDinQuery(cerere, valoare) ??
        campDinCorp(cerere?.body, (v) => typeof v === 'string' && v === valoare)
      return new EroareApi(
        'validare',
        camp
          ? `Valoarea trimisă pentru „${camp}” nu este o dată validă.`
          : 'Una dintre datele trimise nu este validă.',
        { camp, interne },
      )
    }

    // character_not_in_repertoire / untranslatable_character — de regulă un
    // octet nul strecurat într-un text. Textul e al apelantului, deci 400.
    case '22021':
    case '22P05':
      return new EroareApi('validare', 'Textul trimis conține caractere nepermise.', { interne })

    case '22001': // string_data_right_truncation
      return new EroareApi('validare', 'Textul trimis depășește lungimea admisă.', {
        camp: err.column,
        interne,
      })

    default:
      return e
  }
}

// ---------------------------------------------------------------------------
// Erorile de dinaintea rutelor
// ---------------------------------------------------------------------------

/**
 * Ce aruncă `express.json()` înainte ca vreo rută să fie atinsă.
 *
 * Un corp trunchiat, o virgulă în plus sau un fișier de doi megaocteți lipit în
 * locul unui formular ieșeau toate 500, adică „serverul s-a stricat” pentru o
 * cerere pe care serverul a refuzat-o pe bună dreptate. `body-parser` spune
 * exact ce s-a întâmplat în `type`; traducem doar atât, restul rămâne 500.
 */
export function dinEroareCorp(e: unknown): unknown {
  if (e instanceof EroareApi) return e
  const err = e as { type?: string; expose?: boolean }
  switch (err?.type) {
    case 'entity.too.large':
      return eroarePreaMare()
    case 'entity.parse.failed':
      return eroareValidare('Corpul cererii nu este un JSON valid.')
    case 'entity.verify.failed':
    case 'request.aborted':
    case 'request.size.invalid':
    case 'parameters.too.many':
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return eroareValidare('Cererea nu a putut fi citită.')
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
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(e)
    return
  }

  // Cererea se dă mai departe traducerii: din ea se află dacă valoarea refuzată
  // de bază a venit din cale, dintr-un filtru sau din corp.
  const eroare = dinEroarePostgres(dinEroareCorp(e), req)

  if (eroare instanceof EroareApi) {
    // Diagnosticul rămâne în consolă, unde îl caută cine repară; răspunsul
    // poartă doar ce poate folosi cel care a greșit cererea.
    if (eroare.interne) {
      console.warn('[eroare tradusă]', req.method, req.originalUrl, {
        mesaj: eroare.message,
        camp: eroare.camp ?? null,
        ...eroare.interne,
      })
    }

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
