import { beforeEach, describe, expect, it } from 'vitest'
import { creeazaApiInMemorie } from './client'
import { magazin } from './store'
import { PAROLA_DEMO } from './seed'
import { scrieTokenuri, stergeTokenuri } from '@/api/session'
import { esteEroareApi } from '@/api/errors'
import type { Uuid } from '@/domain/types'

/*
  Testele constrângerilor.

  Verifică exact regulile pe care DDL-ul de la §8 le impune în PostgreSQL. Rostul
  lor nu este acoperirea de cod, ci acesta: cât timp backend-ul este în lucru,
  aceste teste sunt singura dovadă că interfața a fost construită împotriva
  regulilor REALE ale bazei, nu ale unei imitații mai permisive.
*/

const api = creeazaApiInMemorie()

/** Autentificare pentru testele care au nevoie de o sesiune. */
async function autentificaCa(email: string) {
  const raspuns = await api.auth.login({ email, parola: PAROLA_DEMO })
  scrieTokenuri({
    access_token: raspuns.access_token,
    refresh_token: raspuns.refresh_token,
    expira_la: raspuns.expira_la,
  })
  return raspuns.utilizator
}

const ADMIN = 'admin@clinica.ro'
const OPERATOR = 'andreea.popescu@clinica.ro'

/** Primul rând care satisface predicatul, cu eroare clară dacă lipsește. */
function gaseste<T>(map: Map<Uuid, T>, predicat: (rand: T) => boolean, ce: string): T {
  for (const rand of map.values()) if (predicat(rand)) return rand
  throw new Error(`Datele demo nu conțin ${ce}.`)
}

describe('autentificare', () => {
  it('acceptă credențialele corecte și întoarce utilizatorul fără parolă', async () => {
    const raspuns = await api.auth.login({ email: ADMIN, parola: PAROLA_DEMO })
    expect(raspuns.utilizator.email).toBe(ADMIN)
    expect(raspuns.utilizator.rol).toBe('administrator')
    // `parola_hash` nu are voie să părăsească serverul.
    expect(raspuns.utilizator).not.toHaveProperty('parola_hash')
  })

  it('ignoră registrul adresei de e-mail, ca indexul pe lower(email)', async () => {
    const raspuns = await api.auth.login({ email: 'ADMIN@Clinica.RO', parola: PAROLA_DEMO })
    expect(raspuns.utilizator.email).toBe(ADMIN)
  })

  it('dă același mesaj la e-mail inexistent și la parolă greșită', async () => {
    // Mesaje diferite ar transforma formularul într-un detector de conturi.
    const gresita = await api.auth.login({ email: ADMIN, parola: 'altceva' }).catch((e) => e)
    const inexistent = await api.auth
      .login({ email: 'nimeni@clinica.ro', parola: PAROLA_DEMO })
      .catch((e) => e)
    expect(gresita.message).toBe(inexistent.message)
  })

  it('refuză un cont dezactivat', async () => {
    const eroare = await api.auth
      .login({ email: 'diana.georgescu@clinica.ro', parola: PAROLA_DEMO })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('interzis')
  })

  it('respinge cererile fără sesiune', async () => {
    stergeTokenuri()
    const eroare = await api.clienti.list().catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('neautentificat')
  })
})

describe('drepturi pe rol (§7, coloana „Acces Rol”)', () => {
  it('refuză unui operator listele rezervate administratorului', async () => {
    await autentificaCa(OPERATOR)
    for (const cerere of [api.utilizatori.list(), api.jurnal.list()]) {
      const eroare = await cerere.catch((e) => e)
      expect(esteEroareApi(eroare) && eroare.cod).toBe('interzis')
    }
  })

  it('refuză unui operator modificarea nomenclatorului', async () => {
    await autentificaCa(OPERATOR)
    const eroare = await api.articole
      .create({ tip: 'produs', denumire: 'Test', pret_lista: 10 })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('interzis')
  })

  it('permite operatorului operațiunile marcate „orice”', async () => {
    await autentificaCa(OPERATOR)
    const client = await api.clienti.create({ nume: 'Test Operator' })
    expect(client.id).toBeTruthy()
    await expect(api.articole.list()).resolves.toBeInstanceOf(Array)
  })
})

