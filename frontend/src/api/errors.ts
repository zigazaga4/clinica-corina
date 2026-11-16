/**
 * Erorile API, modelate după codurile HTTP pe care le va întoarce serverul.
 *
 * Implementarea în memorie aruncă exact aceleași erori ca implementarea HTTP,
 * astfel încât tratarea lor din module să nu se schimbe la trecerea pe backend
 * real. `camp` permite legarea unei erori de validare de un câmp din formular.
 */

export type CodEroare =
  | 'validare' // 400 — date invalide
  | 'neautentificat' // 401 — lipsă sau expirare token
  | 'interzis' // 403 — rol insuficient
  | 'negasit' // 404 — rândul nu există
  | 'conflict' // 409 — constrângere de bază încălcată
  | 'server' // 500 — orice altceva

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
  /** Numele câmpului din formular care a produs eroarea, dacă e cazul. */
  readonly camp: string | undefined
  /** Detalii suplimentare de la server (ex. constrângerea încălcată). */
  readonly detalii: Record<string, unknown> | undefined

  constructor(
    cod: CodEroare,
    message: string,
    optiuni?: { camp?: string; detalii?: Record<string, unknown> },
  ) {
    super(message)
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

/**
 * Participiul se acordă cu substantivul primit, nu cu „înregistrarea”.
 *
 * Aceeași regulă ca pe server (`backend/src/lib/erori.ts`), și trebuie să
 * rămână aceeași: modul demonstrativ și cel legat la server afișează aceleași
 * ecrane, iar un mesaj scris altfel în cele două ar apărea ca diferență de
 * comportament acolo unde nu există niciuna. Articolul hotărât spune genul:
 * „-ul” și „-le” sunt masculin sau neutru, restul feminin.
 */
const acordulLuiGasit = (ce: string): string =>
  /(ul|le)$/i.test(ce.trim().split(/\s+/)[0] ?? '') ? 'găsit' : 'găsită'

export const eroareNegasit = (ce = 'Înregistrarea') =>
  new EroareApi('negasit', `${ce} nu a fost ${acordulLuiGasit(ce)}.`)

export const eroareConflict = (mesaj: string, detalii?: Record<string, unknown>) =>
  new EroareApi('conflict', mesaj, detalii ? { detalii } : undefined)

export function esteEroareApi(e: unknown): e is EroareApi {
  return e instanceof EroareApi
}

/**
 * Câmpul după care se recunoaște „statisticile sunt încuiate”.
 *
 * Refuzul vine ca 403, nu 401 — sesiunea aplicației e în regulă, doar parola
 * statisticilor lipsește sau a expirat. Un 401 ar fi pornit reînnoirea
 * sesiunii și, la al doilea, delogarea. Câmpul îl deosebește de un 403 de rol.
 */
export const CAMP_ACCES_STATISTICI = 'acces_statistici'

export const eroareAccesStatistici = (
  mesaj = 'Statisticile sunt încuiate. Scrie parola lor ca să le vezi.',
) => new EroareApi('interzis', mesaj, { camp: CAMP_ACCES_STATISTICI })

/** Eroarea spune că statisticile trebuie deblocate (din nou)? */
export function esteStatisticiIncuiate(e: unknown): e is EroareApi {
  return esteEroareApi(e) && e.cod === 'interzis' && e.camp === CAMP_ACCES_STATISTICI
}

/**
 * Câmpul de formular vinovat de eroare, oriunde ar fi ajuns.
 *
 * Erorile de validare îl poartă direct în `camp`. Cele de conflict îl au în
 * `detalii`, alături de numele constrângerii încălcate — un e-mail duplicat
 * este un 409 despre câmpul `email`, nu o eroare fără adresă. Formularele
 * folosesc această funcție ca să nu fie nevoite să știe care este care.
 */
export function campVinovat(e: unknown): string | null {
  if (!esteEroareApi(e)) return null
  if (e.camp) return e.camp
  const dinDetalii = e.detalii?.['camp']
  return typeof dinDetalii === 'string' ? dinDetalii : null
}

/** Mesajul de afișat pentru orice eroare, inclusiv cele neprevăzute. */
export function mesajEroare(e: unknown): string {
  if (esteEroareApi(e)) return e.message
  if (e instanceof Error) return e.message
  // Partea de Windows a aplicației (Tauri) respinge cu text simplu, nu cu
  // `Error`: fără rândul acesta, motivul adevărat („forbidden path…”) se pierdea.
  if (typeof e === 'string' && e.trim()) return e
  return 'A apărut o eroare neașteptată.'
}
