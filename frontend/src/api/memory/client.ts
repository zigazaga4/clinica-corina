/**
 * Implementarea contractului API peste tabelele din memorie.
 *
 * Regulile pe care le aplică nu sunt aproximări „cât să meargă interfața”: sunt
 * aceleași verificări de rol din coloana „Acces Rol” a §7 și aceleași
 * constrângeri din DDL-ul §8. Dacă un formular trece pe aici, va trece și pe
 * serverul real; dacă e respins aici, ar fi fost respins și acolo.
 *
 * Fiecare metodă poartă în comentariu ruta HTTP pe care o înlocuiește.
 */

import type {
  AccesStatistici,
  ApiClient,
  DateArticolModificat,
  DateArticolNou,
  DateCheltuialaModificata,
  DateCheltuialaNoua,
  DateClientModificat,
  DateClientNou,
  DateConsimtamantNou,
  DateIncasare,
  DateLinieVanzare,
  DateNotitaModificata,
  DateNotitaNoua,
  DateProgramLucru,
  DatePunctLucruModificat,
  DatePunctLucruNou,
  DateProgramareModificata,
  DateProgramareNoua,
  DateTratamentModificat,
  DateTratamentNou,
  DateUtilizatorModificat,
  DateUtilizatorNou,
  DateVanzareModificata,
  DateVanzareNoua,
  FiltruArticole,
  FiltruCheltuieli,
  FiltruClienti,
  FiltruConsimtaminte,
  FiltruJurnal,
  FiltruNotite,
  FiltruProgramLucru,
  FiltruProgramari,
  FiltruTratamente,
  FiltruVanzari,
  ListaCheltuieli,
  OptiuniStare,
  Paginat,
  PretSugerat,
  RaspunsLogin,
  ServiciuProgramare,
  StareParolaStatistici,
} from '@/api/contract'
import {
  campVinovat,
  eroareAccesStatistici,
  EroareApi,
  eroareConflict,
  eroareInterzis,
  eroareNeautentificat,
  eroareValidare,
} from '@/api/errors'
import { citesteTokenuri } from '@/api/session'
import type {
  Articol,
  Cheltuiala,
  CheltuialaDetaliu,
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  MetodaPlata,
  NotaClient,
  NotaClientDetaliu,
  Notita,
  NotitaDetaliu,
  ProgramLucru,
  Programare,
  ProgramareDetaliu,
  PunctLucru,
  RaportStatistici,
  StareProgramare,
  Timestamptz,
  Tratament,
  TratamentDetaliu,
  Utilizator,
  Uuid,
  Vanzare,
  VanzareDetaliu,
  VanzareLinie,
} from '@/domain/types'
import { METODE_PLATA } from '@/domain/labels'
import { acum, addDays, laTimestamptz } from '@/lib/dates'
import { uuid } from '@/lib/id'
import { rotunjeste, sumaTotal, totalLinie } from '@/lib/money'
import { contine, doarCifre, normalizeaza } from '@/lib/text'
import {
  ceruta,
  ceruteText,
  dataCeruta,
  textOptional,
  verificaArticolProgramabil,
  verificaCantitate,
  verificaDenumirePunctUnica,
  verificaDurataArticol,
  verificaEmailUnic,
  verificaFormatEmail,
  verificaIntervalProgramare,
  verificaNumarSedinte,
  verificaParola,
  verificaPret,
  verificaStergereClient,
  verificaSumaPozitiva,
} from './constraints'
import {
  hidrateazaCheltuiala,
  hidrateazaClient,
  hidrateazaConsimtamant,
  hidrateazaJurnal,
  hidrateazaNota,
  hidrateazaNotita,
  hidrateazaProgramare,
  hidrateazaTratament,
  hidrateazaVanzare,
  incasareaProgramarii,
  utilizatorPublic,
} from './hydrate'
import { diferenta, instantaneu, scrieJurnal } from './journal'
import { populeaza } from './seed'
import { calculeazaRaport } from './statistici'
import {
  inTranzactie,
  magazin,
  type RandConsimtamant,
  type RandSesiune,
  type RandUtilizator,
} from './store'

// ---------------------------------------------------------------------------
// Latență simulată
// ---------------------------------------------------------------------------

/**
 * Fără o întârziere, fiecare cerere s-ar rezolva în aceeași bifă de event loop,
 * iar stările de încărcare, butoanele dezactivate în timpul salvării și
 * schimbările optimiste nu s-ar vedea niciodată — nici în dezvoltare, nici la
 * prezentare. Cu ea, interfața este construită împotriva unei rețele reale.
 *
 * Testele o dezactivează prin `configureazaLatenta(0)`.
 */
let latentaMin = 90
let latentaMax = 220

export function configureazaLatenta(min: number, max = min): void {
  latentaMin = min
  latentaMax = max
}

const intarziere = (): Promise<void> =>
  new Promise((rezolva) => {
    const ms = latentaMin + Math.random() * Math.max(0, latentaMax - latentaMin)
    if (ms <= 0) rezolva()
    else setTimeout(rezolva, ms)
  })

// ---------------------------------------------------------------------------
// Sesiuni și autorizare
// ---------------------------------------------------------------------------

const DURATA_ACCESS_MINUTE = 30
const DURATA_REFRESH_ZILE = 30

/** `acc.<id_sesiune>.<expirare_ms>` — echivalentul unui JWT, fără criptografie. */
const compuneAccessToken = (sesiune_id: Uuid, expira: number) => `acc.${sesiune_id}.${expira}`

function descompuneAccessToken(token: string): { sesiune_id: Uuid; expira: number } | null {
  const parti = token.split('.')
  if (parti.length !== 3 || parti[0] !== 'acc') return null
  const expira = Number(parti[2])
  if (!Number.isFinite(expira)) return null
  return { sesiune_id: parti[1] as Uuid, expira }
}

/** Sesiunea validă din spatele token-ului curent, sau null. */
function sesiuneCurenta(): RandSesiune | null {
  const tokenuri = citesteTokenuri()
  if (!tokenuri) return null

  const descompus = descompuneAccessToken(tokenuri.access_token)
  if (!descompus) return null
  if (descompus.expira <= Date.now()) return null

  const sesiune = magazin.sesiune.get(descompus.sesiune_id)
  if (!sesiune) return null
  if (sesiune.revocata_la !== null) return null
  if (sesiune.expira_la <= acum()) return null

  return sesiune
}

/** Utilizatorul autentificat, sau null dacă sesiunea lipsește ori a expirat. */
function utilizatorCurentSauNull(): RandUtilizator | null {
  const sesiune = sesiuneCurenta()
  if (!sesiune) return null
  const utilizator = magazin.utilizator.get(sesiune.utilizator_id)
  // Contul dezactivat între timp nu mai are acces, chiar cu sesiune validă.
  if (!utilizator || !utilizator.activ) return null
  return utilizator
}

/** Rutele marcate „orice” în §7 — cer doar să fii autentificat. */
function cereUtilizator(): RandUtilizator {
  const utilizator = utilizatorCurentSauNull()
  if (!utilizator) throw eroareNeautentificat()
  return utilizator
}

/** Rutele marcate „administrator” în §7. */
function cereAdministrator(): RandUtilizator {
  const utilizator = cereUtilizator()
  if (utilizator.rol !== 'administrator') {
    throw eroareInterzis('Această operațiune este permisă doar administratorului.')
  }
  return utilizator
}

// ---------------------------------------------------------------------------
// Parola statisticilor — v. `backend/src/middleware/acces-statistici.ts`
// ---------------------------------------------------------------------------

/** Cât ține o deblocare, ca pe server. */
const DURATA_ACCES_STATISTICI_MINUTE = 60

/**
 * Deblocarea curentă — echivalentul jetonului de pe server, legat la fel: de
 * cont, de sesiune și de parola cu care s-a deschis. Stă în memoria modulului,
 * nu în `localStorage`: o reîncărcare încuie statisticile.
 */
let accesStatistici: {
  utilizator_id: Uuid
  sesiune_id: Uuid
  versiune: string
  expira: number
} | null = null

/** Amprenta parolei curente: se schimbă la fiecare alegere a ei. */
const versiuneParolaStatistici = (): string | null =>
  magazin.parola_statistici
    ? `${magazin.parola_statistici.actualizat_la}|${magazin.parola_statistici.parola_hash}`
    : null

function deschideStatisticile(utilizator: RandUtilizator): AccesStatistici {
  const expira = Date.now() + DURATA_ACCES_STATISTICI_MINUTE * 60_000
  accesStatistici = {
    utilizator_id: utilizator.id,
    sesiune_id: sesiuneCurenta()?.id ?? '',
    versiune: versiuneParolaStatistici() ?? '',
    expira,
  }
  return { expira_la: new Date(expira).toISOString() }
}

/** Rutele din spatele parolei statisticilor: întâi contul, apoi deblocarea. */
function cereAccesStatistici(): RandUtilizator {
  const utilizator = cereUtilizator()
  const acces = accesStatistici
  if (!acces) throw eroareAccesStatistici()
  if (acces.expira <= Date.now()) {
    accesStatistici = null
    throw eroareAccesStatistici('Statisticile s-au încuiat singure după o oră. Scrie din nou parola.')
  }
  if (acces.utilizator_id !== utilizator.id || acces.sesiune_id !== sesiuneCurenta()?.id) {
    throw eroareAccesStatistici()
  }
  if (acces.versiune !== versiuneParolaStatistici()) {
    accesStatistici = null
    throw eroareAccesStatistici('Parola statisticilor s-a schimbat. Scrie parola nouă.')
  }
  return utilizator
}

/** Are sesiunea statisticile deblocate? Pentru jurnal, care doar ascunde banii. */
function areAccesStatistici(): boolean {
  try {
    cereAccesStatistici()
    return true
  } catch {
    return false
  }
}

/** Entitățile ale căror date din jurnal se văd doar cu statisticile deblocate. */
const ENTITATI_CU_BANI = new Set(['cheltuiala'])

/**
 * Categoria cheltuielii, scrisă ca data trecută: „chirie” se lipește de
 * „Chirie”, altfel graficul ar fi arătat chiria în două felii.
 */
function categoriaCheltuielii(valoare: string | undefined): string {
  const categorie = ceruteText(valoare, 'categorie', 'Categoria')
  const existenta = [...magazin.cheltuiala.values()]
    .filter((c) => c.categorie.toLowerCase() === categorie.toLowerCase())
    .sort((a, b) => a.creat_la.localeCompare(b.creat_la))[0]
  return existenta?.categorie ?? categorie
}

// ---------------------------------------------------------------------------
// Ajutătoare comune
// ---------------------------------------------------------------------------

function pagineaza<T>(randuri: T[], pagina = 1, pe_pagina = 25): Paginat<T> {
  const p = Math.max(1, Math.floor(pagina))
  const n = Math.max(1, Math.floor(pe_pagina))
  const inceput = (p - 1) * n
  return {
    randuri: randuri.slice(inceput, inceput + n),
    total: randuri.length,
    pagina: p,
    pe_pagina: n,
  }
}

/** Marchează rândul ca modificat, exact ca trigger-ul `set_actualizat_la`. */
function atinge<T extends { actualizat_la: Timestamptz }>(rand: T): T {
  rand.actualizat_la = acum()
  return rand
}

/** Este momentul în intervalul cerut? Capetele lipsă înseamnă „fără limită”. */
function inInterval(moment: Timestamptz, de_la?: Timestamptz, pana_la?: Timestamptz): boolean {
  if (de_la && moment < de_la) return false
  if (pana_la && moment > pana_la) return false
  return true
}

// ---------------------------------------------------------------------------
// Clientul
// ---------------------------------------------------------------------------

/** Populează tabelele o singură dată, la primul import. */
let populat = false
function asigurraDate(): void {
  if (populat) return
  populeaza()
  populat = true
}

/** Reface datele demo de la zero. Toate sesiunile devin invalide. */
export function reseteazaDateleDemo(): void {
  populeaza()
  populat = true
}

