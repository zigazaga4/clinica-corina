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
  ApiClient,
  DateArticolModificat,
  DateArticolNou,
  DateClientModificat,
  DateClientNou,
  DateConsimtamantNou,
  DateIncasare,
  DateLinieVanzare,
  DateNotitaModificata,
  DateNotitaNoua,
  DatePunctLucruModificat,
  DatePunctLucruNou,
  DateProgramareModificata,
  DateProgramareNoua,
  DateUtilizatorModificat,
  DateUtilizatorNou,
  DateVanzareModificata,
  DateVanzareNoua,
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
import {
  eroareConflict,
  eroareInterzis,
  eroareNeautentificat,
  eroareValidare,
} from '@/api/errors'
import { citesteTokenuri } from '@/api/session'
import type {
  Articol,
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  NotaClient,
  NotaClientDetaliu,
  Notita,
  NotitaDetaliu,
  Programare,
  ProgramareDetaliu,
  PunctLucru,
  StareProgramare,
  Timestamptz,
  Utilizator,
  Uuid,
  Vanzare,
  VanzareDetaliu,
  VanzareLinie,
} from '@/domain/types'
import { acum, addDays, laTimestamptz } from '@/lib/dates'
import { uuid } from '@/lib/id'
import { totalLinie } from '@/lib/money'
import { contine, doarCifre, normalizeaza } from '@/lib/text'
import {
  ceruta,
  ceruteText,
  textOptional,
  verificaArticolProgramabil,
  verificaCantitate,
  verificaDenumirePunctUnica,
  verificaDurataArticol,
  verificaEmailUnic,
  verificaFormatEmail,
  verificaIntervalProgramare,
  verificaParola,
  verificaPret,
  verificaStergereClient,
  verificaSuprapunere,
} from './constraints'
import {
  hidrateazaClient,
  hidrateazaConsimtamant,
  hidrateazaJurnal,
  hidrateazaNota,
  hidrateazaNotita,
  hidrateazaProgramare,
  hidrateazaVanzare,
  incasareaProgramarii,
  utilizatorPublic,
} from './hydrate'
import { diferenta, instantaneu, scrieJurnal } from './journal'
import { populeaza } from './seed'
import {
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

      /** POST /programari — orice rol */
      async create(date: DateProgramareNoua): Promise<ProgramareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()

        ceruta(magazin.client, date.client_id, 'Clientul')
        const serviciu = verificaArticolProgramabil(date.articol_id)
        const executant = ceruta(magazin.utilizator, date.executant_id, 'Executantul')
        if (!executant.activ) {
          throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
        }
        const punct_lucru_id = date.punct_lucru_id ?? punctImplicit()
        ceruta(magazin.punct_lucru, punct_lucru_id, 'Punctul de lucru')
        verificaIntervalProgramare(date.incepe_la, date.se_termina_la)
        verificaSuprapunere(date.executant_id, date.incepe_la, date.se_termina_la, 'programat')

        // Prețul lipsă se completează din memoria clientului, nu direct din
        // nomenclator: dacă i s-a mai făcut acest serviciu la un preț anume,
        // acela este prețul lui.
        const pret = date.pret ?? pretPentru(date.client_id, serviciu.id).pret
        verificaPret(pret, 'pret')

        const rand: Programare = {
          id: uuid(),
          client_id: date.client_id,
          articol_id: date.articol_id,
          articol_tip: 'serviciu',
          executant_id: date.executant_id,
          punct_lucru_id,
          incepe_la: date.incepe_la,
          se_termina_la: date.se_termina_la,
          stare: 'programat',
          pret,
          nota: textOptional(date.nota),
          creat_de: autor.id,
          creat_la: acum(),
          actualizat_la: acum(),
        }
        magazin.programare.set(rand.id, rand)

        scrieJurnal({
          utilizator_id: autor.id,
          actiune: 'creare',
          entitate: 'programare',
          entitate_id: rand.id,
          date_noi: instantaneu(rand as unknown as Record<string, unknown>),
        })

        return hidrateazaProgramare(rand)
      },

      /** PATCH /programari/:id — orice rol */
      async update(id, date: DateProgramareModificata): Promise<ProgramareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.programare, id, 'Programarea')
        const inainte = { ...rand }

        if (date.client_id !== undefined) {
          ceruta(magazin.client, date.client_id, 'Clientul')
          rand.client_id = date.client_id
        }
        if (date.articol_id !== undefined) {
          verificaArticolProgramabil(date.articol_id)
          rand.articol_id = date.articol_id
        }
        if (date.executant_id !== undefined) {
          const executant = ceruta(magazin.utilizator, date.executant_id, 'Executantul')
          if (!executant.activ) {
            throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
          }
          rand.executant_id = date.executant_id
        }
        if (date.punct_lucru_id !== undefined && date.punct_lucru_id !== null) {
          ceruta(magazin.punct_lucru, date.punct_lucru_id, 'Punctul de lucru')
          rand.punct_lucru_id = date.punct_lucru_id
        }
        if (date.incepe_la !== undefined) rand.incepe_la = date.incepe_la
        if (date.se_termina_la !== undefined) rand.se_termina_la = date.se_termina_la
        if (date.pret !== undefined) {
          // Prețul unei ședințe deja încasate nu se mai atinge: ar rămâne
          // diferit de suma chiar plătită, iar încasarea nu se rescrie.
          if (incasareaProgramarii(rand.id) !== null) {
            throw eroareValidare(
              'Ședința este deja încasată; prețul ei nu se mai poate schimba.',
              'pret',
            )
          }
          verificaPret(date.pret, 'pret')
          rand.pret = date.pret
        }
        if (date.nota !== undefined) rand.nota = textOptional(date.nota)

        verificaIntervalProgramare(rand.incepe_la, rand.se_termina_la)
        // Se exclude pe sine din verificare: altfel o reprogramare care mută
        // intervalul cu cinci minute s-ar suprapune cu propria variantă veche.
        verificaSuprapunere(rand.executant_id, rand.incepe_la, rand.se_termina_la, rand.stare, rand.id)
        atinge(rand)

        const dif = diferenta(
          inainte as unknown as Record<string, unknown>,
          rand as unknown as Record<string, unknown>,
        )
        if (dif) {
          scrieJurnal({
            utilizator_id: autor.id,
            actiune: 'modificare',
            entitate: 'programare',
            entitate_id: rand.id,
            ...dif,
          })
        }

        return hidrateazaProgramare(rand)
      },

      /** PATCH /programari/:id/stare — orice rol */
      async schimbaStarea(
        id,
        stare: StareProgramare,
        achitat?: boolean,
      ): Promise<ProgramareDetaliu> {
        await intarziere()
        const autor = cereUtilizator()
        const rand = ceruta(magazin.programare, id, 'Programarea')

        if (rand.stare !== stare) {
          // Reactivarea unei programări anulate o readuce sub constrângerea de
          // suprapunere — între timp, locul putea fi ocupat de altcineva.
          if (rand.stare === 'anulat' && stare !== 'anulat') {
            verificaSuprapunere(rand.executant_id, rand.incepe_la, rand.se_termina_la, stare, rand.id)
          }

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

        // Plata se înregistrează doar la onorare și doar dacă nu s-a plătit
        // deja. Cerută pe o ședință anulată, ar însemna încasarea unui serviciu
        // care nu a avut loc.
        if (achitat === true && stare === 'onorat' && incasareaProgramarii(rand.id) === null) {
          inregistreazaIncasare(autor.id, rand.client_id, [rand], [], rand.se_termina_la, null)
        }

        return hidrateazaProgramare(rand)
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
      /** GET /vanzari — orice rol */
      async list(filtru: FiltruVanzari = {}): Promise<Paginat<VanzareDetaliu>> {
        await intarziere()
        cereUtilizator()

        const randuri: VanzareDetaliu[] = []
        for (const v of magazin.vanzare.values()) {
          if (!inInterval(v.efectuat_la, filtru.de_la, filtru.pana_la)) continue
          if (filtru.client_id && v.client_id !== filtru.client_id) continue
          if (filtru.punct_lucru_id && v.punct_lucru_id !== filtru.punct_lucru_id) continue
          if (filtru.operator_id && v.operator_id !== filtru.operator_id) continue

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
        }
        magazin.vanzare.set(rand.id, rand)
        for (const linie of pregatite) {
          const cuId: VanzareLinie = { ...linie, id: uuid(), vanzare_id: rand.id }
          magazin.vanzare_linie.set(cuId.id, cuId)
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
        )
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

        const rand: Articol = {
          id: uuid(),
          tip: date.tip,
          denumire: ceruteText(date.denumire, 'denumire', 'Denumirea'),
          durata_minute: durata,
          pret_lista: date.pret_lista,
          activ: date.activ ?? true,
          creat_la: acum(),
          actualizat_la: acum(),
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

        rand.tip = tip
        rand.durata_minute = durata ?? null
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

        const randuri: JurnalOperatiuneDetaliu[] = []
        for (const j of magazin.jurnal_operatiuni) {
          if (!inInterval(j.creat_la, filtru.de_la, filtru.pana_la)) continue
          if (filtru.entitate && j.entitate !== filtru.entitate) continue
          if (filtru.entitate_id && j.entitate_id !== filtru.entitate_id) continue
          if (filtru.utilizator_id && j.utilizator_id !== filtru.utilizator_id) continue
          if (actiuni && !actiuni.has(j.actiune)) continue
          randuri.push(hidrateazaJurnal(j))
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

/**
 * Prețul cu care se deschide formularul pentru un client și un serviciu.
 *
 * „Memoria” prețului nu este o tabelă separată, ci chiar istoricul: ultimul
 * preț pe care clientul l-a avut la acest serviciu. O tabelă în plus ar fi
 * trebuit ținută în sincron cu programările și ar fi putut rămâne în urmă;
 * aici, o singură modificare de preț în formular devine automat prețul lui.
 */
function pretPentru(client_id: Uuid, articol_id: Uuid): PretSugerat {
  const articol = ceruta(magazin.articol, articol_id, 'Serviciul')

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
