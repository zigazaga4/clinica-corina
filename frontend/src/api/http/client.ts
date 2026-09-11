/**
 * Implementarea contractului peste HTTP.
 *
 * Nu este folosită cât timp lucrăm pe date în memorie, dar este scrisă complet
 * și ține pasul cu contractul. Când serverul devine disponibil, se pornește
 * cu o singură variabilă de mediu:
 *
 *     VITE_API_URL=https://api.clinica.ro
 *
 * Nicio componentă nu se modifică. Rutele și numele parametrilor de mai jos
 * sunt exact cele din §7 al specificației tehnice — dacă serverul le respectă,
 * aplicația funcționează fără ajustări.
 */

import type {
  ApiClient,
  FiltruArticole,
  FiltruClienti,
  FiltruConsimtaminte,
  FiltruJurnal,
  FiltruNotite,
  FiltruProgramari,
  FiltruVanzari,
  Paginat,
  PretSugerat,
  RaspunsLogin,
} from '@/api/contract'
import { EroareApi, type CodEroare } from '@/api/errors'
import {
  aExpirat,
  citesteTokenuri,
  scrieTokenuri,
  stergeTokenuri,
} from '@/api/session'
import type {
  Articol,
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  NotaClientDetaliu,
  NotitaDetaliu,
  ProgramareDetaliu,
  PunctLucru,
  Utilizator,
  VanzareDetaliu,
} from '@/domain/types'

type Metoda = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const codPentruStatus = (status: number): CodEroare => {
  if (status === 400 || status === 422) return 'validare'
  if (status === 401) return 'neautentificat'
  if (status === 403) return 'interzis'
  if (status === 404) return 'negasit'
  if (status === 409) return 'conflict'
  return 'server'
}

/**
 * Construiește query string-ul, sărind peste valorile absente.
 *
 * Primește `object`, nu `Record<string, unknown>`: filtrele sunt interfețe cu
 * câmpuri cunoscute, iar acelea nu au semnătură de index. Iterarea prin
 * `Object.entries` este oricum sigură la execuție.
 */
function qs(parametri: object | undefined): string {
  if (!parametri) return ''
  const cauta = new URLSearchParams()
  for (const [cheie, valoare] of Object.entries(parametri)) {
    if (valoare === undefined || valoare === null || valoare === '') continue
    if (Array.isArray(valoare)) {
      // Valorile multiple se repetă: ?stare=programat&stare=onorat
      for (const v of valoare) cauta.append(cheie, String(v))
    } else {
      cauta.append(cheie, String(valoare))
    }
  }
  const text = cauta.toString()
  return text ? `?${text}` : ''
}