export function creeazaApiInMemorie(): ApiClient {
  asigurraDate()

  return {
    // =======================================================================
    // Autentificare
    // =======================================================================
    auth: {
      /** POST /auth/login */
      async login({ email, parola, dispozitiv }): Promise<RaspunsLogin> {
        await intarziere()

        const cautat = normalizeaza(email)
        let gasit: RandUtilizator | undefined
        for (const u of magazin.utilizator.values()) {
          if (normalizeaza(u.email) === cautat) {
            gasit = u
            break
          }
        }

        // Același mesaj pentru e-mail inexistent și parolă greșită: altfel
        // formularul devine un instrument de aflat ce conturi există.
        if (!gasit || gasit.parola_hash !== parola) {
          throw eroareValidare('E-mail sau parolă incorecte.', 'parola')
        }
        if (!gasit.activ) {
          throw eroareInterzis('Acest cont este dezactivat. Contactează administratorul.')
        }

        const acumIso = acum()
        const sesiune: RandSesiune = {
          id: uuid(),
          utilizator_id: gasit.id,
          token_hash: uuid(),
          emisa_la: acumIso,
          expira_la: laTimestamptz(addDays(new Date(), DURATA_REFRESH_ZILE)),
          revocata_la: null,
          dispozitiv: dispozitiv ?? null,
        }
        magazin.sesiune.set(sesiune.id, sesiune)

        gasit.ultima_autentificare = acumIso
        atinge(gasit)

        scrieJurnal({
          utilizator_id: gasit.id,
          actiune: 'autentificare',
          entitate: 'sesiune',
          entitate_id: sesiune.id,
          date_noi: { email: gasit.email, dispozitiv: sesiune.dispozitiv },
        })

        const expira = Date.now() + DURATA_ACCESS_MINUTE * 60_000
        return {
          access_token: compuneAccessToken(sesiune.id, expira),
          refresh_token: `ref.${sesiune.id}.${sesiune.token_hash}`,
          expira_la: new Date(expira).toISOString(),
          utilizator: utilizatorPublic(gasit),
        }
      },

      /** POST /auth/refresh */
      async refresh(refresh_token): Promise<RaspunsLogin> {
        await intarziere()

        const parti = refresh_token.split('.')
        if (parti.length !== 3 || parti[0] !== 'ref') throw eroareNeautentificat()

        const sesiune = magazin.sesiune.get(parti[1] as Uuid)
        if (!sesiune || sesiune.token_hash !== parti[2]) throw eroareNeautentificat()
        if (sesiune.revocata_la !== null) throw eroareNeautentificat()
        if (sesiune.expira_la <= acum()) throw eroareNeautentificat('Sesiunea a expirat.')

        const utilizator = magazin.utilizator.get(sesiune.utilizator_id)
        if (!utilizator || !utilizator.activ) throw eroareNeautentificat()

        const expira = Date.now() + DURATA_ACCESS_MINUTE * 60_000
        return {
          access_token: compuneAccessToken(sesiune.id, expira),
          refresh_token,
          expira_la: new Date(expira).toISOString(),
          utilizator: utilizatorPublic(utilizator),
        }
      },

      /** POST /auth/logout */
      async logout(refresh_token): Promise<void> {
        await intarziere()
        accesStatistici = null
        const parti = refresh_token.split('.')
        const sesiune = parti.length === 3 ? magazin.sesiune.get(parti[1] as Uuid) : undefined
        // Delogarea unei sesiuni deja revocate nu este o eroare.
        if (sesiune && sesiune.revocata_la === null) sesiune.revocata_la = acum()
      },

      async utilizatorCurent(): Promise<Utilizator | null> {
        const utilizator = utilizatorCurentSauNull()
        return utilizator ? utilizatorPublic(utilizator) : null
      },
    },

    // =======================================================================
    // Clienți
    // =======================================================================
    clienti: {
      /** GET /clienti — orice rol */
      async list(filtru: FiltruClienti = {}): Promise<Paginat<ClientListItem>> {
        await intarziere()
        cereUtilizator()

        const q = (filtru.q ?? '').trim()
        const cifreCautate = doarCifre(q)

        let randuri: ClientListItem[] = []
        for (const c of magazin.client.values()) {
          if (!filtru.include_arhivati && c.arhivat_la !== null) continue

          if (q !== '') {
            const dupaNume = contine(c.nume, q)
            // O căutare din cifre vizează telefonul, nu numele.
            const dupaTelefon =
              cifreCautate.length >= 3 && doarCifre(c.telefon).includes(cifreCautate)
            const dupaEmail = contine(c.email, q)
            if (!dupaNume && !dupaTelefon && !dupaEmail) continue
          }

          randuri.push(hidrateazaClient(c))
        }

        const directie = filtru.directie === 'desc' ? -1 : 1
        const sortare = filtru.sortare ?? 'nume'
        randuri.sort((a, b) => {
          if (sortare === 'nume') {
            return directie * normalizeaza(a.nume).localeCompare(normalizeaza(b.nume), 'ro')
          }
          if (sortare === 'creat_la') return directie * a.creat_la.localeCompare(b.creat_la)
          // Clienții fără nicio vizită se așază la coadă, indiferent de direcție.
          const av = a.ultima_vizita
          const bv = b.ultima_vizita
          if (av === null && bv === null) return 0
          if (av === null) return 1
          if (bv === null) return -1
          return directie * av.localeCompare(bv)
        })

        return pagineaza(randuri, filtru.pagina, filtru.pe_pagina)
      },

      /** GET /clienti/:id — orice rol */
      async get(id): Promise<Client> {
        await intarziere()
        cereUtilizator()
        return { ...ceruta(magazin.client, id, 'Clientul') }
      },

      /** POST /clienti — orice rol */
      async create(date: DateClientNou): Promise<Client> {
        await intarziere()
        const autor = cereUtilizator()

        const rand: Client = {
          id: uuid(),
          nume: ceruteText(date.nume, 'nume', 'Numele clientului'),
          telefon: textOptional(date.telefon),
          email: textOptional(date.email),
          adresa: textOptional(date.adresa),
          data_nasterii: textOptional(date.data_nasterii),
          arhivat_la: null,
          creat_de: autor.id,
          creat_la: acum(),
          actualizat_la: acum(),
        }
        magazin.client.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'client',
          entitate_id: rand.id,
          date_noi: instantaneu(rand as unknown as Record<string, unknown>),
        })

        return { ...rand }
      },

      /** PATCH /clienti/:id — orice rol */
      async update(id, date: DateClientModificat): Promise<Client> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.client, id, 'Clientul')
        const inainte = { ...rand }

        if (date.nume !== undefined) rand.nume = ceruteText(date.nume, 'nume', 'Numele clientului')
        if (date.telefon !== undefined) rand.telefon = textOptional(date.telefon)
        if (date.email !== undefined) rand.email = textOptional(date.email)
        if (date.adresa !== undefined) rand.adresa = textOptional(date.adresa)
        if (date.data_nasterii !== undefined) rand.data_nasterii = textOptional(date.data_nasterii)
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'client',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return { ...rand }
      },

      /** POST /clienti/:id/arhivare — orice rol */
      async arhiveaza(id): Promise<Client> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.client, id, 'Clientul')

        if (rand.arhivat_la === null) {
          rand.arhivat_la = acum()
          atinge(rand)
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'arhivare',
            entitate: 'client',
            entitate_id: rand.id,
            date_vechi: { arhivat_la: null },
            date_noi: { arhivat_la: rand.arhivat_la },
          })
        }

        return { ...rand }
      },

      async dezarhiveaza(id): Promise<Client> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.client, id, 'Clientul')

        if (rand.arhivat_la !== null) {
          const inainte = rand.arhivat_la
          rand.arhivat_la = null
          atinge(rand)
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'client',
            entitate_id: rand.id,
            date_vechi: { arhivat_la: inainte },
            date_noi: { arhivat_la: null },
          })
        }

        return { ...rand }
      },

      /** DELETE /clienti/:id — doar administrator */
      async remove(id): Promise<void> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.client, id, 'Clientul')
        verificaStergereClient(id)

        // ON DELETE CASCADE pe nota_client.
        for (const [notaId, nota] of magazin.nota_client) {
          if (nota.client_id === id) magazin.nota_client.delete(notaId)
        }
        magazin.client.delete(id)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'stergere',
          entitate: 'client',
          entitate_id: id,
          date_vechi: instantaneu(rand as unknown as Record<string, unknown>),
        })
      },

      /** GET /clienti/:id/istoric — orice rol */
      async istoric(id): Promise<IstoricIntrare[]> {
        await intarziere()
        cereUtilizator()
        ceruta(magazin.client, id, 'Clientul')

        const intrari: IstoricIntrare[] = []
        for (const p of magazin.programare.values()) {
          if (p.client_id !== id) continue
          intrari.push({ fel: 'programare', la: p.incepe_la, programare: hidrateazaProgramare(p) })
        }
        for (const v of magazin.vanzare.values()) {
          if (v.client_id !== id) continue
          intrari.push({ fel: 'vanzare', la: v.efectuat_la, vanzare: hidrateazaVanzare(v) })
        }

        // Cel mai recent întâi — asta caută recepția când deschide fișa.
        intrari.sort((a, b) => b.la.localeCompare(a.la))
        return intrari
      },

      /** GET /clienti/:id/note — orice rol */
      async note(id): Promise<NotaClientDetaliu[]> {
        await intarziere()
        cereUtilizator()
        ceruta(magazin.client, id, 'Clientul')

        const note: NotaClientDetaliu[] = []
        for (const n of magazin.nota_client.values()) {
          if (n.client_id === id) note.push(hidrateazaNota(n))
        }
        note.sort((a, b) => b.creat_la.localeCompare(a.creat_la))
        return note
      },

      /** POST /clienti/:id/note — orice rol */
      async adaugaNota(id, text): Promise<NotaClientDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        ceruta(magazin.client, id, 'Clientul')

        const rand: NotaClient = {
          id: uuid(),
          client_id: id,
          autor_id: autor.id,
          text: ceruteText(text, 'text', 'Textul notei'),
          creat_la: acum(),
        }
        magazin.nota_client.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'nota_client',
          entitate_id: rand.id,
          date_noi: { client_id: id, text: rand.text },
        })

        return hidrateazaNota(rand)
      },
    },

    // =======================================================================
    // Consimțăminte
    // =======================================================================
    consimtaminte: {
      /** GET /consimtaminte — orice rol */
      async list(filtru: FiltruConsimtaminte = {}): Promise<Paginat<ConsimtamantDetaliu>> {
        await intarziere()
        cereUtilizator()

        const randuri: ConsimtamantDetaliu[] = []
        for (const c of magazin.consimtamant.values()) {
          if (filtru.client_id && c.client_id !== filtru.client_id) continue
          if (filtru.programare_id && c.programare_id !== filtru.programare_id) continue
          randuri.push(hidrateazaConsimtamant(c))
        }

        // Cele mai noi întâi, ca în `ORDER BY semnat_la DESC, id DESC`.
        randuri.sort((a, b) => b.semnat_la.localeCompare(a.semnat_la) || b.id.localeCompare(a.id))
        return pagineaza(randuri, filtru.pagina, filtru.pe_pagina)
      },

      /** GET /consimtaminte/:id — orice rol */
      async get(id): Promise<ConsimtamantDetaliu> {
        await intarziere()
        cereUtilizator()
        return hidrateazaConsimtamant(ceruta(magazin.consimtamant, id, 'Acordul'))
      },

      /** GET /consimtaminte/:id/document — orice rol */
      async document(id): Promise<Blob> {
        await intarziere()
        cereUtilizator()
        const rand = ceruta(magazin.consimtamant, id, 'Acordul')
        // Copie, nu chiar octeții din magazin: un `Blob` construit peste
        // tamponul viu ar lega fișierul descărcat de rândul din memorie.
        return new Blob([rand.document.slice()], { type: 'application/pdf' })
      },

      /** POST /consimtaminte — orice rol */
      async create(date: DateConsimtamantNou): Promise<ConsimtamantDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        ceruta(magazin.client, date.client_id, 'Clientul')
        if (date.programare_id) {
          ceruta(magazin.programare, date.programare_id, 'Programarea')
        }

        const document = pdfDinBase64(date.document)

        const rand: RandConsimtamant = {
          id: uuid(),
          client_id: date.client_id,
          programare_id: date.programare_id ?? null,
          versiune: ceruteText(date.versiune, 'versiune', 'Versiunea acordului'),
          document,
          marime: document.length,
          amprenta: await amprentaSha256(document),
          date_semnatar: {
            nume: ceruteText(date.date_semnatar?.nume, 'date_semnatar', 'Numele semnatarului'),
            telefon: textOptional(date.date_semnatar?.telefon),
            email: textOptional(date.date_semnatar?.email),
            adresa: textOptional(date.date_semnatar?.adresa),
          },
          dispozitiv: textOptional(date.dispozitiv),
          semnat_la: acum(),
          creat_de: autor.id,
        }
        magazin.consimtamant.set(rand.id, rand)

        // Ca pe server: în jurnal intră tot rândul FĂRĂ fișier. Amprenta
        // rămâne, și ea dovedește oricând că e vorba de același document.
        const { document: _fisier, ...faraFisier } = rand
        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'consimtamant',
          entitate_id: rand.id,
          date_noi: instantaneu(faraFisier as unknown as Record<string, unknown>),
        })

        return hidrateazaConsimtamant(rand)
      },

      /** DELETE /consimtaminte/:id — doar administrator */
      async remove(id): Promise<void> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.consimtamant, id, 'Acordul')

        const { document: _fisier, ...faraFisier } = rand
        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'stergere',
          entitate: 'consimtamant',
          entitate_id: id,
          date_vechi: instantaneu(faraFisier as unknown as Record<string, unknown>),
        })

        magazin.consimtamant.delete(id)
      },
    },

    // =======================================================================
    // Programări
    // =======================================================================
    programari: {
      /** GET /programari — orice rol */
      async list(filtru: FiltruProgramari = {}): Promise<ProgramareDetaliu[]> {
        await intarziere()
        cereUtilizator()

        const stari = filtru.stare && filtru.stare.length > 0 ? new Set(filtru.stare) : null

        const randuri: ProgramareDetaliu[] = []
        for (const p of magazin.programare.values()) {
          // O programare aparține intervalului dacă SE SUPRAPUNE cu el, nu doar
          // dacă începe în el: altfel una care traversează miezul nopții ar
          // dispărea din ziua în care se termină.
          if (filtru.de_la && p.se_termina_la <= filtru.de_la) continue
          if (filtru.pana_la && p.incepe_la >= filtru.pana_la) continue
          if (filtru.executant_id && p.executant_id !== filtru.executant_id) continue
          if (filtru.punct_lucru_id && p.punct_lucru_id !== filtru.punct_lucru_id) continue
          if (filtru.client_id && p.client_id !== filtru.client_id) continue
          if (filtru.tratament_id && p.tratament_id !== filtru.tratament_id) continue
          if (filtru.vizita_id && p.vizita_id !== filtru.vizita_id) continue
          if (stari && !stari.has(p.stare)) continue
          const detaliu = hidrateazaProgramare(p)
          if (filtru.neachitate && (detaliu.achitat || p.stare !== 'onorat')) continue
          randuri.push(detaliu)
        }

        randuri.sort((a, b) => a.incepe_la.localeCompare(b.incepe_la))
        return randuri
      },

      async get(id): Promise<ProgramareDetaliu> {
        await intarziere()
        cereUtilizator()
        return hidrateazaProgramare(ceruta(magazin.programare, id, 'Programarea'))
      },

      /**
       * POST /programari — orice rol. Cu `servicii`, programarea le are pe
       * toate; fără, unul singur, din `articol_id`. Întoarce primul serviciu.
       */
      async create(date: DateProgramareNoua): Promise<ProgramareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const lista = serviciiDin(date.servicii)
        const servicii: ServiciuProgramare[] = lista ?? [{
          articol_id: date.articol_id as Uuid,
          ...(date.pret === undefined ? {} : { pret: date.pret }),
          tratament_id: date.tratament_id ?? null,
        }]
        const locul = (i: number) => (lista ? i : null)

        return inTranzactie(() => {
          ceruta(magazin.client, date.client_id, 'Clientul')
          // Toate serviciile se verifică înaintea oricărei scrieri.
          const articole = servicii.map((s, i) =>
            peServiciu(locul(i), () => verificaArticolProgramabil(s.articol_id)))
          const executant = ceruta(magazin.utilizator, date.executant_id, 'Executantul')
          if (!executant.activ) {
            throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
          }
          const punct_lucru_id = date.punct_lucru_id ?? punctImplicit()
          ceruta(magazin.punct_lucru, punct_lucru_id, 'Punctul de lucru')
          verificaIntervalProgramare(date.incepe_la, date.se_termina_la)

          const vizita: VizitaNoua = {
            vizita_id: uuid(),
            client_id: date.client_id,
            executant_id: date.executant_id,
            punct_lucru_id,
            incepe_la: date.incepe_la,
            se_termina_la: date.se_termina_la,
            stare: 'programat',
            nota: textOptional(date.nota),
          }

          const randuri = servicii.map((s, i) =>
            peServiciu(locul(i), () => adaugaServiciu(autor.id, vizita, articole[i]!, s)))
          return hidrateazaProgramare(randuri[0]!)
        })
      },

      /**
       * PATCH /programari/:id — orice rol. Ce e comun (client, persoană,
       * interval, notă) se schimbă pe toată programarea; `servicii` este lista
       * ei completă de acum încolo. Aceleași reguli ca `routes/programari.ts`.
       */
      async update(id, date: DateProgramareModificata): Promise<ProgramareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const lista = serviciiDin(date.servicii)

        return inTranzactie(() => {
          const { ancora, randuri } = serviciileProgramarii(id)

          // Ce se schimbă pe fiecare serviciu. Fără listă, doar pe rândul cerut.
          const proprii = new Map<Uuid, { index: number | null; articol_id?: Uuid; pret?: number }>()
          const deAdaugat: { index: number; serviciu: ServiciuProgramare }[] = []
          let deScos: Programare[] = []
          if (!lista) {
            proprii.set(ancora.id, { index: null, articol_id: date.articol_id, pret: date.pret })
          } else {
            const pastrate = new Set<Uuid>()
            lista.forEach((s, i) => {
              if (!s.id) {
                deAdaugat.push({ index: i, serviciu: s })
                return
              }
              const rand = randuri.find((r) => r.id === s.id)
              if (!rand || pastrate.has(rand.id)) {
                throw eroareValidare('Serviciul nu face parte din această programare.', `servicii.${i}.id`)
              }
              pastrate.add(rand.id)
              proprii.set(rand.id, { index: i, articol_id: s.articol_id, pret: s.pret })
            })
            deScos = randuri.filter((r) => !pastrate.has(r.id))
          }
          const ramase = randuri.filter((r) => !deScos.includes(r))

          // Într-un tratament, clientul este al tratamentului: mutată, ședința
          // ar rămâne numărată la primul client. Se anulează și se face alta.
          if (date.client_id !== undefined && date.client_id !== ancora.client_id) {
            if (ramase.some((r) => r.tratament_id !== null)) {
              throw eroareValidare(
                'Ședința face parte dintr-un tratament; clientul nu se poate schimba. Anuleaz-o și fă alta.',
                'client_id',
              )
            }
            ceruta(magazin.client, date.client_id, 'Clientul')
          }
          if (date.executant_id !== undefined) {
            const executant = ceruta(magazin.utilizator, date.executant_id, 'Executantul')
            if (!executant.activ) {
              throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
            }
          }
          if (date.punct_lucru_id !== undefined && date.punct_lucru_id !== null) {
            ceruta(magazin.punct_lucru, date.punct_lucru_id, 'Punctul de lucru')
          }

          // Serviciul și prețul fiecărui rând păstrat, comparate cu ce era:
          // formularul retrimite toată lista, iar un serviciu încasat, trimis
          // neschimbat, nu are de ce să cadă.
          for (const [randId, m] of proprii) {
            const rand = randuri.find((r) => r.id === randId)!
            peServiciu(m.index, () => {
              if (m.articol_id !== undefined && m.articol_id !== rand.articol_id) {
                if (rand.tratament_id !== null) {
                  throw eroareValidare(
                    'Ședința face parte dintr-un tratament; serviciul nu se poate schimba. Anuleaz-o și fă alta.',
                    'articol_id',
                  )
                }
                if (incasareaProgramarii(rand.id) !== null) {
                  throw eroareValidare('Serviciul este deja încasat; nu se mai poate schimba.', 'articol_id')
                }
                verificaArticolProgramabil(m.articol_id)
              } else {
                m.articol_id = undefined
              }
              if (m.pret !== undefined) {
                verificaPret(m.pret, 'pret')
                if (m.pret === rand.pret) {
                  m.pret = undefined
                } else if (incasareaProgramarii(rand.id) !== null) {
                  // Prețul unei ședințe deja încasate nu se mai atinge: ar
                  // rămâne diferit de suma chiar plătită.
                  throw eroareValidare('Ședința este deja încasată; prețul ei nu se mai poate schimba.', 'pret')
                }
              }
            })
          }

          // Un serviciu încasat nu se scoate: bonul ar arăta plătit ceva ce nu s-a făcut.
          if (deScos.some((r) => incasareaProgramarii(r.id) !== null)) {
            throw eroareValidare(
              'Un serviciu deja încasat nu se poate scoate din programare; scoate-l mai întâi de pe bon.',
              'servicii',
            )
          }
          const articoleNoi = deAdaugat.map(({ index, serviciu }) =>
            peServiciu(index, () => verificaArticolProgramabil(serviciu.articol_id)))

          const dupa: VizitaNoua = {
            vizita_id: ancora.vizita_id,
            client_id: date.client_id ?? ancora.client_id,
            executant_id: date.executant_id ?? ancora.executant_id,
            punct_lucru_id: date.punct_lucru_id ?? ancora.punct_lucru_id,
            incepe_la: date.incepe_la ?? ancora.incepe_la,
            se_termina_la: date.se_termina_la ?? ancora.se_termina_la,
            stare: ancora.stare,
            nota: date.nota !== undefined ? textOptional(date.nota) : ancora.nota,
          }
          verificaIntervalProgramare(dupa.incepe_la, dupa.se_termina_la)

          // 1. Serviciile păstrate: ce e comun pe toate, plus ce e al fiecăruia.
          for (const rand of ramase) {
            const inainte = { ...rand }
            const m = proprii.get(rand.id)
            rand.client_id = dupa.client_id
            rand.executant_id = dupa.executant_id
            rand.punct_lucru_id = dupa.punct_lucru_id
            rand.incepe_la = dupa.incepe_la
            rand.se_termina_la = dupa.se_termina_la
            rand.nota = dupa.nota
            if (m?.articol_id !== undefined) rand.articol_id = m.articol_id
            if (m?.pret !== undefined) rand.pret = m.pret

            const dif = diferenta(
              inainte as unknown as Record<string, unknown>,
              rand as unknown as Record<string, unknown>,
            )
            if (dif) {
              atinge(rand)
              scrieJurnal({
                utilizator_id: autor.id,
                actiune: 'modificare',
                entitate: 'programare',
                entitate_id: rand.id,
                ...dif,
              })
            }
          }

          // 2. Cele scoase: o programare a lor, anulată — locul e al celorlalte.
          for (const rand of deScos) {
            const inainte = { stare: rand.stare, vizita_id: rand.vizita_id }
            rand.stare = 'anulat'
            rand.vizita_id = uuid()
            atinge(rand)
            scrieJurnal({
              utilizator_id: autor.id,
              actiune: 'modificare',
              entitate: 'programare',
              entitate_id: rand.id,
              date_vechi: inainte,
              date_noi: { stare: 'anulat', vizita_id: rand.vizita_id, motiv: 'scos din programare' },
            })
          }

          // 3. Cele noi, cu starea programării: adăugat la una deja onorată,
          // serviciul s-a făcut și el — și rămâne de plată.
          const noi = deAdaugat.map(({ index, serviciu }, k) =>
            peServiciu(index, () => adaugaServiciu(autor.id, dupa, articoleNoi[k]!, serviciu)))
          if (dupa.stare === 'onorat') {
            for (const rand of noi) incheieDacaEComplet(rand.tratament_id, autor.id)
          }

          // Rândul cerut, dacă a rămas în programare; altfel primul care a rămas.
          const raspuns = deScos.includes(ancora) ? (ramase[0] ?? noi[0])! : ancora
          return hidrateazaProgramare(raspuns)
        })
      },

      /**
       * PATCH /programari/:id/stare — orice rol. Starea e a PROGRAMĂRII: se pune
       * pe toate serviciile ei, iar `achitat` le încasează pe un singur bon.
       */
      async schimbaStarea(
        id,
        stare: StareProgramare,
        optiuni: OptiuniStare = {},
      ): Promise<ProgramareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const { achitat, pret, preturi } = optiuni
        const metoda_plata = achitat === true ? metodaPlataDin(optiuni.metoda_plata) : null

        return inTranzactie(() => {
          const { ancora, randuri } = serviciileProgramarii(id)

          // Sumele corectate la închidere — cât s-a luat de fapt, pe fiecare
          // serviciu. Pe unul deja încasat nu se mai ating, ca la PATCH.
          const corectate = new Map<Uuid, { pret: number; camp: string }>()
          if (pret !== undefined) corectate.set(ancora.id, { pret, camp: 'pret' })
          for (const [randId, suma] of Object.entries(preturi ?? {})) {
            const camp = `preturi.${randId}`
            if (!randuri.some((r) => r.id === randId)) {
              throw eroareValidare('Serviciul nu face parte din această programare.', camp)
            }
            corectate.set(randId, { pret: suma, camp })
          }
          for (const rand of randuri) {
            const corectat = corectate.get(rand.id)
            if (!corectat || corectat.pret === rand.pret) continue
            verificaPret(corectat.pret, corectat.camp)
            if (incasareaProgramarii(rand.id) !== null) {
              throw eroareValidare('Ședința este deja încasată; prețul ei nu se mai poate schimba.', corectat.camp)
            }
            const vechi = rand.pret
            rand.pret = corectat.pret
            atinge(rand)
            scrieJurnal({
              utilizator_id: autor.id,
              actiune: 'modificare',
              entitate: 'programare',
              entitate_id: rand.id,
              date_vechi: { pret: vechi },
              date_noi: { pret: corectat.pret },
            })
          }

          const deSchimbat = randuri.filter((r) => r.stare !== stare)
          if (deSchimbat.length > 0) {
            // O ședință încasată nu se anulează: banii ar rămâne agățați de un
            // serviciu care „nu a avut loc”. Întâi se scoate de pe bon.
            if (stare === 'anulat' && randuri.some((r) => incasareaProgramarii(r.id) !== null)) {
              throw eroareValidare(
                randuri.length === 1
                  ? 'Ședința este deja încasată; scoate-o mai întâi de pe bon, apoi anuleaz-o.'
                  : 'Programarea are un serviciu deja încasat; scoate-l mai întâi de pe bon, apoi anulează programarea.',
                'stare',
              )
            }
            for (const rand of deSchimbat) {
              const inainte = rand.stare
              rand.stare = stare
              atinge(rand)
              scrieJurnal({
                utilizator_id: autor.id,
                actiune: 'modificare',
                entitate: 'programare',
                entitate_id: rand.id,
                date_vechi: { stare: inainte },
                date_noi: { stare },
              })
            }
          }

          // Plata se înregistrează doar la onorare, pe toate serviciile încă
          // neplătite, pe UN bon. Cerută pe o ședință anulată, ar însemna
          // încasarea unui serviciu care nu a avut loc.
          const neachitate = randuri.filter((r) => incasareaProgramarii(r.id) === null)
          if (achitat === true && stare === 'onorat' && neachitate.length > 0) {
            inregistreazaIncasare(
              autor.id,
              ancora.client_id,
              neachitate,
              [],
              ancora.se_termina_la,
              null,
              metoda_plata,
            )
          }

          // Ultima ședință onorată încheie tratamentul de la sine — al fiecărui serviciu.
          for (const tratament_id of new Set(randuri.map((r) => r.tratament_id))) {
            incheieDacaEComplet(tratament_id, autor.id)
          }

          return hidrateazaProgramare(ancora)
        })
      },

      /** GET /programari/pret-sugerat — orice rol */
      async pretSugerat(client_id, articol_id): Promise<PretSugerat> {
        await intarziere()
        cereUtilizator()
        ceruta(magazin.client, client_id, 'Clientul')
        const articol = verificaArticolProgramabil(articol_id)
        return pretPentru(client_id, articol.id)
      },
    },

    // =======================================================================
    // Tratamente — servicii în mai multe ședințe
    // =======================================================================
    tratamente: {
      /** GET /tratamente — orice rol */
      async list(filtru: FiltruTratamente = {}): Promise<Paginat<TratamentDetaliu>> {
        await intarziere()
        cereUtilizator()

        const randuri: TratamentDetaliu[] = []
        for (const t of magazin.tratament.values()) {
          if (filtru.client_id && t.client_id !== filtru.client_id) continue
          if (filtru.articol_id && t.articol_id !== filtru.articol_id) continue
          if (filtru.in_curs === true && t.incheiat_la !== null) continue
          if (filtru.in_curs === false && t.incheiat_la === null) continue
          const detaliu = hidrateazaTratament(t)
          if (
            filtru.q
            && !contine(detaliu.client_nume, filtru.q)
            && !contine(detaliu.articol_denumire, filtru.q)
          ) continue
          randuri.push(detaliu)
        }

        // Cele în curs întâi; între ele, cele fără nicio ședință programată —
        // clienții de sunat — apoi după cât de curând vine următoarea.
        randuri.sort(
          (a, b) =>
            Number(a.incheiat_la !== null) - Number(b.incheiat_la !== null)
            || (a.urmatoarea_la ?? '').localeCompare(b.urmatoarea_la ?? '')
            || b.creat_la.localeCompare(a.creat_la)
            || a.id.localeCompare(b.id),
        )
        return pagineaza(randuri, filtru.pagina, filtru.pe_pagina)
      },

      /** GET /tratamente/:id — orice rol */
      async get(id): Promise<TratamentDetaliu> {
        await intarziere()
        cereUtilizator()
        return hidrateazaTratament(ceruta(magazin.tratament, id, 'Tratamentul'))
      },

      /** POST /tratamente — orice rol */
      async create(date: DateTratamentNou): Promise<TratamentDetaliu> {
        await intarziere()
        const autor = cereUtilizator()

        const client = ceruta(magazin.client, date.client_id, 'Clientul')
        if (client.arhivat_la !== null) {
          throw eroareValidare('Clientul este arhivat; dezarhivează-l înainte.', 'client_id')
        }
        const articol = ceruta(magazin.articol, date.articol_id, 'Serviciul')

        return hidrateazaTratament(deschideTratament(client.id, articol, date, autor.id))
      },

      /** PATCH /tratamente/:id — orice rol */
      async update(id, date: DateTratamentModificat): Promise<TratamentDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.tratament, id, 'Tratamentul')
        const inainte = { ...rand }
        const detaliu = hidrateazaTratament(rand)

        if (date.numar_sedinte !== undefined) {
          verificaNumarSedinte(date.numar_sedinte)
          const ocupate = detaliu.sedinte_programate + detaliu.sedinte_onorate
          if (date.numar_sedinte < ocupate) {
            throw eroareValidare(
              `Tratamentul are deja ${ocupate} ședințe programate sau făcute; numărul nu poate fi mai mic.`,
              'numar_sedinte',
            )
          }
          rand.numar_sedinte = date.numar_sedinte
        }
        if (date.pret_total !== undefined) {
          verificaPret(date.pret_total, 'pret_total')
          rand.pret_total = date.pret_total
        }
        if (date.nota !== undefined) rand.nota = textOptional(date.nota)
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'tratament',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return hidrateazaTratament(rand)
      },

      /** POST /tratamente/:id/incheiere — orice rol */
      async incheie(id): Promise<TratamentDetaliu> {
        await intarziere()
        return comutaIncheierea(id, true, cereUtilizator().id)
      },

      /** POST /tratamente/:id/redeschidere — orice rol */
      async redeschide(id): Promise<TratamentDetaliu> {
        await intarziere()
        return comutaIncheierea(id, false, cereUtilizator().id)
      },

      /** DELETE /tratamente/:id — administrator; ca pe server, cu ședințe și bani. */
      async remove(id): Promise<void> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.tratament, id, 'Tratamentul')
        const detaliu = hidrateazaTratament(rand)

        const sedinte = new Set(
          [...magazin.programare.values()].filter((p) => p.tratament_id === id).map((p) => p.id),
        )
        const bonuri = new Set<Uuid>()
        let incasat = 0
        for (const [linieId, linie] of magazin.vanzare_linie) {
          if (linie.programare_id && sedinte.has(linie.programare_id)) {
            bonuri.add(linie.vanzare_id)
            incasat += totalLinie(linie.cantitate, linie.pret_unitar)
            magazin.vanzare_linie.delete(linieId)
          }
        }
        let bonuriSterse = 0
        for (const bon of bonuri) {
          const maiAre = [...magazin.vanzare_linie.values()].some((l) => l.vanzare_id === bon)
          if (!maiAre) {
            magazin.vanzare.delete(bon)
            bonuriSterse++
          }
        }
        // ON DELETE SET NULL, ca pe server.
        for (const v of magazin.vanzare.values()) {
          if (v.programare_id && sedinte.has(v.programare_id)) v.programare_id = null
        }
        for (const c of magazin.consimtamant.values()) {
          if (c.programare_id && sedinte.has(c.programare_id)) c.programare_id = null
        }
        for (const sedinta of sedinte) magazin.programare.delete(sedinta)
        magazin.tratament.delete(id)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'stergere',
          entitate: 'tratament',
          entitate_id: id,
          date_vechi: {
            ...instantaneu(detaliu as unknown as Record<string, unknown>),
            sedinte_sterse: sedinte.size,
            incasat_sters: incasat,
            bonuri_sterse: bonuriSterse,
          },
        })
      },
    },

    // =======================================================================
    // Programul de lucru — zile pare / impare, pe persoană și lună
    // =======================================================================
    programLucru: {
      /** GET /program-lucru — orice rol */
      async list(filtru: FiltruProgramLucru): Promise<ProgramLucru[]> {
        await intarziere()
        cereUtilizator()
        const dataCerutaDe = dataCeruta(filtru.de_la, 'de_la', 'Începutul intervalului')
        const pana = dataCeruta(filtru.pana_la, 'pana_la', 'Sfârșitul intervalului')
        const dela = `${dataCerutaDe.slice(0, 7)}-01`
        return [...magazin.program_lucru.values()]
          .filter((p) => p.luna >= dela && p.luna <= pana)
          .map((p) => ({ ...p, utilizator_nume: magazin.utilizator.get(p.utilizator_id)?.nume ?? '—' }))
          .sort((a, b) => a.luna.localeCompare(b.luna) || a.utilizator_nume.localeCompare(b.utilizator_nume))
      },

      /** PUT /program-lucru — orice rol */
      async seteaza(date: DateProgramLucru): Promise<ProgramLucru | null> {
        await intarziere()
        const autor = cereUtilizator()
        if (!date.utilizator_id) throw eroareValidare('Alege persoana.', 'utilizator_id')
        ceruta(magazin.utilizator, date.utilizator_id, 'Persoana')
        const text = /^\d{4}-\d{2}$/.test(date.luna) ? `${date.luna}-01` : date.luna
        const luna = `${dataCeruta(text, 'luna', 'Luna').slice(0, 7)}-01`
        if (date.zile !== null && date.zile !== 'pare' && date.zile !== 'impare') {
          throw eroareValidare('Alege zilele: pare sau impare.', 'zile')
        }

        const inainte = [...magazin.program_lucru.values()].find(
          (p) => p.utilizator_id === date.utilizator_id && p.luna === luna,
        )
        if (date.zile === null) {
          if (!inainte) return null
          magazin.program_lucru.delete(inainte.id)
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'stergere',
            entitate: 'program_lucru',
            entitate_id: inainte.id,
            date_vechi: { utilizator_id: date.utilizator_id, luna, zile: inainte.zile },
          })
          return null
        }

        const rand = inainte ?? {
          id: uuid(),
          utilizator_id: date.utilizator_id,
          luna,
          zile: date.zile,
          creat_de: autor.id,
          creat_la: acum(),
          actualizat_la: acum(),
        }
        if (inainte?.zile !== date.zile) {
          const vechi = inainte?.zile
          rand.zile = date.zile
          atinge(rand)
          magazin.program_lucru.set(rand.id, rand)
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: inainte ? 'modificare' : 'creare',
            entitate: 'program_lucru',
            entitate_id: rand.id,
            date_vechi: vechi ? { zile: vechi } : null,
            date_noi: { utilizator_id: date.utilizator_id, luna, zile: date.zile },
          })
        }
        return { ...rand, utilizator_nume: magazin.utilizator.get(rand.utilizator_id)?.nume ?? '—' }
      },
    },

    // =======================================================================
    // Notițe în calendar
    // =======================================================================
    notite: {
      /** GET /notite — orice rol */
      async list(filtru: FiltruNotite = {}): Promise<NotitaDetaliu[]> {
        await intarziere()
        cereUtilizator()

        const randuri: NotitaDetaliu[] = []
        for (const n of magazin.notita.values()) {
          // Suprapunere cu intervalul, ca la programări.
          if (filtru.de_la && n.se_termina_la <= filtru.de_la) continue
          if (filtru.pana_la && n.incepe_la >= filtru.pana_la) continue
          // Filtrul pe persoană aduce și notițele întregii clinici — o privesc.
          if (filtru.executant_id && n.executant_id !== null && n.executant_id !== filtru.executant_id) {
            continue
          }
          randuri.push(hidrateazaNotita(n))
        }

        randuri.sort((a, b) => a.incepe_la.localeCompare(b.incepe_la))
        return randuri
      },

      /** GET /notite/:id — orice rol */
      async get(id): Promise<NotitaDetaliu> {
        await intarziere()
        cereUtilizator()
        return hidrateazaNotita(ceruta(magazin.notita, id, 'Notița'))
      },

      /** POST /notite — orice rol */
      async create(date: DateNotitaNoua): Promise<NotitaDetaliu> {
        await intarziere()
        const autor = cereUtilizator()

        const titlu = ceruteText(date.titlu, 'titlu', 'Titlul')
        const executant_id = executantOptional(date.executant_id)
        verificaIntervalProgramare(date.incepe_la, date.se_termina_la)
        // FĂRĂ verificaSuprapunere: notița e informativă, nu blochează locul.

        const rand: Notita = {
          id: uuid(),
          titlu,
          detalii: textOptional(date.detalii),
          executant_id,
          incepe_la: date.incepe_la,
          se_termina_la: date.se_termina_la,
          creat_de: autor.id,
          creat_la: acum(),
          actualizat_la: acum(),
        }
        magazin.notita.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'notita',
          entitate_id: rand.id,
          date_noi: instantaneu(rand as unknown as Record<string, unknown>),
        })

        return hidrateazaNotita(rand)
      },

      /** PATCH /notite/:id — orice rol */
      async update(id, date: DateNotitaModificata): Promise<NotitaDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.notita, id, 'Notița')
        const inainte = { ...rand }

        if (date.titlu !== undefined) rand.titlu = ceruteText(date.titlu, 'titlu', 'Titlul')
        if (date.detalii !== undefined) rand.detalii = textOptional(date.detalii)
        // `null` explicit mută notița pe toată clinica; lipsa o lasă cum e.
        if (date.executant_id !== undefined) rand.executant_id = executantOptional(date.executant_id)
        if (date.incepe_la !== undefined) rand.incepe_la = date.incepe_la
        if (date.se_termina_la !== undefined) rand.se_termina_la = date.se_termina_la

        verificaIntervalProgramare(rand.incepe_la, rand.se_termina_la)
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'notita',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return hidrateazaNotita(rand)
      },

      /** DELETE /notite/:id — orice rol */
      async remove(id): Promise<void> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.notita, id, 'Notița')

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'stergere',
          entitate: 'notita',
          entitate_id: id,
          date_vechi: instantaneu(rand as unknown as Record<string, unknown>),
        })

        magazin.notita.delete(id)
      },
    },

    // =======================================================================
    // Vânzări
    // =======================================================================
    vanzari: {
      /** GET /vanzari — orice rol, cu statisticile deblocate */
      async list(filtru: FiltruVanzari = {}): Promise<Paginat<VanzareDetaliu>> {
        await intarziere()
        // Ca pe server: lista datoriilor nu cere parola statisticilor.
        if (filtru.achitat !== false) cereAccesStatistici()

        const randuri: VanzareDetaliu[] = []
        for (const v of magazin.vanzare.values()) {
          if (!inInterval(v.efectuat_la, filtru.de_la, filtru.pana_la)) continue
          if (filtru.client_id && v.client_id !== filtru.client_id) continue
          if (filtru.punct_lucru_id && v.punct_lucru_id !== filtru.punct_lucru_id) continue
          if (filtru.operator_id && v.operator_id !== filtru.operator_id) continue
          if (filtru.achitat !== undefined && (v.achitat_la !== null) !== filtru.achitat) continue

          const detaliu = hidrateazaVanzare(v)
          // Filtrarea pe articol se face după hidratare: liniile sunt într-o
          // tabelă separată, iar antetul singur nu știe ce s-a vândut.
          if (filtru.articol_id && !detaliu.linii.some((l) => l.articol_id === filtru.articol_id)) {
            continue
          }
          randuri.push(detaliu)
        }

        randuri.sort((a, b) => b.efectuat_la.localeCompare(a.efectuat_la))
        return pagineaza(randuri, filtru.pagina, filtru.pe_pagina)
      },

      /** GET /vanzari/:id — orice rol */
      async get(id): Promise<VanzareDetaliu> {
        await intarziere()
        cereUtilizator()
        return hidrateazaVanzare(ceruta(magazin.vanzare, id, 'Vânzarea'))
      },

      /** POST /vanzari — orice rol. Antet + linii, într-o singură tranzacție. */
      async create(date: DateVanzareNoua): Promise<VanzareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()

        ceruta(magazin.client, date.client_id, 'Clientul')
        const punct_lucru_id = date.punct_lucru_id ?? punctImplicit()
        ceruta(magazin.punct_lucru, punct_lucru_id, 'Punctul de lucru')
        const operator_id = date.operator_id ?? autor.id
        ceruta(magazin.utilizator, operator_id, 'Operatorul')
        if (date.programare_id) ceruta(magazin.programare, date.programare_id, 'Programarea')

        if (!date.linii || date.linii.length === 0) {
          throw eroareValidare('Adaugă cel puțin un serviciu sau produs.', 'linii')
        }
        // Liniile se validează ÎNAINTE de a scrie antetul: pe server totul este
        // o tranzacție, deci nu poate rămâne o vânzare fără linii.
        const pregatite = date.linii.map(pregatesteLinie)
        // Lipsă = achitată pe loc, ca înainte să existe alegerea.
        const achitat = achitatDin(date.achitat) ?? true
        refuzaSedintePeDatorie(achitat, pregatite)
        // Neachitată = încă neplătită: nu are cum să aibă o metodă.
        const metoda_plata = achitat ? metodaPlataDin(date.metoda_plata) : null

        const rand: Vanzare = {
          id: uuid(),
          client_id: date.client_id,
          punct_lucru_id,
          operator_id,
          programare_id: date.programare_id ?? null,
          efectuat_la: date.efectuat_la,
          nota: textOptional(date.nota),
          creat_la: acum(),
          actualizat_la: acum(),
          achitat_la: achitat ? date.efectuat_la : null,
          metoda_plata,
        }
        magazin.vanzare.set(rand.id, rand)
        for (const linie of pregatite) {
          const cuId: VanzareLinie = { ...linie, id: uuid(), vanzare_id: rand.id }
          magazin.vanzare_linie.set(cuId.id, cuId)
          if (cuId.programare_id) potrivestePretulSedintei(cuId.programare_id, autor.id)
        }

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'vanzare',
          entitate_id: rand.id,
          date_noi: {
            ...instantaneu(rand as unknown as Record<string, unknown>),
            numar_linii: pregatite.length,
          },
        })

        return hidrateazaVanzare(rand)
      },

      /** PATCH /vanzari/:id — orice rol */
      async update(id, date: DateVanzareModificata): Promise<VanzareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.vanzare, id, 'Vânzarea')
        const inainte = { ...rand }

        const achitat = achitatDin(date.achitat)
        refuzaSedintePeDatorie(
          achitat ?? rand.achitat_la !== null,
          date.linii ?? [...magazin.vanzare_linie.values()].filter((l) => l.vanzare_id === id),
        )

        if (date.client_id !== undefined) {
          ceruta(magazin.client, date.client_id, 'Clientul')
          rand.client_id = date.client_id
        }
        if (date.punct_lucru_id !== undefined) {
          ceruta(magazin.punct_lucru, date.punct_lucru_id, 'Punctul de lucru')
          rand.punct_lucru_id = date.punct_lucru_id
        }
        if (date.operator_id !== undefined) {
          ceruta(magazin.utilizator, date.operator_id, 'Operatorul')
          rand.operator_id = date.operator_id
        }
        if (date.programare_id !== undefined) {
          if (date.programare_id) ceruta(magazin.programare, date.programare_id, 'Programarea')
          rand.programare_id = date.programare_id
        }
        if (date.efectuat_la !== undefined) rand.efectuat_la = date.efectuat_la
        if (date.nota !== undefined) rand.nota = textOptional(date.nota)

        // Bifa „Achitat”, cu aceleași trei cazuri ca pe server: plătită ACUM,
        // datoria revenită, sau plata pe loc care urmează data mutată.
        if (achitat === false && inainte.achitat_la !== null) {
          rand.achitat_la = null
        } else if (achitat === true && inainte.achitat_la === null) {
          rand.achitat_la = acum()
        } else if (
          date.efectuat_la !== undefined &&
          inainte.achitat_la !== null &&
          Date.parse(inainte.achitat_la) === Date.parse(inainte.efectuat_la)
        ) {
          rand.achitat_la = date.efectuat_la
        }

        // Numerar sau card, ca pe server: o vânzare neachitată nu are metodă.
        if (rand.achitat_la === null) rand.metoda_plata = null
        else if (date.metoda_plata !== undefined) rand.metoda_plata = metodaPlataDin(date.metoda_plata)

        if (date.linii !== undefined) {
          if (date.linii.length === 0) {
            throw eroareValidare('Vânzarea trebuie să aibă cel puțin o linie.', 'linii')
          }
          const pregatite = date.linii.map(pregatesteLinie)
          // Validate întâi, șterse abia apoi — o linie invalidă nu trebuie să
          // lase vânzarea fără cele vechi.
          for (const [linieId, linie] of magazin.vanzare_linie) {
            if (linie.vanzare_id === id) magazin.vanzare_linie.delete(linieId)
          }
          for (const linie of pregatite) {
            const cuId: VanzareLinie = { ...linie, id: uuid(), vanzare_id: id }
            magazin.vanzare_linie.set(cuId.id, cuId)
            if (cuId.programare_id) potrivestePretulSedintei(cuId.programare_id, autor.id)
          }
        }

        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif || date.linii !== undefined) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'vanzare',
            entitate_id: rand.id,
            date_vechi: dif?.date_vechi ?? null,
            date_noi: {
              ...(dif?.date_noi ?? {}),
              ...(date.linii !== undefined ? { linii_inlocuite: date.linii.length } : {}),
            },
          })
        }

        return hidrateazaVanzare(rand)
      },

      /** POST /vanzari/incasare — orice rol */
      async incaseaza(date: DateIncasare): Promise<VanzareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        ceruta(magazin.client, date.client_id, 'Clientul')

        const programari = (date.programare_ids ?? []).map((id) => {
          const p = ceruta(magazin.programare, id, 'Programarea')
          // Cele trei verificări de mai jos sunt motivul pentru care încasarea
          // este metodă proprie și nu un `create` cu linii construite în
          // interfață: fără ele s-ar putea încasa ședința altui client, una
          // care nu a avut loc, sau una plătită deja.
          if (p.client_id !== date.client_id) {
            throw eroareValidare(
              'Una dintre ședințe aparține altui client.',
              'programare_ids',
            )
          }
          if (p.stare !== 'onorat') {
            throw eroareValidare(
              'Se pot încasa doar ședințele marcate ca onorate.',
              'programare_ids',
            )
          }
          if (incasareaProgramarii(p.id) !== null) {
            throw eroareConflict('Una dintre ședințe este deja încasată.', {
              camp: 'programare_ids',
              programare_id: p.id,
            })
          }
          return p
        })

        const produse = date.linii ?? []
        if (programari.length === 0 && produse.length === 0) {
          throw eroareValidare('Alege cel puțin o ședință sau un produs.', 'programare_ids')
        }

        return inregistreazaIncasare(
          autor.id,
          date.client_id,
          programari,
          produse,
          date.efectuat_la ?? acum(),
          date.nota ?? null,
          metodaPlataDin(date.metoda_plata),
        )
      },

      /** DELETE /vanzari/:id — cu statisticile deblocate */
      async remove(id): Promise<void> {
        await intarziere()
        const autor = cereAccesStatistici()
        const rand = ceruta(magazin.vanzare, id, 'Vânzarea')
        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'stergere',
          entitate: 'vanzare',
          entitate_id: id,
          date_vechi: instantaneu(hidrateazaVanzare(rand) as unknown as Record<string, unknown>),
        })
        // Ca ON DELETE CASCADE pe server: liniile pleacă odată cu bonul.
        for (const [linieId, linie] of magazin.vanzare_linie) {
          if (linie.vanzare_id === id) magazin.vanzare_linie.delete(linieId)
        }
        magazin.vanzare.delete(id)
      },
    },

    // =======================================================================
    // Statistici — în spatele parolei lor
    // =======================================================================
    statistici: {
      /** GET /statistici/acces — orice rol */
      async stare(): Promise<StareParolaStatistici> {
        await intarziere()
        cereUtilizator()
        return { parola_setata: magazin.parola_statistici !== null }
      },

      /** POST /statistici/acces — orice rol */
      async deblocheaza(parola): Promise<AccesStatistici> {
        await intarziere()
        const utilizator = cereUtilizator()
        if (!parola) throw eroareValidare('Scrie parola statisticilor.', 'parola')

        const rand = magazin.parola_statistici
        if (!rand) {
          throw eroareValidare(
            'Parola statisticilor nu a fost aleasă încă. Un administrator o alege la prima deschidere.',
            'parola',
          )
        }
        if (rand.parola_hash !== parola) {
          throw eroareValidare('Parola statisticilor nu este corectă.', 'parola')
        }

        scrieJurnal({ utilizator_id: utilizator.id, actiune: 'autentificare', entitate: 'statistici' })
        return deschideStatisticile(utilizator)
      },

      /** PUT /statistici/parola — administrator */
      async seteazaParola({ parola_noua, parola_curenta }): Promise<AccesStatistici> {
        await intarziere()
        const autor = cereAdministrator()

        if ((parola_noua ?? '').length < 8) {
          throw eroareValidare('Parola statisticilor trebuie să aibă cel puțin 8 caractere.', 'parola_noua')
        }
        if (parola_noua === autor.parola_hash) {
          throw eroareValidare(
            'Alege o parolă diferită de cea a contului tău — altfel oricine intră cu contul vede și statisticile.',
            'parola_noua',
          )
        }

        const existenta = magazin.parola_statistici
        if (existenta) {
          if (!parola_curenta) {
            throw eroareValidare('Scrie parola curentă a statisticilor.', 'parola_curenta')
          }
          if (existenta.parola_hash !== parola_curenta) {
            throw eroareValidare('Parola curentă a statisticilor nu este corectă.', 'parola_curenta')
          }
        }

        // Un rând nou, nu unul modificat pe loc — vezi `RandParolaStatistici`.
        magazin.parola_statistici = { parola_hash: parola_noua, actualizat_de: autor.id, actualizat_la: acum() }
        scrieJurnal({
          utilizator_id: autor.id,
          actiune: existenta ? 'modificare' : 'creare',
          entitate: 'parola_statistici',
        })
        return deschideStatisticile(autor)
      },

      blocheaza(): void {
        accesStatistici = null
      },

      /** GET /statistici — cu statisticile deblocate */
      async raport(filtru): Promise<RaportStatistici> {
        await intarziere()
        cereAccesStatistici()
        return calculeazaRaport(filtru)
      },
    },

    // =======================================================================
    // Cheltuieli — tot în spatele parolei statisticilor
    // =======================================================================
    cheltuieli: {
      /** GET /cheltuieli */
      async list(filtru: FiltruCheltuieli = {}): Promise<ListaCheltuieli> {
        await intarziere()
        cereAccesStatistici()

        const de_la = filtru.de_la ? dataCeruta(filtru.de_la, 'de_la', 'Începutul perioadei') : null
        const pana_la = filtru.pana_la ? dataCeruta(filtru.pana_la, 'pana_la', 'Sfârșitul perioadei') : null
        const q = (filtru.q ?? '').trim()

        const randuri = [...magazin.cheltuiala.values()]
          .filter((c) => (de_la === null || c.data >= de_la) && (pana_la === null || c.data <= pana_la))
          .filter((c) => !filtru.categorie || c.categorie === filtru.categorie)
          .filter((c) => q === '' || contine(c.categorie, q) || contine(c.descriere, q))
          .sort(
            (a, b) =>
              b.data.localeCompare(a.data) ||
              b.creat_la.localeCompare(a.creat_la) ||
              a.id.localeCompare(b.id),
          )

        return {
          ...pagineaza(randuri.map(hidrateazaCheltuiala), filtru.pagina, filtru.pe_pagina),
          suma: sumaTotal(randuri.map((c) => c.suma)),
        }
      },

      /** GET /cheltuieli/categorii — cele mai folosite întâi */
      async categorii(): Promise<string[]> {
        await intarziere()
        cereAccesStatistici()
        const numar = new Map<string, number>()
        for (const c of magazin.cheltuiala.values()) numar.set(c.categorie, (numar.get(c.categorie) ?? 0) + 1)
        return [...numar.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ro'))
          .map(([categorie]) => categorie)
      },

      /** POST /cheltuieli */
      async create(date: DateCheltuialaNoua): Promise<CheltuialaDetaliu> {
        await intarziere()
        const autor = cereAccesStatistici()

        const acumIso = acum()
        const rand: Cheltuiala = {
          id: uuid(),
          data: dataCeruta(date.data, 'data', 'Data'),
          categorie: categoriaCheltuielii(date.categorie),
          descriere: textOptional(date.descriere),
          suma: verificaSumaPozitiva(date.suma, 'suma', 'Suma'),
          creat_de: autor.id,
          creat_la: acumIso,
          actualizat_la: acumIso,
        }
        magazin.cheltuiala.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'cheltuiala',
          entitate_id: rand.id,
          date_noi: instantaneu(rand as unknown as Record<string, unknown>),
        })
        return hidrateazaCheltuiala(rand)
      },

      /** PATCH /cheltuieli/:id */
      async update(id, date: DateCheltuialaModificata): Promise<CheltuialaDetaliu> {
        await intarziere()
        const autor = cereAccesStatistici()
        const rand = ceruta(magazin.cheltuiala, id, 'Cheltuiala')
        if (Object.values(date).every((v) => v === undefined)) {
          throw eroareValidare('Nu ai trimis niciun câmp de modificat.')
        }

        // Totul se verifică înainte de a scrie ceva, ca pe server: o sumă
        // greșită nu are voie să lase data deja schimbată.
        const dupa: Cheltuiala = {
          ...rand,
          ...(date.data !== undefined ? { data: dataCeruta(date.data, 'data', 'Data') } : {}),
          ...(date.categorie !== undefined ? { categorie: categoriaCheltuielii(date.categorie) } : {}),
          ...(date.descriere !== undefined ? { descriere: textOptional(date.descriere) } : {}),
          ...(date.suma !== undefined ? { suma: verificaSumaPozitiva(date.suma, 'suma', 'Suma') } : {}),
        }
        const dif = diferenta(
          rand as unknown as Record<string, unknown>,
          dupa as unknown as Record<string, unknown>,
        )
        if (dif) {
          atinge(dupa)
          magazin.cheltuiala.set(id, dupa)
          scrieJurnal({ utilizator_id: autor.id, actiune: 'modificare', entitate: 'cheltuiala', entitate_id: id, ...dif })
        }
        return hidrateazaCheltuiala(magazin.cheltuiala.get(id) ?? dupa)
      },

      /** DELETE /cheltuieli/:id — urma rămâne în jurnal */
      async remove(id): Promise<void> {
        await intarziere()
        const autor = cereAccesStatistici()
        const rand = ceruta(magazin.cheltuiala, id, 'Cheltuiala')
        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'stergere',
          entitate: 'cheltuiala',
          entitate_id: id,
          date_vechi: instantaneu(rand as unknown as Record<string, unknown>),
        })
        magazin.cheltuiala.delete(id)
      },
    },

    // =======================================================================
    // Articole
    // =======================================================================
    articole: {
      /** GET /articole — orice rol */
      async list(filtru: FiltruArticole = {}): Promise<Articol[]> {
        await intarziere()
        cereUtilizator()

        const randuri: Articol[] = []
        for (const a of magazin.articol.values()) {
          if (filtru.tip && a.tip !== filtru.tip) continue
          if (filtru.activ !== undefined && a.activ !== filtru.activ) continue
          if (filtru.q && !contine(a.denumire, filtru.q)) continue
          randuri.push({ ...a })
        }

        randuri.sort(
          (a, b) =>
            a.tip.localeCompare(b.tip) ||
            normalizeaza(a.denumire).localeCompare(normalizeaza(b.denumire), 'ro'),
        )
        return randuri
      },

      /** POST /articole — doar administrator */
      async create(date: DateArticolNou): Promise<Articol> {
        await intarziere()
        const autor = cereAdministrator()

        // Durata se validează așa cum a fost TRIMISĂ, nu după normalizare: baza
        // respinge un INSERT cu tip='produs' și durata_minute completată, deci
        // și API-ul trebuie să o respingă. Dacă am normaliza-o tăcut la NULL,
        // formularul ar părea că funcționează aici și ar eșua pe server.
        verificaDurataArticol(date.tip, date.durata_minute ?? null)
        verificaPret(date.pret_lista)
        const durata = date.tip === 'serviciu' ? (date.durata_minute ?? null) : null
        const numar_sedinte =
          date.numar_sedinte === undefined ? 1 : verificaNumarSedinte(date.numar_sedinte, date.tip)

        const rand: Articol = {
          id: uuid(),
          tip: date.tip,
          denumire: ceruteText(date.denumire, 'denumire', 'Denumirea'),
          durata_minute: durata,
          pret_lista: date.pret_lista,
          activ: date.activ ?? true,
          creat_la: acum(),
          actualizat_la: acum(),
          numar_sedinte,
        }
        magazin.articol.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'articol',
          entitate_id: rand.id,
          date_noi: instantaneu(rand as unknown as Record<string, unknown>),
        })

        return { ...rand }
      },

      /** PATCH /articole/:id — doar administrator */
      async update(id, date: DateArticolModificat): Promise<Articol> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.articol, id, 'Articolul')
        const inainte = { ...rand }

        const tip = date.tip ?? rand.tip
        // Schimbarea tipului trage după ea și durata: un serviciu devenit produs
        // rămâne altfel cu o durată care încalcă articol_durata_ck. Excepția
        // este durata trimisă explicit pe un produs — aceea este o eroare a
        // apelantului, nu o valoare de curățat, și se semnalează ca atare.
        if (tip === 'produs' && date.durata_minute != null) {
          verificaDurataArticol('produs', date.durata_minute)
        }
        const durata =
          tip === 'serviciu'
            ? (date.durata_minute !== undefined ? date.durata_minute : rand.durata_minute)
            : null
        verificaDurataArticol(tip, durata ?? null)
        if (date.pret_lista !== undefined) verificaPret(date.pret_lista)
        // Ca durata: un serviciu devenit produs coboară la o singură ședință,
        // iar o valoare trimisă explicit pe un produs se refuză.
        const numar_sedinte =
          date.numar_sedinte !== undefined
            ? verificaNumarSedinte(date.numar_sedinte, tip)
            : tip === 'produs' ? 1 : rand.numar_sedinte

        rand.tip = tip
        rand.durata_minute = durata ?? null
        rand.numar_sedinte = numar_sedinte
        if (date.denumire !== undefined) {
          rand.denumire = ceruteText(date.denumire, 'denumire', 'Denumirea')
        }
        if (date.pret_lista !== undefined) rand.pret_lista = date.pret_lista
        if (date.activ !== undefined) rand.activ = date.activ
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'articol',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return { ...rand }
      },
    },

    // =======================================================================
    // Puncte de lucru
    // =======================================================================
    puncteLucru: {
      /** GET /puncte-lucru — orice rol */
      async list(filtru = {}): Promise<PunctLucru[]> {
        await intarziere()
        cereUtilizator()

        const randuri: PunctLucru[] = []
        for (const p of magazin.punct_lucru.values()) {
          if (filtru.activ !== undefined && p.activ !== filtru.activ) continue
          randuri.push({ ...p })
        }
        randuri.sort((a, b) => normalizeaza(a.denumire).localeCompare(normalizeaza(b.denumire), 'ro'))
        return randuri
      },

      /** POST /puncte-lucru — doar administrator */
      async create(date: DatePunctLucruNou): Promise<PunctLucru> {
        await intarziere()
        const autor = cereAdministrator()

        const denumire = ceruteText(date.denumire, 'denumire', 'Denumirea')
        verificaDenumirePunctUnica(denumire)

        const rand: PunctLucru = {
          id: uuid(),
          denumire,
          adresa: textOptional(date.adresa),
          telefon: textOptional(date.telefon),
          activ: date.activ ?? true,
          creat_la: acum(),
          actualizat_la: acum(),
        }
        magazin.punct_lucru.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'punct_lucru',
          entitate_id: rand.id,
          date_noi: instantaneu(rand as unknown as Record<string, unknown>),
        })

        return { ...rand }
      },

      /** PATCH /puncte-lucru/:id — doar administrator */
      async update(id, date: DatePunctLucruModificat): Promise<PunctLucru> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.punct_lucru, id, 'Punctul de lucru')
        const inainte = { ...rand }

        if (date.denumire !== undefined) {
          const denumire = ceruteText(date.denumire, 'denumire', 'Denumirea')
          verificaDenumirePunctUnica(denumire, id)
          rand.denumire = denumire
        }
        if (date.adresa !== undefined) rand.adresa = textOptional(date.adresa)
        if (date.telefon !== undefined) rand.telefon = textOptional(date.telefon)
        if (date.activ !== undefined) rand.activ = date.activ
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'punct_lucru',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return { ...rand }
      },
    },

    // =======================================================================
    // Utilizatori — toate rutele cer administrator
    // =======================================================================
    utilizatori: {
      /** GET /utilizatori — administrator */
      async list(filtru = {}): Promise<Utilizator[]> {
        await intarziere()
        cereAdministrator()

        const randuri: Utilizator[] = []
        for (const u of magazin.utilizator.values()) {
          if (filtru.activ !== undefined && u.activ !== filtru.activ) continue
          if (filtru.q && !contine(u.nume, filtru.q) && !contine(u.email, filtru.q)) continue
          randuri.push(utilizatorPublic(u))
        }
        randuri.sort((a, b) => normalizeaza(a.nume).localeCompare(normalizeaza(b.nume), 'ro'))
        return randuri
      },

      /** POST /utilizatori — administrator */
      async create(date: DateUtilizatorNou): Promise<Utilizator> {
        await intarziere()
        const autor = cereAdministrator()

        const email = ceruteText(date.email, 'email', 'Adresa de e-mail')
        verificaFormatEmail(email)
        verificaEmailUnic(email)
        verificaParola(date.parola)

        const rand: RandUtilizator = {
          id: uuid(),
          nume: ceruteText(date.nume, 'nume', 'Numele'),
          email,
          parola_hash: date.parola,
          rol: date.rol,
          activ: date.activ ?? true,
          ultima_autentificare: null,
          creat_la: acum(),
          actualizat_la: acum(),
          culoare: null,
        }
        magazin.utilizator.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'utilizator',
          entitate_id: rand.id,
          // Parola nu ajunge niciodată în jurnal.
          date_noi: { nume: rand.nume, email: rand.email, rol: rand.rol, activ: rand.activ },
        })

        return utilizatorPublic(rand)
      },

      /** PATCH /utilizatori/:id — administrator */
      async update(id, date: DateUtilizatorModificat): Promise<Utilizator> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.utilizator, id, 'Utilizatorul')
        const inainte = utilizatorPublic(rand)

        if (date.email !== undefined) {
          const email = ceruteText(date.email, 'email', 'Adresa de e-mail')
          verificaFormatEmail(email)
          verificaEmailUnic(email, id)
          rand.email = email
        }
        if (date.nume !== undefined) rand.nume = ceruteText(date.nume, 'nume', 'Numele')
        // Culoarea din calendar, ca pe server: #rrggbb cu litere mici, sau null.
        if (date.culoare !== undefined) {
          if (date.culoare === null || date.culoare === '') rand.culoare = null
          else if (/^#[0-9a-f]{6}$/i.test(date.culoare)) rand.culoare = date.culoare.toLowerCase()
          else throw eroareValidare('Culoarea trebuie să fie de forma #a1b2c3.', 'culoare')
        }

        // Un administrator care își retrage singur rolul sau își dezactivează
        // contul ar rămâne blocat afară, iar clinica ar putea rămâne fără
        // niciun administrator. Ambele se refuză explicit.
        if (date.rol !== undefined && date.rol !== rand.rol) {
          if (rand.id === autor.id) {
            throw eroareValidare('Nu îți poți schimba propriul rol.', 'rol')
          }
          if (rand.rol === 'administrator') verificaRamaneUnAdministrator(rand.id)
          rand.rol = date.rol
        }
        if (date.activ !== undefined && date.activ !== rand.activ) {
          if (rand.id === autor.id && !date.activ) {
            throw eroareValidare('Nu îți poți dezactiva propriul cont.', 'activ')
          }
          if (!date.activ && rand.rol === 'administrator') verificaRamaneUnAdministrator(rand.id)
          rand.activ = date.activ
          // Contul dezactivat nu mai poate folosi sesiunile deschise.
          if (!date.activ) revocaSesiunile(rand.id)
        }
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          utilizatorPublic(rand) as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'utilizator',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return utilizatorPublic(rand)
      },

      /** POST /utilizatori/:id/reset-parola — administrator */
      async reseteazaParola(id, parola_noua): Promise<void> {
        await intarziere()
        const autor = cereAdministrator()
        const rand = ceruta(magazin.utilizator, id, 'Utilizatorul')

        verificaParola(parola_noua)
        rand.parola_hash = parola_noua
        atinge(rand)
        // §7: resetarea revocă TOATE sesiunile contului.
        revocaSesiunile(id)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'modificare',
          entitate: 'utilizator',
          entitate_id: id,
          date_noi: { parola_resetata: true, sesiuni_revocate: true },
        })
      },
    },

    // =======================================================================
    // Jurnal — administrator
    // =======================================================================
    jurnal: {
      /** GET /jurnal — administrator */
      async list(filtru: FiltruJurnal = {}): Promise<Paginat<JurnalOperatiuneDetaliu>> {
        await intarziere()
        cereAdministrator()

        const actiuni = filtru.actiune && filtru.actiune.length > 0 ? new Set(filtru.actiune) : null
        // Ca pe server: sumele cheltuielilor nu se văd în jurnal fără parola statisticilor.
        const vedeBanii = areAccesStatistici()

        const randuri: JurnalOperatiuneDetaliu[] = []
        for (const j of magazin.jurnal_operatiuni) {
          if (!inInterval(j.creat_la, filtru.de_la, filtru.pana_la)) continue
          if (filtru.entitate && j.entitate !== filtru.entitate) continue
          if (filtru.entitate_id && j.entitate_id !== filtru.entitate_id) continue
          if (filtru.utilizator_id && j.utilizator_id !== filtru.utilizator_id) continue
          if (actiuni && !actiuni.has(j.actiune)) continue
          const rand = hidrateazaJurnal(j)
          randuri.push(
            vedeBanii || !ENTITATI_CU_BANI.has(rand.entitate)
              ? rand
              : { ...rand, date_vechi: null, date_noi: null },
          )
        }

        randuri.sort((a, b) => b.creat_la.localeCompare(a.creat_la) || b.id - a.id)
        return pagineaza(randuri, filtru.pagina, filtru.pe_pagina ?? 50)
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Ajutătoare private
// ---------------------------------------------------------------------------

/**
 * Prețul ședinței urmează suma încasată pe ea — ca `potrivestePretulSedintei`
 * de pe server: 300 corectat în Statistici la 250 devine 250 și pe programare.
 */
function potrivestePretulSedintei(programare_id: Uuid, autor_id: Uuid): void {
  const sedinta = magazin.programare.get(programare_id)
  if (!sedinta) return
  const suma = sumaTotal(
    [...magazin.vanzare_linie.values()]
      .filter((l) => l.programare_id === programare_id)
      .map((l) => l.total_linie),
  )
  if (suma === sedinta.pret) return
  const vechi = sedinta.pret
  sedinta.pret = suma
  atinge(sedinta)
  scrieJurnal({
    utilizator_id: autor_id,
    actiune: 'modificare',
    entitate: 'programare',
    entitate_id: programare_id,
    date_vechi: { pret: vechi },
    date_noi: { pret: suma },
  })
}

/**
 * Validează o linie și îi calculează totalul, fără să o scrie.
 * Prețul lipsă se completează din `articol.pret_lista`, apoi se COPIAZĂ —
 * o schimbare ulterioară de preț nu trebuie să rescrie vânzările vechi.
 */
function pregatesteLinie(linie: DateLinieVanzare): Omit<VanzareLinie, 'id' | 'vanzare_id'> {
  const articol = ceruta(magazin.articol, linie.articol_id, 'Articolul')
  verificaCantitate(linie.cantitate)

  const pret_unitar = linie.pret_unitar ?? articol.pret_lista
  verificaPret(pret_unitar, 'pret_unitar')

  return {
    articol_id: articol.id,
    cantitate: linie.cantitate,
    pret_unitar,
    total_linie: totalLinie(linie.cantitate, pret_unitar),
    programare_id: linie.programare_id ?? null,
  }
}

/** `achitat` din cerere: lipsă = neschimbat, altfel neapărat boolean — ca pe server. */
function achitatDin(valoare: unknown): boolean | undefined {
  if (valoare === undefined) return undefined
  if (typeof valoare !== 'boolean') {
    throw eroareValidare('„Achitat” trebuie să fie da sau nu.', 'achitat')
  }
  return valoare
}

/**
 * `metoda_plata` din cerere — ca pe server: lipsă = nespecificată (NULL),
 * altfel numerar sau card.
 */
function metodaPlataDin(valoare: unknown): MetodaPlata | null {
  if (valoare === undefined || valoare === null || valoare === '') return null
  if (!(METODE_PLATA as readonly unknown[]).includes(valoare)) {
    throw eroareValidare('Alege cum s-a plătit: numerar sau card.', 'metoda_plata')
  }
  return valoare as MetodaPlata
}

/**
 * O vânzare care stinge ședințe nu poate rămâne neachitată: ședința se
 * socotește plătită după linia care o indică, iar pe un bon neplătit linia ar
 * spune două lucruri deodată. Se cheamă cu starea DE DUPĂ, înaintea oricărei
 * scrieri — aici nu există tranzacție care s-o anuleze.
 */
function refuzaSedintePeDatorie(
  achitata: boolean,
  linii: readonly { programare_id?: Uuid | null }[],
): void {
  if (achitata || !linii.some((l) => l.programare_id)) return
  throw eroareValidare(
    'O încasare de ședințe nu poate rămâne neachitată. Doar vânzările de produse se pot lăsa pe datorie.',
    'achitat',
  )
}

/**
 * Punctul de lucru implicit.
 *
 * Clinica are o singură locație și interfața nu o mai cere nicăieri, deci
 * serverul o completează. Se preferă unul activ; dacă nu există niciunul,
 * oricare, pentru ca o clinică cu punctul închis din greșeală să poată totuși
 * lucra în loc să primească erori la fiecare programare.
 */
function punctImplicit(): Uuid {
  let rezerva: Uuid | null = null
  for (const p of magazin.punct_lucru.values()) {
    if (p.activ) return p.id
    rezerva ??= p.id
  }
  if (rezerva === null) throw eroareValidare('Nu există niciun punct de lucru.', 'punct_lucru_id')
  return rezerva
}

/**
 * Persoana unei notițe, dacă are una.
 *
 * `null` și lipsa înseamnă același lucru: „toată clinica”. Cu o persoană,
 * contul trebuie să existe și să fie activ — aceeași regulă ca la executantul
 * unei programări.
 */
function executantOptional(executant_id: Uuid | null | undefined): Uuid | null {
  if (!executant_id) return null
  const executant = ceruta(magazin.utilizator, executant_id, 'Executantul')
  if (!executant.activ) {
    throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
  }
  return executant.id
}

// ---------------------------------------------------------------------------
// Serviciile unei programări — aceleași reguli ca `routes/programari.ts`
// ---------------------------------------------------------------------------

/** Peste atâtea servicii, lista e o greșeală de trimitere, nu o venire la clinică. */
const SERVICII_MAXIME = 20

/** `servicii` lipsă -> undefined (un singur serviciu, ca până acum); altfel o listă nevidă. */
function serviciiDin(lista: ServiciuProgramare[] | undefined): ServiciuProgramare[] | undefined {
  if (lista === undefined) return undefined
  if (lista.length === 0) {
    throw eroareValidare('Programarea trebuie să aibă cel puțin un serviciu.', 'servicii')
  }
  if (lista.length > SERVICII_MAXIME) {
    throw eroareValidare(`O programare poate avea cel mult ${SERVICII_MAXIME} de servicii.`, 'servicii')
  }
  return lista
}

/**
 * Eroarea unui serviciu din listă spune și CARE serviciu: `servicii.2.pret`.
 * Conflictele își țin câmpul în `detalii` (v. `eroareConflict`), deci se
 * rescrie acolo unde stă.
 */
function peServiciu<T>(index: number | null, fn: () => T): T {
  if (index === null) return fn()
  try {
    return fn()
  } catch (e) {
    const camp = campVinovat(e)
    if (!(e instanceof EroareApi) || !camp || camp.startsWith('servicii.')) throw e
    const nou = `servicii.${index}.${camp}`
    throw new EroareApi(e.cod, e.message, e.camp
      ? { camp: nou, ...(e.detalii ? { detalii: e.detalii } : {}) }
      : { detalii: { ...e.detalii, camp: nou } })
  }
}

/** Rândurile programării din care face parte `id`, în ordinea în care s-au adăugat. */
function serviciileProgramarii(id: Uuid): { ancora: Programare; randuri: Programare[] } {
  const ancora = ceruta(magazin.programare, id, 'Programarea')
  const randuri: Programare[] = []
  for (const p of magazin.programare.values()) if (p.vizita_id === ancora.vizita_id) randuri.push(p)
  return { ancora, randuri }
}

/** Ce scriu la fel toate rândurile aceleiași programări. */
type VizitaNoua = Pick<
  Programare,
  'vizita_id' | 'client_id' | 'executant_id' | 'punct_lucru_id' | 'incepe_la' | 'se_termina_la' | 'stare' | 'nota'
>

/**
 * Scrie un serviciu al programării, cu tratamentul și prețul lui.
 *
 * Tratamentul, înaintea prețului: la un serviciu în mai multe ședințe, prețul
 * ședinței este partea ei din tratament. Două ședințe din același tratament în
 * aceeași programare se scriu pe rând, deci a doua își ia locul și partea după
 * ce prima și le-a luat pe ale ei.
 */
function adaugaServiciu(
  autor_id: Uuid,
  vizita: VizitaNoua,
  articol: Articol,
  serviciu: ServiciuProgramare,
): Programare {
  const inTratament = tratamentulSedintei(vizita.client_id, articol, serviciu.tratament_id, autor_id)
  // Prețul lipsă se completează din memoria clientului, nu direct din
  // nomenclator. Într-un tratament, memoria e chiar tratamentul.
  const pret = serviciu.pret ?? inTratament?.pret ?? pretPentru(vizita.client_id, articol.id).pret
  verificaPret(pret, 'pret')

  const rand: Programare = {
    id: uuid(),
    client_id: vizita.client_id,
    articol_id: articol.id,
    articol_tip: 'serviciu',
    executant_id: vizita.executant_id,
    punct_lucru_id: vizita.punct_lucru_id,
    incepe_la: vizita.incepe_la,
    se_termina_la: vizita.se_termina_la,
    stare: vizita.stare,
    pret,
    nota: vizita.nota,
    creat_de: autor_id,
    creat_la: acum(),
    actualizat_la: acum(),
    tratament_id: inTratament?.tratament.id ?? null,
    vizita_id: vizita.vizita_id,
  }
  magazin.programare.set(rand.id, rand)

  scrieJurnal({
    utilizator_id: autor_id,
    actiune: 'creare',
    entitate: 'programare',
    entitate_id: rand.id,
    date_noi: instantaneu(rand as unknown as Record<string, unknown>),
  })
  return rand
}

// ---------------------------------------------------------------------------
// Tratamente — aceleași reguli ca `lib/tratamente.ts` de pe server
// ---------------------------------------------------------------------------

/** Tratamentul ÎN CURS al unui client la un serviciu — cel mult unul (`tratament_in_curs_uk`). */
function tratamentInCurs(client_id: Uuid, articol_id: Uuid): Tratament | null {
  for (const t of magazin.tratament.values()) {
    if (t.client_id === client_id && t.articol_id === articol_id && t.incheiat_la === null) return t
  }
  return null
}

/**
 * Prețul cu care se deschide un tratament nou: ce s-a convenit data trecută
 * cu acest client, la același număr de ședințe — altfel nomenclatorul.
 */
function pretTotalPentru(client_id: Uuid, articol: Articol): { pret_total: number; din_istoric: boolean } {
  let precedent: Tratament | null = null
  for (const t of magazin.tratament.values()) {
    if (t.client_id !== client_id || t.articol_id !== articol.id) continue
    if (precedent === null || t.creat_la > precedent.creat_la) precedent = t
  }
  if (
    precedent === null
    || precedent.numar_sedinte !== articol.numar_sedinte
    || precedent.pret_total === articol.pret_lista
  ) {
    return { pret_total: articol.pret_lista, din_istoric: false }
  }
  return { pret_total: precedent.pret_total, din_istoric: true }
}

/** Deschide un tratament; 409 dacă omul are deja unul în curs la același serviciu. */
function deschideTratament(
  client_id: Uuid,
  articol: Articol,
  date: Pick<DateTratamentNou, 'numar_sedinte' | 'pret_total' | 'nota'>,
  autor_id: Uuid,
): Tratament {
  if (articol.tip !== 'serviciu') {
    throw eroareValidare('Un tratament se face dintr-un serviciu, nu dintr-un produs.', 'articol_id')
  }
  const existent = tratamentInCurs(client_id, articol.id)
  if (existent) {
    throw eroareConflict(
      'Clientul are deja un tratament în curs pentru acest serviciu; ședințele noi intră în el.',
      { camp: 'articol_id', tratament_id: existent.id },
    )
  }

  const numar_sedinte =
    date.numar_sedinte === undefined ? articol.numar_sedinte : verificaNumarSedinte(date.numar_sedinte)
  const pret_total = date.pret_total ?? pretTotalPentru(client_id, articol).pret_total
  verificaPret(pret_total, 'pret_total')

  const rand: Tratament = {
    id: uuid(),
    client_id,
    articol_id: articol.id,
    articol_tip: 'serviciu',
    numar_sedinte,
    pret_total,
    nota: textOptional(date.nota),
    incheiat_la: null,
    creat_de: autor_id,
    creat_la: acum(),
    actualizat_la: acum(),
  }
  magazin.tratament.set(rand.id, rand)

  scrieJurnal({
    utilizator_id: autor_id,
    actiune: 'creare',
    entitate: 'tratament',
    entitate_id: rand.id,
    date_noi: instantaneu(rand as unknown as Record<string, unknown>),
  })
  return rand
}

/**
 * Tratamentul în care intră o ședință nouă, cu partea ei de preț — sau null
 * la un serviciu dintr-o venire fără tratament deschis. Vezi
 * `tratamentulSedintei` de pe server pentru cele trei drumuri.
 */
function tratamentulSedintei(
  client_id: Uuid,
  articol: Articol,
  tratament_id: Uuid | null | undefined,
  autor_id: Uuid,
): { tratament: TratamentDetaliu; pret: number } | null {
  let tratament: Tratament | null = null

  if (tratament_id) {
    tratament = ceruta(magazin.tratament, tratament_id, 'Tratamentul')
    if (tratament.client_id !== client_id) {
      throw eroareValidare('Tratamentul ales aparține altui client.', 'tratament_id')
    }
    if (tratament.articol_id !== articol.id) {
      throw eroareValidare('Tratamentul ales este pentru alt serviciu.', 'tratament_id')
    }
    if (tratament.incheiat_la !== null) {
      throw eroareValidare('Tratamentul este încheiat; redeschide-l sau începe unul nou.', 'tratament_id')
    }
  } else {
    tratament = tratamentInCurs(client_id, articol.id)
    if (!tratament && articol.numar_sedinte > 1) {
      tratament = deschideTratament(client_id, articol, {}, autor_id)
    }
  }

  if (!tratament) return null

  const detaliu = hidrateazaTratament(tratament)
  if (detaliu.sedinte_ramase <= 0) {
    throw eroareConflict(
      `Tratamentul are deja toate cele ${detaliu.numar_sedinte} ședințe programate sau făcute. ` +
        'Mărește numărul de ședințe pe tratament sau încheie-l și începe altul.',
      { camp: 'tratament_id', tratament_id: detaliu.id },
    )
  }
  return { tratament: detaliu, pret: detaliu.pret_urmatoarea }
}

/** Ultima ședință onorată încheie tratamentul singură; drumul invers e de mână. */
function incheieDacaEComplet(tratament_id: Uuid | null, autor_id: Uuid): void {
  if (tratament_id === null) return
  const rand = magazin.tratament.get(tratament_id)
  if (!rand || rand.incheiat_la !== null) return
  const detaliu = hidrateazaTratament(rand)
  if (detaliu.sedinte_onorate < detaliu.numar_sedinte) return

  rand.incheiat_la = acum()
  atinge(rand)
  scrieJurnal({
    utilizator_id: autor_id,
    actiune: 'modificare',
    entitate: 'tratament',
    entitate_id: rand.id,
    date_vechi: { incheiat_la: null },
    date_noi: { incheiat_la: rand.incheiat_la, motiv: 'toate ședințele onorate' },
  })
}

/** Încheierea și redeschiderea, cu semn schimbat — ca arhivarea fișei. */
function comutaIncheierea(id: Uuid, incheie: boolean, autor_id: Uuid): TratamentDetaliu {
  const rand = ceruta(magazin.tratament, id, 'Tratamentul')
  const deja = incheie ? rand.incheiat_la !== null : rand.incheiat_la === null
  if (deja) return hidrateazaTratament(rand)

  if (!incheie) {
    const altul = tratamentInCurs(rand.client_id, rand.articol_id)
    if (altul) {
      throw eroareConflict(
        'Clientul are între timp alt tratament în curs pentru acest serviciu; încheie-l pe acela întâi.',
        { tratament_id: altul.id },
      )
    }
  }

  const vechi = rand.incheiat_la
  rand.incheiat_la = incheie ? acum() : null
  atinge(rand)
  scrieJurnal({
    utilizator_id: autor_id,
    actiune: 'modificare',
    entitate: 'tratament',
    entitate_id: rand.id,
    date_vechi: { incheiat_la: vechi },
    date_noi: { incheiat_la: rand.incheiat_la },
  })
  return hidrateazaTratament(rand)
}

/**
 * Prețul cu care se deschide formularul pentru un client și un serviciu.
 *
 * „Memoria” prețului nu este o tabelă separată, ci chiar istoricul: ultimul
 * preț pe care clientul l-a avut la acest serviciu. O tabelă în plus ar fi
 * trebuit ținută în sincron cu programările și ar fi putut rămâne în urmă;
 * aici, o singură modificare de preț în formular devine automat prețul lui.
 *
 * Într-un tratament, memoria este chiar tratamentul: prețul este partea
 * ședinței din el, iar răspunsul spune și a câta ședință ar fi.
 */
function pretPentru(client_id: Uuid, articol_id: Uuid): PretSugerat {
  const articol = ceruta(magazin.articol, articol_id, 'Serviciul')

  const inCurs = tratamentInCurs(client_id, articol.id)
  if (inCurs) {
    const t = hidrateazaTratament(inCurs)
    return {
      pret: t.pret_urmatoarea,
      din_istoric: false,
      pret_lista: articol.pret_lista,
      tratament: {
        id: t.id,
        numar_sedinte: t.numar_sedinte,
        sedinta_nr: t.sedinte_programate + t.sedinte_onorate + 1,
        pret_total: t.pret_total,
      },
    }
  }

  if (articol.numar_sedinte > 1) {
    const { pret_total, din_istoric } = pretTotalPentru(client_id, articol)
    return {
      pret: rotunjeste(pret_total / articol.numar_sedinte),
      din_istoric,
      pret_lista: articol.pret_lista,
      tratament: { id: null, numar_sedinte: articol.numar_sedinte, sedinta_nr: 1, pret_total },
    }
  }

  let ultima: Programare | null = null
  for (const p of magazin.programare.values()) {
    if (p.client_id !== client_id || p.articol_id !== articol_id) continue
    // Ședințele anulate nu spun nimic despre ce plătește clientul.
    if (p.stare === 'anulat') continue
    if (ultima === null || p.incepe_la > ultima.incepe_la) ultima = p
  }

  if (ultima === null || ultima.pret === articol.pret_lista) {
    return { pret: articol.pret_lista, din_istoric: false, pret_lista: articol.pret_lista }
  }
  return { pret: ultima.pret, din_istoric: true, pret_lista: articol.pret_lista }
}

/**
 * Scrie o încasare: antetul, câte o linie pentru fiecare ședință stinsă și
 * liniile de produse. Punct unic pentru cele două căi care încasează —
 * bifa „achitat” de la onorare și încasarea ulterioară de pe fișă — ca ele să
 * nu poată ajunge să scrie rânduri de forme diferite.
 */
function inregistreazaIncasare(
  autor_id: Uuid,
  client_id: Uuid,
  programari: Programare[],
  produse: DateLinieVanzare[],
  efectuat_la: Timestamptz,
  nota: string | null,
  metoda_plata: MetodaPlata | null,
): VanzareDetaliu {
  // Totul se validează înainte de prima scriere: pe server este o tranzacție,
  // deci un produs invalid nu are voie să lase ședințele pe jumătate stinse.
  const liniiProduse = produse.map(pregatesteLinie)

  const vanzare: Vanzare = {
    id: uuid(),
    client_id,
    punct_lucru_id: programari[0]?.punct_lucru_id ?? punctImplicit(),
    operator_id: autor_id,
    // Legătura pe antet rămâne pentru compatibilitate cu §3, dar numai când
    // încasarea acoperă exact o ședință. Adevărul este pe linii.
    programare_id: programari.length === 1 ? (programari[0]?.id ?? null) : null,
    efectuat_la,
    nota: textOptional(nota),
    creat_la: acum(),
    actualizat_la: acum(),
    // Încasarea este chiar plata, în momentul ei.
    achitat_la: efectuat_la,
    metoda_plata,
  }
  magazin.vanzare.set(vanzare.id, vanzare)

  for (const p of programari) {
    const linie: VanzareLinie = {
      id: uuid(),
      vanzare_id: vanzare.id,
      articol_id: p.articol_id,
      cantitate: 1,
      // Prețul convenit la programare, nu cel din nomenclator de azi.
      pret_unitar: p.pret,
      total_linie: totalLinie(1, p.pret),
      programare_id: p.id,
    }
    magazin.vanzare_linie.set(linie.id, linie)
  }

  for (const linie of liniiProduse) {
    const cuId: VanzareLinie = { ...linie, id: uuid(), vanzare_id: vanzare.id }
    magazin.vanzare_linie.set(cuId.id, cuId)
  }

  scrieJurnal({
    utilizator_id: autor_id,
    actiune: 'creare',
    entitate: 'vanzare',
    entitate_id: vanzare.id,
    date_noi: {
      ...instantaneu(vanzare as unknown as Record<string, unknown>),
      programari_incasate: programari.length,
      linii_produse: liniiProduse.length,
    },
  })

  return hidrateazaVanzare(vanzare)
}

/** Clinica trebuie să rămână cu cel puțin un administrator activ. */
function verificaRamaneUnAdministrator(exceptaId: Uuid): void {
  let ramasi = 0
  for (const u of magazin.utilizator.values()) {
    if (u.id === exceptaId) continue
    if (u.rol === 'administrator' && u.activ) ramasi++
  }
  if (ramasi === 0) {
    throw eroareValidare(
      'Trebuie să existe cel puțin un administrator activ. Desemnează altul înainte.',
      'rol',
    )
  }
}

function revocaSesiunile(utilizator_id: Uuid): void {
  const momentul = acum()
  for (const s of magazin.sesiune.values()) {
    if (s.utilizator_id === utilizator_id && s.revocata_la === null) {
      s.revocata_la = momentul
    }
  }
}

/**
 * Despachetează PDF-ul primit, cu aceleași verificări ca serverul.
 *
 * Se uită la primii octeți, nu doar la lungime. Fără asta, în modul de
 * demonstrație ar intra în „bază” orice șir, iar butonul „Vezi acordul” ar fi
 * întors un fișier pe care niciun cititor nu-l deschide — o diferență de
 * comportament între demonstrație și server exact acolo unde nu trebuie.
 */
function pdfDinBase64(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || base64.trim() === '') {
    throw eroareValidare('Lipsește documentul semnat.', 'document')
  }

  let binar: string
  try {
    binar = atob(base64)
  } catch {
    throw eroareValidare('Documentul semnat nu a putut fi citit.', 'document')
  }

  if (binar.length === 0) throw eroareValidare('Documentul semnat este gol.', 'document')
  if (binar.length > 3 * 1024 * 1024) {
    throw eroareValidare('Documentul semnat este prea mare.', 'document')
  }
  if (binar.slice(0, 5) !== '%PDF-') {
    throw eroareValidare('Fișierul trimis nu este un document PDF.', 'document')
  }

  const octeti = new Uint8Array(binar.length)
  for (let i = 0; i < binar.length; i++) octeti[i] = binar.charCodeAt(i)
  return octeti
}

/**
 * Amprenta documentului, calculată aici cum o calculează serverul acolo.
 *
 * `crypto.subtle` există în orice browser modern și în mediul de probe. Dacă
 * totuși lipsește — o pagină servită fără context securizat, de pildă —
 * întoarce o amprentă vădit falsă, în loc să oprească semnarea: în modul de
 * demonstrație nu există nimic de dovedit, iar un ecran care refuză să meargă
 * ar fi mai rău decât o amprentă care se vede de departe că nu e reală.
 */
async function amprentaSha256(octeti: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return '0'.repeat(64)

  const rezumat = await subtle.digest('SHA-256', octeti.slice().buffer)
  return Array.from(new Uint8Array(rezumat))
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('')
}