describe('programare_fara_suprapunere (EXCLUDE USING gist)', () => {
  let context: {
    client_id: Uuid
    articol_id: Uuid
    executant_id: Uuid
    punct_lucru_id: Uuid
  }

  beforeEach(async () => {
    const utilizator = await autentificaCa(ADMIN)
    const client = gaseste(magazin.client, (c) => c.arhivat_la === null, 'clienți activi')
    const serviciu = gaseste(
      magazin.articol,
      (a) => a.tip === 'serviciu' && a.activ,
      'servicii active',
    )
    const punct = gaseste(magazin.punct_lucru, (p) => p.activ, 'puncte de lucru active')
    context = {
      client_id: client.id,
      articol_id: serviciu.id,
      executant_id: utilizator.id,
      punct_lucru_id: punct.id,
    }
  })

  /** Un interval liber, departe de programările generate. */
  const interval = (oraInceput: number, oraSfarsit: number) => {
    const zi = new Date()
    zi.setFullYear(zi.getFullYear() + 1)
    const inceput = new Date(zi)
    inceput.setHours(oraInceput, 0, 0, 0)
    const sfarsit = new Date(zi)
    sfarsit.setHours(oraSfarsit, 0, 0, 0)
    return { incepe_la: inceput.toISOString(), se_termina_la: sfarsit.toISOString() }
  }

  it('respinge două programări suprapuse pentru aceeași persoană', async () => {
    await api.programari.create({ ...context, ...interval(10, 11) })
    const eroare = await api.programari.create({ ...context, ...interval(10, 12) }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
  })

  it('acceptă intervale care doar se ating', async () => {
    // `tstzrange` este [inclusiv, exclusiv): 14:00–15:00 și 15:00–16:00 NU se
    // suprapun. O implementare cu `<=` ar respinge programări perfect valide.
    await api.programari.create({ ...context, ...interval(14, 15) })
    await expect(
      api.programari.create({ ...context, ...interval(15, 16) }),
    ).resolves.toBeTruthy()
  })

  it('eliberează intervalul după anulare (clauza WHERE stare <> anulat)', async () => {
    const prima = await api.programari.create({ ...context, ...interval(9, 10) })
    await api.programari.schimbaStarea(prima.id, 'anulat')
    await expect(
      api.programari.create({ ...context, ...interval(9, 10) }),
    ).resolves.toBeTruthy()
  })

  it('nu se compară cu sine la reprogramare', async () => {
    // Mutarea cu 15 minute ar intra în conflict cu propria variantă veche dacă
    // rândul nu s-ar exclude din verificare.
    const programare = await api.programari.create({ ...context, ...interval(12, 13) })
    const mutata = interval(12, 14)
    await expect(
      api.programari.update(programare.id, mutata),
    ).resolves.toMatchObject({ se_termina_la: mutata.se_termina_la })
  })

  it('nu blochează două persoane diferite în același interval', async () => {
    const alta = gaseste(
      magazin.utilizator,
      (u) => u.activ && u.id !== context.executant_id,
      'un al doilea cont activ',
    )
    await api.programari.create({ ...context, ...interval(16, 17) })
    await expect(
      api.programari.create({ ...context, executant_id: alta.id, ...interval(16, 17) }),
    ).resolves.toBeTruthy()
  })

  it('cere ca sfârșitul să fie după început (programare_interval_ck)', async () => {
    const invers = interval(11, 10)
    const eroare = await api.programari.create({ ...context, ...invers }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('se_termina_la')
  })

  it('refuză programarea unui produs (CHECK articol_tip = serviciu)', async () => {
    const produs = gaseste(magazin.articol, (a) => a.tip === 'produs', 'produse')
    const eroare = await api.programari
      .create({ ...context, articol_id: produs.id, ...interval(8, 9) })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('articol_id')
  })
})

describe('articol_durata_ck', () => {
  beforeEach(async () => {
    await autentificaCa(ADMIN)
  })

  it('cere durată pentru servicii', async () => {
    const eroare = await api.articole
      .create({ tip: 'serviciu', denumire: 'Fără durată', pret_lista: 100 })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('durata_minute')
  })

  it('refuză durata pe produse', async () => {
    const eroare = await api.articole
      .create({ tip: 'produs', denumire: 'Cremă', pret_lista: 100, durata_minute: 30 })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('durata_minute')
  })

  it('golește durata când un serviciu devine produs', async () => {
    const serviciu = await api.articole.create({
      tip: 'serviciu',
      denumire: 'Serviciu temporar',
      pret_lista: 100,
      durata_minute: 45,
    })
    const dupa = await api.articole.update(serviciu.id, { tip: 'produs' })
    expect(dupa.durata_minute).toBeNull()
  })

  it('refuză prețul negativ', async () => {
    const eroare = await api.articole
      .create({ tip: 'produs', denumire: 'Gratis', pret_lista: -1 })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('pret_lista')
  })
})

describe('clienți: arhivare și ON DELETE RESTRICT', () => {
  beforeEach(async () => {
    await autentificaCa(ADMIN)
  })

  it('exclude implicit clienții arhivați din listă', async () => {
    const client = await api.clienti.create({ nume: 'De arhivat' })
    await api.clienti.arhiveaza(client.id)

    const implicit = await api.clienti.list({ q: 'De arhivat' })
    expect(implicit.randuri).toHaveLength(0)

    const cuArhivati = await api.clienti.list({ q: 'De arhivat', include_arhivati: true })
    expect(cuArhivati.randuri).toHaveLength(1)
  })

  it('readuce clientul între cei activi la dezarhivare', async () => {
    const client = await api.clienti.create({ nume: 'Revine' })
    await api.clienti.arhiveaza(client.id)
    const dupa = await api.clienti.dezarhiveaza(client.id)
    expect(dupa.arhivat_la).toBeNull()
  })

  it('refuză ștergerea definitivă a unui client cu programări', async () => {
    const client = gaseste(
      magazin.client,
      (c) => [...magazin.programare.values()].some((p) => p.client_id === c.id),
      'un client cu programări',
    )
    const eroare = await api.clienti.remove(client.id).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
    expect(magazin.client.has(client.id)).toBe(true)
  })

  it('permite ștergerea unui client fără istoric și îi cascadează notele', async () => {
    const client = await api.clienti.create({ nume: 'Fără istoric' })
    await api.clienti.adaugaNota(client.id, 'o notă')
    await api.clienti.remove(client.id)

    expect(magazin.client.has(client.id)).toBe(false)
    const noteRamase = [...magazin.nota_client.values()].filter((n) => n.client_id === client.id)
    expect(noteRamase).toHaveLength(0)
  })

  it('caută după nume fără diacritice și după telefon', async () => {
    await api.clienti.create({ nume: 'Călin Ștefania', telefon: '0722 333 444' })

    const dupaNume = await api.clienti.list({ q: 'calin stefania' })
    expect(dupaNume.randuri).toHaveLength(1)

    const dupaTelefon = await api.clienti.list({ q: '0722333444' })
    expect(dupaTelefon.randuri.some((c) => c.nume === 'Călin Ștefania')).toBe(true)
  })
})

describe('vânzări', () => {
  let baza: { client_id: Uuid; punct_lucru_id: Uuid; efectuat_la: string }

  beforeEach(async () => {
    await autentificaCa(ADMIN)
    const client = gaseste(magazin.client, (c) => c.arhivat_la === null, 'clienți activi')
    const punct = gaseste(magazin.punct_lucru, (p) => p.activ, 'puncte de lucru active')
    baza = {
      client_id: client.id,
      punct_lucru_id: punct.id,
      efectuat_la: new Date().toISOString(),
    }
  })

  it('calculează total_linie ca round(cantitate * pret_unitar, 2)', async () => {
    const articol = gaseste(magazin.articol, (a) => a.activ, 'articole active')
    const vanzare = await api.vanzari.create({
      ...baza,
      linii: [{ articol_id: articol.id, cantitate: 3, pret_unitar: 19.99 }],
    })
    expect(vanzare.linii[0]?.total_linie).toBe(59.97)
    expect(vanzare.total).toBe(59.97)
  })

  it('copiază prețul din nomenclator când linia nu îl dă', async () => {
    const articol = gaseste(magazin.articol, (a) => a.activ, 'articole active')
    const vanzare = await api.vanzari.create({
      ...baza,
      linii: [{ articol_id: articol.id, cantitate: 1 }],
    })
    expect(vanzare.linii[0]?.pret_unitar).toBe(articol.pret_lista)
  })

  it('nu rescrie vânzările vechi când se schimbă prețul de listă', async () => {
    // Prețul este COPIAT la vânzare: o scumpire de mâine nu are voie să
    // modifice încasarea de ieri.
    const articol = gaseste(magazin.articol, (a) => a.activ, 'articole active')
    // Prețul se reține ÎNAINTE: `articol` este chiar rândul din magazin, deci
    // după `update` câmpul lui reflectă noul preț de listă.
    const pretLaVanzare = articol.pret_lista

    const vanzare = await api.vanzari.create({
      ...baza,
      linii: [{ articol_id: articol.id, cantitate: 1 }],
    })
    await api.articole.update(articol.id, { pret_lista: pretLaVanzare + 100 })

    const dupa = await api.vanzari.get(vanzare.id)
    expect(dupa.linii[0]?.pret_unitar).toBe(pretLaVanzare)
  })

  it('refuză o vânzare fără linii', async () => {
    const eroare = await api.vanzari.create({ ...baza, linii: [] }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('linii')
  })

  it('refuză cantitatea zero sau negativă (CHECK cantitate > 0)', async () => {
    const articol = gaseste(magazin.articol, (a) => a.activ, 'articole active')
    const eroare = await api.vanzari
      .create({ ...baza, linii: [{ articol_id: articol.id, cantitate: 0 }] })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('cantitate')
  })

  it('nu lasă vânzarea fără linii când corectarea este invalidă', async () => {
    const articol = gaseste(magazin.articol, (a) => a.activ, 'articole active')
    const vanzare = await api.vanzari.create({
      ...baza,
      linii: [{ articol_id: articol.id, cantitate: 1 }],
    })

    await api.vanzari
      .update(vanzare.id, { linii: [{ articol_id: articol.id, cantitate: -5 }] })
      .catch(() => undefined)

    const dupa = await api.vanzari.get(vanzare.id)
    expect(dupa.linii).toHaveLength(1)
    expect(dupa.linii[0]?.cantitate).toBe(1)
  })
})

/*
  Prețul ședinței și încasarea ei.

  Este modelul cerut de Beneficiar: fiecare programare are un preț al ei,
  clientul poate lăsa mai multe ședințe neachitate și plătește la final. Ce se
  verifică aici nu sunt detalii de interfață, ci regulile pe care serverul real
  va trebui să le impună identic — altfel o clientă ar putea fi taxată de două
  ori pentru aceeași ședință, sau cu altă sumă decât cea convenită.
*/
describe('prețul ședinței și încasarea', () => {
  let context: {
    client_id: Uuid
    articol_id: Uuid
    executant_id: Uuid
  }
  let pretLista: number

  beforeEach(async () => {
    const utilizator = await autentificaCa(ADMIN)
    /*
      Fișă PROASPĂTĂ, nu prima din datele demo.

      Acolo o parte dintre clienți au deja un preț negociat pentru serviciul
      ales, iar o programare nouă îl moștenește — pe bună dreptate, asta este
      chiar regula verificată mai jos. Dar atunci „prețul se completează din
      nomenclator” ajungea să măsoare sămânța, nu regula: aștepta 220 și
      primea 198.

      Care fișă cade prima depinde de ziua în care rulează testul, fiindcă
      datele demo se așază în jurul zilei de azi. De aceea trecea marți și
      pica miercuri — genul de eșec care se pune pe seama ultimei modificări,
      oricare ar fi ea. Aceeași grijă era deja luată mai jos, la „nu împrumută
      prețul negociat altui client”; îi lipsea perechea de aici.
    */
    const client = await api.clienti.create({ nume: 'Client Fără Istoric' })
    const serviciu = gaseste(
      magazin.articol,
      (a) => a.tip === 'serviciu' && a.activ,
      'servicii active',
    )
    pretLista = serviciu.pret_lista
    context = {
      client_id: client.id,
      articol_id: serviciu.id,
      executant_id: utilizator.id,
    }
  })

  /** Un interval liber, în viitor, departe de programările generate. */
  const interval = (oraInceput: number, oraSfarsit: number, peste = 1) => {
    const zi = new Date()
    zi.setFullYear(zi.getFullYear() + peste)
    const inceput = new Date(zi)
    inceput.setHours(oraInceput, 0, 0, 0)
    const sfarsit = new Date(zi)
    sfarsit.setHours(oraSfarsit, 0, 0, 0)
    return { incepe_la: inceput.toISOString(), se_termina_la: sfarsit.toISOString() }
  }

  it('completează prețul din nomenclator când formularul nu îl trimite', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    expect(programare.pret).toBe(pretLista)
  })

  it('ține minte prețul negociat al clientului pentru serviciul respectiv', async () => {
    // Miezul cerinței „să fie reținut pentru clientul acela”: o reducere dată o
    // dată la recepție trebuie să reapară singură data viitoare.
    await api.programari.create({ ...context, ...interval(9, 10), pret: pretLista - 40 })

    const sugestie = await api.programari.pretSugerat(context.client_id, context.articol_id)
    expect(sugestie.pret).toBe(pretLista - 40)
    expect(sugestie.din_istoric).toBe(true)
    expect(sugestie.pret_lista).toBe(pretLista)

    const urmatoarea = await api.programari.create({ ...context, ...interval(11, 12) })
    expect(urmatoarea.pret).toBe(pretLista - 40)
  })

  it('nu împrumută prețul negociat altui client', async () => {
    await api.programari.create({ ...context, ...interval(9, 10), pret: pretLista - 40 })

    // Client PROASPĂT, nu unul din datele demo: acolo o parte dintre fișe au
    // deja prețuri negociate, iar testul ar măsura seminția, nu regula.
    const altul = await api.clienti.create({ nume: 'Fără Istoric' })
    const sugestie = await api.programari.pretSugerat(altul.id, context.articol_id)
    expect(sugestie.pret).toBe(pretLista)
    expect(sugestie.din_istoric).toBe(false)
  })

  it('o ședință anulată nu stabilește prețul clientului', async () => {
    const anulata = await api.programari.create({
      ...context,
      ...interval(9, 10),
      pret: pretLista - 90,
    })
    await api.programari.schimbaStarea(anulata.id, 'anulat')

    const sugestie = await api.programari.pretSugerat(context.client_id, context.articol_id)
    expect(sugestie.pret).toBe(pretLista)
  })

  it('o programare nouă nu este achitată', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    expect(programare.achitat).toBe(false)
    expect(programare.vanzare_id).toBeNull()
    expect(programare.achitat_la).toBeNull()
  })

  it('ședința poartă data la care a fost încasată', async () => {
    // Pe `achitat_la` se sprijină fișa clientului: fără el, ar fi trebuit să
    // arate și bonul lângă ședință ca să se vadă când au intrat banii — adică
    // exact dublura pe care Beneficiarul a reclamat-o.
    const programare = await api.programari.create({ ...context, ...interval(9, 10), pret: 100 })
    await api.programari.schimbaStarea(programare.id, 'onorat')

    const platit_la = '2026-10-05T09:30:00.000Z'
    await api.vanzari.incaseaza({
      client_id: context.client_id,
      programare_ids: [programare.id],
      efectuat_la: platit_la,
    })

    const dupa = await api.programari.get(programare.id)
    expect(dupa.achitat_la).toBe(platit_la)
  })

  it('onorarea cu „achitat” înregistrează încasarea la prețul convenit', async () => {
    const programare = await api.programari.create({
      ...context,
      ...interval(9, 10),
      pret: 137.5,
    })
    const dupa = await api.programari.schimbaStarea(programare.id, 'onorat', true)

    expect(dupa.achitat).toBe(true)
    expect(dupa.vanzare_id).not.toBeNull()

    const incasare = await api.vanzari.get(dupa.vanzare_id as Uuid)
    expect(incasare.total).toBe(137.5)
    expect(incasare.linii).toHaveLength(1)
    // Linia trebuie să indice ședința: pe legătura asta se sprijină `achitat`.
    expect(incasare.linii[0]?.programare_id).toBe(programare.id)
  })

  it('onorarea fără „achitat” lasă ședința de plată', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    const dupa = await api.programari.schimbaStarea(programare.id, 'onorat')
    expect(dupa.achitat).toBe(false)
  })

  it('nu încasează o ședință care nu a avut loc', async () => {
    // Bifa de plată are efect doar la onorare; altfel s-ar putea încasa o
    // ședință anulată.
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    const dupa = await api.programari.schimbaStarea(programare.id, 'anulat', true)
    expect(dupa.achitat).toBe(false)
  })

  it('stinge mai multe ședințe cu o singură încasare', async () => {
    // Cazul cerut de Beneficiar: clienta vine de trei ori și plătește la final.
    const ore: [number, number][] = [
      [9, 10],
      [11, 12],
      [13, 14],
    ]
    const programari = []
    for (const [de, pana] of ore) {
      const p = await api.programari.create({ ...context, ...interval(de, pana), pret: 100 })
      programari.push(await api.programari.schimbaStarea(p.id, 'onorat'))
    }

    const incasare = await api.vanzari.incaseaza({
      client_id: context.client_id,
      programare_ids: programari.map((p) => p.id),
    })

    expect(incasare.total).toBe(300)
    expect(incasare.linii).toHaveLength(3)
    for (const p of programari) {
      expect((await api.programari.get(p.id)).achitat).toBe(true)
    }
  })

  it('refuză încasarea de două ori a aceleiași ședințe', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    await api.programari.schimbaStarea(programare.id, 'onorat', true)

    const eroare = await api.vanzari
      .incaseaza({ client_id: context.client_id, programare_ids: [programare.id] })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
  })

  it('refuză încasarea unei ședințe neonorate', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    const eroare = await api.vanzari
      .incaseaza({ client_id: context.client_id, programare_ids: [programare.id] })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('programare_ids')
  })

  it('refuză încasarea ședinței altui client', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    await api.programari.schimbaStarea(programare.id, 'onorat')

    const altul = await api.clienti.create({ nume: 'Alt Client' })
    const eroare = await api.vanzari
      .incaseaza({ client_id: altul.id, programare_ids: [programare.id] })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('programare_ids')
  })

  it('încasează ședințe și produse în aceeași plată', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10), pret: 200 })
    await api.programari.schimbaStarea(programare.id, 'onorat')
    const produs = gaseste(magazin.articol, (a) => a.tip === 'produs' && a.activ, 'produse active')

    const incasare = await api.vanzari.incaseaza({
      client_id: context.client_id,
      programare_ids: [programare.id],
      linii: [{ articol_id: produs.id, cantitate: 1, pret_unitar: 50 }],
    })

    expect(incasare.total).toBe(250)
    // Linia de produs nu stinge nicio ședință.
    expect(incasare.linii.filter((l) => l.programare_id === null)).toHaveLength(1)
  })

  it('nu mai lasă prețul să fie schimbat după încasare', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    await api.programari.schimbaStarea(programare.id, 'onorat', true)

    const eroare = await api.programari.update(programare.id, { pret: 1 }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('pret')
  })

  it('scumpirea din nomenclator nu atinge o ședință deja programată', async () => {
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    await api.articole.update(context.articol_id, { pret_lista: pretLista + 100 })

    const dupa = await api.programari.get(programare.id)
    expect(dupa.pret).toBe(pretLista)
  })

  it('adună în `de_incasat` doar ședințele onorate și neplătite', async () => {
    // Se măsoară DIFERENȚA, nu suma absolută: clientul din datele demo poate
    // avea deja restanțe, iar un test care presupune zero ar fi legat de
    // sămânța generatorului, nu de regulă.
    const deIncasat = async (): Promise<number> => {
      const lista = await api.clienti.list({ pe_pagina: 500 })
      return lista.randuri.find((c) => c.id === context.client_id)?.de_incasat ?? 0
    }
    const inainte = await deIncasat()

    const platita = await api.programari.create({ ...context, ...interval(9, 10), pret: 80 })
    await api.programari.schimbaStarea(platita.id, 'onorat', true)

    const restanta = await api.programari.create({ ...context, ...interval(11, 12), pret: 120 })
    await api.programari.schimbaStarea(restanta.id, 'onorat')

    // Rămâne doar programată: nu s-a prestat nimic, deci nu se datorează nimic.
    await api.programari.create({ ...context, ...interval(13, 14), pret: 999 })

    expect(await deIncasat()).toBe(inainte + 120)
  })

  /*
    Datele demo trebuie să ARATE funcțiile, nu doar să le permită.

    Cât timp nu există server, ecranul pe care îl vede Beneficiarul este cel
    populat de `seed.ts`. Dacă generatorul ar ajunge, după o modificare, să nu
    mai producă nicio restanță, banda „De plată” și fereastra de încasare nu
    s-ar vedea niciodată — iar aplicația ar părea că nu are funcția cerută,
    deși o are. Verificările de aici păzesc exact asta.
  */
  it('datele demo conțin ședințe rămase de plată', async () => {
    const lista = await api.clienti.list({ pe_pagina: 500 })
    const datornici = lista.randuri.filter((c) => c.de_incasat > 0)
    expect(datornici.length).toBeGreaterThan(0)
  })

  it('datele demo conțin prețuri negociate, diferite de cele de listă', async () => {
    let negociate = 0
    for (const p of magazin.programare.values()) {
      const articol = magazin.articol.get(p.articol_id)
      if (articol && p.pret !== articol.pret_lista) negociate++
    }
    expect(negociate).toBeGreaterThan(0)
  })

  it('clinica are exact un punct de lucru', async () => {
    expect(magazin.punct_lucru.size).toBe(1)
  })

  it('completează singur punctul de lucru când cererea nu îl trimite', async () => {
    // Interfața nu mai are câmpul; serverul trebuie să îl pună.
    const programare = await api.programari.create({ ...context, ...interval(9, 10) })
    expect(programare.punct_lucru_id).toBeTruthy()
  })
})