export function creeazaApiHttp(baseUrl: string): ApiClient {
  const radacina = baseUrl.replace(/\/+$/, '')

  /** Reînnoirea se face o singură dată chiar dacă mai multe cereri o cer. */
  let reinnoireInCurs: Promise<void> | null = null

  async function reinnoiesteTokenul(): Promise<void> {
    const tokenuri = citesteTokenuri()
    if (!tokenuri) throw new EroareApi('neautentificat', 'Nu există o sesiune activă.')

    const raspuns = await fetch(`${radacina}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokenuri.refresh_token }),
    })

    if (!raspuns.ok) {
      stergeTokenuri()
      throw new EroareApi('neautentificat', 'Sesiune expirată. Autentifică-te din nou.')
    }

    const date = (await raspuns.json()) as RaspunsLogin
    scrieTokenuri({
      access_token: date.access_token,
      refresh_token: date.refresh_token,
      expira_la: date.expira_la,
    })
  }

  /**
   * O cerere autentificată.
   *
   * Reînnoiește proactiv token-ul aproape expirat și reia o singură dată la
   * 401 — un al doilea 401 după reînnoire înseamnă că sesiunea chiar s-a
   * încheiat, iar reluarea la nesfârșit ar bloca interfața într-o buclă.
   */
  async function cerere<T>(
    metoda: Metoda,
    cale: string,
    optiuni: {
      corp?: unknown
      parametri?: object
      public?: boolean
      /**
       * Răspunsul este un fișier, nu JSON — se întoarce ca `Blob`.
       *
       * Trece tot pe aici, și nu printr-o funcție separată, ca să moștenească
       * reînnoirea token-ului și reluarea la 401. Un PDF cerut cu o sesiune
       * expirată ar fi întors altfel o pagină de eroare deghizată în fișier.
       */
      binar?: boolean
    } = {},
  ): Promise<T> {
    if (!optiuni.public) {
      const tokenuri = citesteTokenuri()
      if (!tokenuri) throw new EroareApi('neautentificat', 'Nu ești autentificat.')
      if (aExpirat(tokenuri)) {
        reinnoireInCurs ??= reinnoiesteTokenul().finally(() => {
          reinnoireInCurs = null
        })
        await reinnoireInCurs
      }
    }

    const executa = async (): Promise<Response> => {
      const antete: Record<string, string> = {
        Accept: optiuni.binar ? 'application/pdf' : 'application/json',
      }
      if (optiuni.corp !== undefined) antete['Content-Type'] = 'application/json'
      if (!optiuni.public) {
        const t = citesteTokenuri()
        if (t) antete['Authorization'] = `Bearer ${t.access_token}`
      }
      return fetch(`${radacina}${cale}${qs(optiuni.parametri)}`, {
        method: metoda,
        headers: antete,
        body: optiuni.corp === undefined ? undefined : JSON.stringify(optiuni.corp),
      })
    }

    let raspuns: Response
    try {
      raspuns = await executa()
    } catch {
      // fetch respinge doar la eroare de rețea; art. 2.4 — aplicația cere internet.
      throw new EroareApi('server', 'Serverul nu poate fi contactat. Verifică conexiunea.')
    }

    if (raspuns.status === 401 && !optiuni.public) {
      reinnoireInCurs ??= reinnoiesteTokenul().finally(() => {
        reinnoireInCurs = null
      })
      await reinnoireInCurs
      raspuns = await executa()
    }

    if (raspuns.status === 204) return undefined as T

    // Numai când a mers: un răspuns de eroare are corp JSON, chiar dacă s-a
    // cerut un fișier, și trebuie citit ca text mai jos ca să se afle motivul.
    if (optiuni.binar && raspuns.ok) return (await raspuns.blob()) as T

    const text = await raspuns.text()
    const date: unknown = text ? safeJson(text) : null

    if (!raspuns.ok) {
      const corp = (date ?? {}) as { mesaj?: string; message?: string; camp?: string }
      throw new EroareApi(
        codPentruStatus(raspuns.status),
        corp.mesaj ?? corp.message ?? `Cererea a eșuat (${raspuns.status}).`,
        corp.camp ? { camp: corp.camp } : undefined,
      )
    }

    return date as T
  }

  return {
    auth: {
      login: (credentiale) =>
        cerere<RaspunsLogin>('POST', '/auth/login', { corp: credentiale, public: true }),
      refresh: (refresh_token) =>
        cerere<RaspunsLogin>('POST', '/auth/refresh', { corp: { refresh_token }, public: true }),
      logout: (refresh_token) =>
        cerere<void>('POST', '/auth/logout', { corp: { refresh_token } }),
      utilizatorCurent: async () => {
        if (!citesteTokenuri()) return null
        try {
          return await cerere<Utilizator>('GET', '/auth/eu')
        } catch {
          return null
        }
      },
    },

    clienti: {
      list: (filtru?: FiltruClienti) =>
        cerere<Paginat<ClientListItem>>('GET', '/clienti', { parametri: filtru }),
      get: (id) => cerere<Client>('GET', `/clienti/${id}`),
      create: (date) => cerere<Client>('POST', '/clienti', { corp: date }),
      update: (id, date) => cerere<Client>('PATCH', `/clienti/${id}`, { corp: date }),
      arhiveaza: (id) => cerere<Client>('POST', `/clienti/${id}/arhivare`),
      dezarhiveaza: (id) => cerere<Client>('POST', `/clienti/${id}/dezarhivare`),
      remove: (id) => cerere<void>('DELETE', `/clienti/${id}`),
      istoric: (id) => cerere<IstoricIntrare[]>('GET', `/clienti/${id}/istoric`),
      note: (id) => cerere<NotaClientDetaliu[]>('GET', `/clienti/${id}/note`),
      adaugaNota: (id, text) =>
        cerere<NotaClientDetaliu>('POST', `/clienti/${id}/note`, { corp: { text } }),
    },

    consimtaminte: {
      list: (filtru?: FiltruConsimtaminte) =>
        cerere<Paginat<ConsimtamantDetaliu>>('GET', '/consimtaminte', { parametri: filtru }),
      get: (id) => cerere<ConsimtamantDetaliu>('GET', `/consimtaminte/${id}`),
      create: (date) => cerere<ConsimtamantDetaliu>('POST', '/consimtaminte', { corp: date }),
      document: (id) => cerere<Blob>('GET', `/consimtaminte/${id}/document`, { binar: true }),
      remove: (id) => cerere<void>('DELETE', `/consimtaminte/${id}`),
    },

    programari: {
      list: (filtru?: FiltruProgramari) =>
        cerere<ProgramareDetaliu[]>('GET', '/programari', { parametri: filtru }),
      get: (id) => cerere<ProgramareDetaliu>('GET', `/programari/${id}`),
      create: (date) => cerere<ProgramareDetaliu>('POST', '/programari', { corp: date }),
      update: (id, date) =>
        cerere<ProgramareDetaliu>('PATCH', `/programari/${id}`, { corp: date }),
      schimbaStarea: (id, stare, achitat) =>
        cerere<ProgramareDetaliu>('PATCH', `/programari/${id}/stare`, {
          // `achitat` se trimite doar când a fost cerut: un `false` explicit ar
          // sugera serverului o decizie de plată acolo unde nu s-a luat niciuna.
          corp: achitat === undefined ? { stare } : { stare, achitat },
        }),
      pretSugerat: (client_id, articol_id) =>
        cerere<PretSugerat>('GET', '/programari/pret-sugerat', {
          parametri: { client_id, articol_id },
        }),
    },

    notite: {
      list: (filtru?: FiltruNotite) =>
        cerere<NotitaDetaliu[]>('GET', '/notite', { parametri: filtru }),
      get: (id) => cerere<NotitaDetaliu>('GET', `/notite/${id}`),
      create: (date) => cerere<NotitaDetaliu>('POST', '/notite', { corp: date }),
      update: (id, date) => cerere<NotitaDetaliu>('PATCH', `/notite/${id}`, { corp: date }),
      remove: (id) => cerere<void>('DELETE', `/notite/${id}`),
    },

    vanzari: {
      list: (filtru?: FiltruVanzari) =>
        cerere<Paginat<VanzareDetaliu>>('GET', '/vanzari', { parametri: filtru }),
      get: (id) => cerere<VanzareDetaliu>('GET', `/vanzari/${id}`),
      create: (date) => cerere<VanzareDetaliu>('POST', '/vanzari', { corp: date }),
      update: (id, date) => cerere<VanzareDetaliu>('PATCH', `/vanzari/${id}`, { corp: date }),
      incaseaza: (date) => cerere<VanzareDetaliu>('POST', '/vanzari/incasare', { corp: date }),
    },

    articole: {
      list: (filtru?: FiltruArticole) =>
        cerere<Articol[]>('GET', '/articole', { parametri: filtru }),
      create: (date) => cerere<Articol>('POST', '/articole', { corp: date }),
      update: (id, date) => cerere<Articol>('PATCH', `/articole/${id}`, { corp: date }),
    },

    puncteLucru: {
      list: (filtru) => cerere<PunctLucru[]>('GET', '/puncte-lucru', { parametri: filtru }),
      create: (date) => cerere<PunctLucru>('POST', '/puncte-lucru', { corp: date }),
      update: (id, date) => cerere<PunctLucru>('PATCH', `/puncte-lucru/${id}`, { corp: date }),
    },

    utilizatori: {
      list: (filtru) => cerere<Utilizator[]>('GET', '/utilizatori', { parametri: filtru }),
      create: (date) => cerere<Utilizator>('POST', '/utilizatori', { corp: date }),
      update: (id, date) => cerere<Utilizator>('PATCH', `/utilizatori/${id}`, { corp: date }),
      reseteazaParola: (id, parola_noua) =>
        cerere<void>('POST', `/utilizatori/${id}/reset-parola`, { corp: { parola_noua } }),
    },

    jurnal: {
      list: (filtru?: FiltruJurnal) =>
        cerere<Paginat<JurnalOperatiuneDetaliu>>('GET', '/jurnal', { parametri: filtru }),
    },
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