describe('utilizatori', () => {
  beforeEach(async () => {
    await autentificaCa(ADMIN)
  })

  it('impune unicitatea adresei de e-mail, ignorând registrul', async () => {
    const eroare = await api.utilizatori
      .create({ nume: 'Copie', email: 'ADMIN@clinica.ro', parola: 'parolabuna', rol: 'utilizator' })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
  })

  it('cere o parolă de cel puțin 8 caractere', async () => {
    const eroare = await api.utilizatori
      .create({ nume: 'Scurt', email: 'scurt@clinica.ro', parola: 'abc', rol: 'utilizator' })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('parola')
  })

  it('nu permite administratorului să își schimbe propriul rol', async () => {
    const eu = await autentificaCa(ADMIN)
    const eroare = await api.utilizatori.update(eu.id, { rol: 'utilizator' }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('rol')
  })

  it('nu permite administratorului să își dezactiveze propriul cont', async () => {
    const eu = await autentificaCa(ADMIN)
    const eroare = await api.utilizatori.update(eu.id, { activ: false }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('activ')
  })

  it('păstrează cel puțin un administrator activ', async () => {
    const eu = await autentificaCa(ADMIN)
    const altAdmin = await api.utilizatori.create({
      nume: 'Al doilea administrator',
      email: 'admin2@clinica.ro',
      parola: 'parolabuna',
      rol: 'administrator',
    })

    // Cu doi administratori, retrogradarea celuilalt este permisă…
    await expect(
      api.utilizatori.update(altAdmin.id, { rol: 'utilizator' }),
    ).resolves.toBeTruthy()

    // …iar acum eu sunt singurul rămas, deci propriul rol rămâne blocat.
    const eroare = await api.utilizatori.update(eu.id, { rol: 'utilizator' }).catch((e) => e)
    expect(esteEroareApi(eroare)).toBe(true)
  })

  it('revocă toate sesiunile la resetarea parolei', async () => {
    const tinta = gaseste(magazin.utilizator, (u) => u.email === OPERATOR, 'contul operatorului')

    // Operatorul se conectează, apoi administratorul îi resetează parola.
    await autentificaCa(OPERATOR)
    const sesiuniInainte = [...magazin.sesiune.values()].filter(
      (s) => s.utilizator_id === tinta.id && s.revocata_la === null,
    )
    expect(sesiuniInainte.length).toBeGreaterThan(0)

    await autentificaCa(ADMIN)
    await api.utilizatori.reseteazaParola(tinta.id, 'parolanoua')

    const active = [...magazin.sesiune.values()].filter(
      (s) => s.utilizator_id === tinta.id && s.revocata_la === null,
    )
    expect(active).toHaveLength(0)
  })

  it('închide accesul unei sesiuni al cărei cont a fost dezactivat', async () => {
    const tinta = gaseste(magazin.utilizator, (u) => u.email === OPERATOR, 'contul operatorului')
    await autentificaCa(OPERATOR)
    const tokenuriOperator = { ...(await api.auth.utilizatorCurent()) }
    expect(tokenuriOperator).toBeTruthy()

    // Sesiunea operatorului rămâne salvată local, dar contul se dezactivează.
    const sesiuneOperator = [...magazin.sesiune.values()].find(
      (s) => s.utilizator_id === tinta.id && s.revocata_la === null,
    )
    expect(sesiuneOperator).toBeTruthy()

    await autentificaCa(ADMIN)
    await api.utilizatori.update(tinta.id, { activ: false })

    const dupa = [...magazin.sesiune.values()].filter(
      (s) => s.utilizator_id === tinta.id && s.revocata_la === null,
    )
    expect(dupa).toHaveLength(0)
  })
})

describe('jurnal_operatiuni', () => {
  beforeEach(async () => {
    await autentificaCa(ADMIN)
  })

  it('consemnează crearea, cu autorul operațiunii', async () => {
    const inainte = magazin.jurnal_operatiuni.length
    const client = await api.clienti.create({ nume: 'Consemnat' })

    const adaugate = magazin.jurnal_operatiuni.slice(inainte)
    const intrare = adaugate.find((j) => j.entitate === 'client' && j.entitate_id === client.id)
    expect(intrare?.actiune).toBe('creare')
    expect(intrare?.utilizator_id).toBeTruthy()
  })

  it('reține doar câmpurile modificate', async () => {
    const client = await api.clienti.create({ nume: 'Inițial', telefon: '0700 000 000' })
    const inainte = magazin.jurnal_operatiuni.length
    await api.clienti.update(client.id, { nume: 'Modificat' })

    const intrare = magazin.jurnal_operatiuni.slice(inainte).find((j) => j.actiune === 'modificare')
    expect(Object.keys(intrare?.date_noi ?? {})).toEqual(['nume'])
    expect(intrare?.date_vechi).toMatchObject({ nume: 'Inițial' })
  })

  it('nu consemnează nimic când salvarea nu schimbă nimic', async () => {
    const client = await api.clienti.create({ nume: 'Neschimbat' })
    const inainte = magazin.jurnal_operatiuni.length
    await api.clienti.update(client.id, { nume: 'Neschimbat' })
    expect(magazin.jurnal_operatiuni.length).toBe(inainte)
  })

  it('nu scrie niciodată parola în jurnal', async () => {
    await api.utilizatori.create({
      nume: 'Cont nou',
      email: 'nou@clinica.ro',
      parola: 'parolasecreta',
      rol: 'utilizator',
    })
    const serializat = JSON.stringify(magazin.jurnal_operatiuni)
    expect(serializat).not.toContain('parolasecreta')
  })
})
