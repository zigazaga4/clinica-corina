import { beforeEach, describe, expect, it } from 'vitest'
import { creeazaApiInMemorie } from './client'
import { magazin } from './store'
import { PAROLA_DEMO } from './seed'
import { scrieTokenuri, stergeTokenuri } from '@/api/session'
import { campVinovat, esteEroareApi } from '@/api/errors'
import type { Articol, Uuid } from '@/domain/types'

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

describe('programări suprapuse (permise din 2026-10-01)', () => {
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

  it('acceptă două programări suprapuse pentru aceeași persoană', async () => {
    // Cerința clinicii: o clientă cu vopseaua la uscat, alta pe scaun.
    await api.programari.create({ ...context, ...interval(10, 11) })
    await expect(
      api.programari.create({ ...context, ...interval(10, 12) }),
    ).resolves.toBeTruthy()
  })

  it('reactivarea unei programări anulate nu mai e blocată de locul ocupat', async () => {
    const prima = await api.programari.create({ ...context, ...interval(9, 10) })
    await api.programari.schimbaStarea(prima.id, 'anulat')
    await api.programari.create({ ...context, ...interval(9, 10) })
    await expect(
      api.programari.schimbaStarea(prima.id, 'programat'),
    ).resolves.toBeTruthy()
  })

  it('reprogramarea peste propria variantă veche merge', async () => {
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

describe('notițe în calendar (tabela notita)', () => {
  let eu: Uuid
  let alta: Uuid

  beforeEach(async () => {
    eu = (await autentificaCa(ADMIN)).id
    alta = gaseste(magazin.utilizator, (u) => u.activ && u.id !== eu, 'un al doilea cont activ').id
  })

  /** Un interval departe de datele demo, ca testele să nu se vadă între ele. */
  const interval = (oraInceput: number, oraSfarsit: number, zileInPlus = 0) => {
    const zi = new Date()
    zi.setFullYear(zi.getFullYear() + 2)
    zi.setDate(zi.getDate() + zileInPlus)
    const inceput = new Date(zi)
    inceput.setHours(oraInceput, 0, 0, 0)
    const sfarsit = new Date(zi)
    sfarsit.setHours(oraSfarsit, 0, 0, 0)
    return { incepe_la: inceput.toISOString(), se_termina_la: sfarsit.toISOString() }
  }

  it('fără persoană înseamnă toată clinica: executant NULL, nume NULL', async () => {
    const notita = await api.notite.create({ titlu: 'Vine furnizorul', ...interval(15, 16) })
    expect(notita.executant_id).toBeNull()
    expect(notita.executant_nume).toBeNull()
    expect(notita.detalii).toBeNull()
  })

  it('cu persoană, vine hidratată cu numele ei', async () => {
    const notita = await api.notite.create({
      titlu: 'Concediu',
      executant_id: alta,
      ...interval(9, 19),
    })
    expect(notita.executant_nume).toBe(magazin.utilizator.get(alta)?.nume)
  })

  it('NU blochează intervalul — o notiță stă peste o programare', async () => {
    /*
      Aici se deosebește de programare. „Pauză” peste ședința de la 10 nu e o
      greșeală, e informația pe care recepția vrea să o vadă acolo. Constrângerea
      de suprapunere nu se aplică notițelor, în niciun sens.
    */
    const client = gaseste(magazin.client, (c) => c.arhivat_la === null, 'clienți activi')
    const serviciu = gaseste(magazin.articol, (a) => a.tip === 'serviciu' && a.activ, 'servicii')
    const cand = interval(10, 11, 1)
    await api.programari.create({
      client_id: client.id,
      articol_id: serviciu.id,
      executant_id: eu,
      ...cand,
    })

    await expect(
      api.notite.create({ titlu: 'Pauză', executant_id: eu, ...cand }),
    ).resolves.toBeTruthy()
    // Și invers: programarea nu e blocată de o notiță existentă.
    await api.notite.create({ titlu: 'Curs', executant_id: eu, ...interval(14, 15, 1) })
    await expect(
      api.programari.create({
        client_id: client.id,
        articol_id: serviciu.id,
        executant_id: eu,
        ...interval(14, 15, 1),
      }),
    ).resolves.toBeTruthy()
  })

  it('filtrul pe persoană aduce ALE EI și ALE CLINICII, nu ale altcuiva', async () => {
    const cand = interval(11, 12, 2)
    const aMea = await api.notite.create({ titlu: 'A mea', executant_id: eu, ...cand })
    const aClinicii = await api.notite.create({ titlu: 'A clinicii', ...cand })
    const aAlteia = await api.notite.create({ titlu: 'A alteia', executant_id: alta, ...cand })

    const ids = (
      await api.notite.list({ de_la: cand.incepe_la, pana_la: cand.se_termina_la, executant_id: eu })
    ).map((n) => n.id)
    expect(ids).toContain(aMea.id)
    expect(ids).toContain(aClinicii.id)
    expect(ids).not.toContain(aAlteia.id)
  })

  it('intervalul se citește ca suprapunere, nu ca „începe între”', async () => {
    const notita = await api.notite.create({ titlu: 'Lungă', ...interval(8, 12, 3) })
    // Fereastra 10–11 nu conține începutul, dar notița o traversează.
    const fereastra = interval(10, 11, 3)
    const ids = (
      await api.notite.list({ de_la: fereastra.incepe_la, pana_la: fereastra.se_termina_la })
    ).map((n) => n.id)
    expect(ids).toContain(notita.id)
  })

  it('cere titlu (NOT NULL + CHECK btrim <> "")', async () => {
    const eroare = await api.notite.create({ titlu: '   ', ...interval(9, 10) }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('titlu')
  })

  it('cere ca sfârșitul să fie după început (notita_interval_ck)', async () => {
    const eroare = await api.notite.create({ titlu: 'Invers', ...interval(11, 10) }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('se_termina_la')
  })

  it('refuză un cont dezactivat ca persoană', async () => {
    const inactiv = gaseste(magazin.utilizator, (u) => !u.activ, 'un cont dezactivat')
    const eroare = await api.notite
      .create({ titlu: 'X', executant_id: inactiv.id, ...interval(9, 10) })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.camp).toBe('executant_id')
  })

  it('executant_id: null la modificare mută notița pe toată clinica', async () => {
    const notita = await api.notite.create({ titlu: 'Curs', executant_id: eu, ...interval(9, 10, 4) })
    const mutata = await api.notite.update(notita.id, { executant_id: null })
    expect(mutata.executant_id).toBeNull()
    expect(mutata.executant_nume).toBeNull()
    // Iar lipsa câmpului o lasă cum e.
    const redenumita = await api.notite.update(notita.id, { titlu: 'Curs de perfecționare' })
    expect(redenumita.executant_id).toBeNull()
    expect(redenumita.titlu).toBe('Curs de perfecționare')
  })

  it('se poate șterge, și ștergerea rămâne în jurnal', async () => {
    const notita = await api.notite.create({ titlu: 'De șters', ...interval(9, 10, 5) })
    await api.notite.remove(notita.id)

    const eroare = await api.notite.get(notita.id).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('negasit')

    const urme = magazin.jurnal_operatiuni.filter(
      (j) => j.entitate === 'notita' && j.entitate_id === notita.id,
    )
    expect(urme.map((j) => j.actiune)).toEqual(['creare', 'stergere'])
    expect(urme[1]?.date_vechi).toMatchObject({ titlu: 'De șters' })
  })

  it('operatorul obișnuit poate crea, modifica și șterge — nu e rută de administrator', async () => {
    await autentificaCa(OPERATOR)
    const notita = await api.notite.create({ titlu: 'A recepției', ...interval(9, 10, 6) })
    await expect(api.notite.update(notita.id, { titlu: 'Tot a recepției' })).resolves.toBeTruthy()
    await expect(api.notite.remove(notita.id)).resolves.toBeUndefined()
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

describe('articol_categorie_ck — listele de prețuri ale produselor', () => {
  beforeEach(async () => {
    await autentificaCa(ADMIN)
  })

  it('aceeași cremă stă pe amândouă listele, cu prețuri diferite', async () => {
    const clienti = await api.articole.create({
      tip: 'produs', denumire: 'Cremă Botox 250 ml', pret_lista: 290, categorie: 'Produse clienți',
    })
    const colaboratori = await api.articole.create({
      tip: 'produs', denumire: 'Cremă Botox 250 ml', pret_lista: 185, categorie: 'Produse colaboratori',
    })
    expect(clienti.id).not.toBe(colaboratori.id)
    expect([clienti.categorie, colaboratori.categorie]).toEqual(['Produse clienți', 'Produse colaboratori'])
  })

  it('scrisă altfel doar prin majuscule, se lipește de categoria existentă; goală = fără', async () => {
    const produs = await api.articole.create({
      tip: 'produs', denumire: 'Ser de probă', pret_lista: 100, categorie: '  produse CLIENȚI ',
    })
    expect(produs.categorie).toBe('Produse clienți')
    expect((await api.articole.update(produs.id, { categorie: '   ' })).categorie).toBeNull()
  })

  it('refuză categoria pe un serviciu, și la creare, și la modificare', async () => {
    const laCreare = await api.articole
      .create({ tip: 'serviciu', denumire: 'Masaj', pret_lista: 100, durata_minute: 30, categorie: 'X' })
      .catch((e) => e)
    expect(esteEroareApi(laCreare) && laCreare.camp).toBe('categorie')

    const serviciu = await api.articole.create({
      tip: 'serviciu', denumire: 'Masaj', pret_lista: 100, durata_minute: 30,
    })
    const laModificare = await api.articole.update(serviciu.id, { categorie: 'X' }).catch((e) => e)
    expect(esteEroareApi(laModificare) && laModificare.camp).toBe('categorie')
  })

  it('produsul devenit serviciu își pierde categoria', async () => {
    const produs = await api.articole.create({
      tip: 'produs', denumire: 'Temporar', pret_lista: 50, categorie: 'Produse clienți',
    })
    const dupa = await api.articole.update(produs.id, { tip: 'serviciu', durata_minute: 30 })
    expect(dupa.categorie).toBeNull()
  })
})

describe('DELETE /articole — doar nefolosit, ca ON DELETE RESTRICT', () => {
  beforeEach(async () => {
    await autentificaCa(ADMIN)
  })

  it('șterge un produs nefolosit și lasă urma în jurnal', async () => {
    const produs = await api.articole.create({ tip: 'produs', denumire: 'Creat din greșeală', pret_lista: 1 })
    await api.articole.remove(produs.id)

    expect(magazin.articol.has(produs.id)).toBe(false)
    const urma = magazin.jurnal_operatiuni.find(
      (j) => j.entitate === 'articol' && j.entitate_id === produs.id && j.actiune === 'stergere',
    )
    expect(urma?.date_vechi).toMatchObject({ denumire: 'Creat din greșeală' })
  })

  it('refuză produsul aflat pe un bon (409) și îndeamnă la dezactivare', async () => {
    const produs = await api.articole.create({ tip: 'produs', denumire: 'Vândut o dată', pret_lista: 40 })
    const client = gaseste(magazin.client, () => true, 'un client')
    await api.vanzari.create({
      client_id: client.id,
      efectuat_la: new Date().toISOString(),
      metoda_plata: 'numerar',
      linii: [{ articol_id: produs.id, cantitate: 1 }],
    })

    const eroare = await api.articole.remove(produs.id).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
    expect(eroare.message).toMatch(/pe 1 bon .*Dezactivează-l/)
    expect(magazin.articol.has(produs.id)).toBe(true)
  })

  it('refuză serviciul aflat în programări', async () => {
    const programare = gaseste(magazin.programare, () => true, 'o programare')
    const eroare = await api.articole.remove(programare.articol_id).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
    expect(eroare.message).toMatch(/^Serviciul apare .*în \d+ programări?/)
  })

  it('recepția nu poate șterge', async () => {
    const produs = await api.articole.create({ tip: 'produs', denumire: 'De păstrat', pret_lista: 1 })
    await autentificaCa(OPERATOR)
    const eroare = await api.articole.remove(produs.id).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('interzis')
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

  /*
    Vânzarea neachitată (vanzare.achitat_la NULL) — cremele date acum, banii
    mai târziu. Aceleași reguli ca pe server; `backend/src/test-api.ts` le
    verifică acolo.
  */
  describe('achitat / neachitat', () => {
    const produs = () => gaseste(magazin.articol, (a) => a.activ && a.tip === 'produs', 'produse active')
    // `de_incasat` stă pe rândul din lista de clienți, nu pe clientul simplu.
    const deIncasat = async (): Promise<number> => {
      const lista = await api.clienti.list({ pe_pagina: 500 })
      return lista.randuri.find((c) => c.id === baza.client_id)?.de_incasat ?? Number.NaN
    }

    it('fără alegere, vânzarea e achitată în momentul ei', async () => {
      const vanzare = await api.vanzari.create({
        ...baza,
        linii: [{ articol_id: produs().id, cantitate: 1 }],
      })
      expect(vanzare.achitat).toBe(true)
      expect(vanzare.achitat_la).toBe(baza.efectuat_la)
    })

    it('neachitată intră în de_incasat al clientului, achitată iese', async () => {
      const inainte = await deIncasat()
      const vanzare = await api.vanzari.create({
        ...baza,
        achitat: false,
        linii: [{ articol_id: produs().id, cantitate: 2, pret_unitar: 75.5 }],
      })
      expect(vanzare.achitat).toBe(false)
      expect(vanzare.achitat_la).toBeNull()
      expect(await deIncasat()).toBeCloseTo(inainte + 151, 2)

      const achitata = await api.vanzari.update(vanzare.id, { achitat: true })
      expect(achitata.achitat).toBe(true)
      expect(achitata.achitat_la).not.toBeNull()
      expect(await deIncasat()).toBeCloseTo(inainte, 2)

      // A doua bifă nu mută data plății; debifarea readuce datoria.
      const iar = await api.vanzari.update(vanzare.id, { achitat: true })
      expect(iar.achitat_la).toBe(achitata.achitat_la)
      await api.vanzari.update(vanzare.id, { achitat: false })
      expect(await deIncasat()).toBeCloseTo(inainte + 151, 2)
    })

    it('filtrează lista pe achitat', async () => {
      const vanzare = await api.vanzari.create({
        ...baza,
        achitat: false,
        linii: [{ articol_id: produs().id, cantitate: 1 }],
      })
      // Lista întreagă a încasărilor cere statisticile deblocate.
      await api.statistici.seteazaParola({ parola_noua: 'statistici-test' })
      const neachitate = await api.vanzari.list({ achitat: false, pe_pagina: 500 })
      expect(neachitate.randuri.some((v) => v.id === vanzare.id)).toBe(true)
      expect(neachitate.randuri.every((v) => !v.achitat)).toBe(true)
      const achitate = await api.vanzari.list({ achitat: true, pe_pagina: 500 })
      expect(achitate.randuri.some((v) => v.id === vanzare.id)).toBe(false)
    })

    it('refuză să lase neachitată o încasare de ședințe', async () => {
      const linie = gaseste(magazin.vanzare_linie, (l) => l.programare_id !== null, 'ședințe încasate')
      const eroare = await api.vanzari.update(linie.vanzare_id, { achitat: false }).catch((e) => e)
      expect(esteEroareApi(eroare) && eroare.camp).toBe('achitat')
      expect((await api.vanzari.get(linie.vanzare_id)).achitat).toBe(true)
    })

    it('mută plata pe loc odată cu data vânzării', async () => {
      const vanzare = await api.vanzari.create({
        ...baza,
        linii: [{ articol_id: produs().id, cantitate: 1 }],
      })
      const ieri = new Date(Date.parse(baza.efectuat_la) - 86_400_000).toISOString()
      const mutata = await api.vanzari.update(vanzare.id, { efectuat_la: ieri })
      expect(mutata.achitat_la).toBe(ieri)
    })
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
    const dupa = await api.programari.schimbaStarea(programare.id, 'onorat', { achitat: true })

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
    const dupa = await api.programari.schimbaStarea(programare.id, 'anulat', { achitat: true })
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
    await api.programari.schimbaStarea(programare.id, 'onorat', { achitat: true })

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
    await api.programari.schimbaStarea(programare.id, 'onorat', { achitat: true })

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
    await api.programari.schimbaStarea(platita.id, 'onorat', { achitat: true })

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

describe('tratamente — servicii în mai multe ședințe (tabela tratament)', () => {
  let client_id: Uuid
  let executant_id: Uuid
  /** Serviciu propriu testului: 3 ședințe, 300 lei în total. */
  let cura_id: Uuid

  beforeEach(async () => {
    const utilizator = await autentificaCa(ADMIN)
    executant_id = utilizator.id
    client_id = (await api.clienti.create({ nume: 'Client Tratament' })).id
    cura_id = (
      await api.articole.create({
        tip: 'serviciu',
        denumire: 'Cură test',
        durata_minute: 30,
        pret_lista: 300,
        numar_sedinte: 3,
      })
    ).id
  })

  /** Un interval liber, în viitor, la o zi distanță de celelalte ale testului. */
  const cand = (ziua: number, ora = 9) => {
    const zi = new Date()
    zi.setFullYear(zi.getFullYear() + 2)
    zi.setDate(zi.getDate() + ziua)
    const inceput = new Date(zi)
    inceput.setHours(ora, 0, 0, 0)
    const sfarsit = new Date(inceput.getTime() + 30 * 60_000)
    return { incepe_la: inceput.toISOString(), se_termina_la: sfarsit.toISOString() }
  }
  const sedinta = (ziua: number) => ({ client_id, articol_id: cura_id, executant_id, ...cand(ziua) })

  it('articol_sedinte_ck: un produs nu se face în ședințe', async () => {
    const eroare = await api.articole
      .create({ tip: 'produs', denumire: 'Cremă în rate', pret_lista: 10, numar_sedinte: 4 })
      .catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('validare')
  })

  it('reducere: abonamentul deschis din programare ține minte lista și totalul de plată', async () => {
    // Cerința clinicii (8 oct. 2026): 50% la abonament — 150 de plată din 300.
    const p = await api.programari.create({
      ...cand(0),
      client_id,
      executant_id,
      servicii: [{ articol_id: cura_id, tratament_pret_total: 150 }],
    })
    const t = await api.tratamente.get(p.tratament_id!)
    expect(t).toMatchObject({ pret_lista: 300, pret_total: 150, pret_urmatoarea: 50 })
    // Fără preț trimis, ședința își ia partea din totalul de după reducere.
    expect(p.pret).toBe(50)
  })

  it('reducere pusă după programare: ședințele programate primesc noua parte, cele făcute nu', async () => {
    const prima = await api.programari.create(sedinta(0))
    const aDoua = await api.programari.create(sedinta(1))
    expect([prima.pret, aDoua.pret]).toEqual([100, 100])
    await api.programari.schimbaStarea(prima.id, 'onorat')

    // 50%: 150 în total; prima, făcută, rămâne 100; restul de 50 pe 2 locuri.
    const t = await api.tratamente.update(prima.tratament_id!, { pret_total: 150, pret_lista: 300 })
    expect(magazin.programare.get(prima.id)?.pret).toBe(100)
    expect(magazin.programare.get(aDoua.id)?.pret).toBe(25)
    expect(t).toMatchObject({ pret_lista: 300, alocat: 125, pret_urmatoarea: 25 })
    const urma = magazin.jurnal_operatiuni.find(
      (j) => j.entitate === 'programare' && j.entitate_id === aDoua.id && j.date_noi?.['pret'] === 25,
    )
    expect(urma?.date_vechi).toMatchObject({ pret: 100 })
  })

  describe('avans — încasare pe abonament înainte de ședințe (3 nov. 2026)', () => {
    /** Abonamentul deschis, fără nicio ședință încă. */
    const deschis = async () => (await api.tratamente.create({ client_id, articol_id: cura_id })).id
    // `de_incasat` stă pe rândul din lista de clienți, nu pe clientul simplu.
    const deIncasat = async () => {
      const lista = await api.clienti.list({ q: 'Client Tratament', pe_pagina: 50 })
      return lista.randuri.find((c) => c.id === client_id)?.de_incasat ?? Number.NaN
    }

    it('încasează 300 pe abonament fără nicio ședință: avans 300, nimic consumat, nimic de plată', async () => {
      const id = await deschis()
      const t = await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      expect(t).toMatchObject({ avans: 300, incasat: 0, de_incasat: 0, sedinte_onorate: 0 })
      // Avansul nu e datorie, și nici o ședință ținută pe loc.
      expect(await deIncasat()).toBe(0)
    })

    it('cere metoda de plată, o sumă pozitivă și nu trece peste prețul abonamentului', async () => {
      const id = await deschis()
      const camp = async (date: Parameters<typeof api.tratamente.incaseaza>[1]) =>
        campVinovat(await api.tratamente.incaseaza(id, date).catch((e) => e))
      expect(await camp({ suma: 100 } as never)).toBe('metoda_plata')
      expect(await camp({ suma: 0, metoda_plata: 'card' })).toBe('suma')
      expect(await camp({ suma: -5, metoda_plata: 'card' })).toBe('suma')
      expect(await camp({ suma: 300.01, metoda_plata: 'card' })).toBe('suma')
      await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'numerar' })
      expect(await camp({ suma: 1, metoda_plata: 'numerar' })).toBe('suma')
    })

    it('ședința onorată se plătește din avans, în același bon: 100 încasați, 200 rămân avans', async () => {
      const id = await deschis()
      await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      const p = await api.programari.create(sedinta(0))
      expect(p).toMatchObject({ tratament_avans: 300, achitat: false })

      const onorata = await api.programari.schimbaStarea(p.id, 'onorat')
      expect(onorata).toMatchObject({ achitat: true, achitat_din_avans: true, tratament_avans: 200 })
      expect(await api.tratamente.get(id)).toMatchObject({ incasat: 100, avans: 200, de_incasat: 0 })

      const bon = await api.vanzari.get(onorata.vanzare_id!)
      expect(bon).toMatchObject({ total: 300, metoda_plata: 'card', achitat: true })
      expect(bon.linii).toHaveLength(2)
      expect(bon.linii.find((l) => l.programare_id === p.id)).toMatchObject({ total_linie: 100, tratament_id: id })
      expect(bon.linii.find((l) => l.programare_id === null)).toMatchObject({ total_linie: 200, tratament_id: id })
    })

    it('„Achitat acum” pe o ședință acoperită de avans nu scrie al doilea bon', async () => {
      const id = await deschis()
      await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      const bonuriInainte = magazin.vanzare.size
      const p = await api.programari.create(sedinta(0))
      await api.programari.schimbaStarea(p.id, 'onorat', { achitat: true, metoda_plata: 'numerar' })
      expect(magazin.vanzare.size).toBe(bonuriInainte)
    })

    it('scoasă din „onorat”, ședința își dă banii înapoi abonamentului — și poate fi anulată', async () => {
      const id = await deschis()
      await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      const p = await api.programari.create(sedinta(0))
      await api.programari.schimbaStarea(p.id, 'onorat')

      const neprezentata = await api.programari.schimbaStarea(p.id, 'neprezentat')
      expect(neprezentata).toMatchObject({ achitat: false, tratament_avans: 300 })
      expect(await api.tratamente.get(id)).toMatchObject({ avans: 300, incasat: 0 })

      await api.programari.schimbaStarea(p.id, 'onorat')
      // Plătită direct, anularea ar fi refuzat-o; din avans, banii doar se întorc.
      const anulata = await api.programari.schimbaStarea(p.id, 'anulat')
      expect(anulata.stare).toBe('anulat')
      expect((await api.tratamente.get(id)).avans).toBe(300)
    })

    it('un avans care nu acoperă ședința rămâne avans; ședința se încasează ca de obicei', async () => {
      const id = await deschis()
      await api.tratamente.incaseaza(id, { suma: 150, metoda_plata: 'numerar' })
      const prima = await api.programari.create(sedinta(0))
      const aDoua = await api.programari.create(sedinta(1))
      expect((await api.programari.schimbaStarea(prima.id, 'onorat')).achitat).toBe(true)
      const nestinsa = await api.programari.schimbaStarea(aDoua.id, 'onorat')
      expect(nestinsa).toMatchObject({ achitat: false, tratament_avans: 50 })
      expect(await deIncasat()).toBe(100)
    })

    it('avansul luat după ședința onorată o stinge pe loc', async () => {
      const id = await deschis()
      const p = await api.programari.create(sedinta(0))
      await api.programari.schimbaStarea(p.id, 'onorat')
      expect((await api.programari.get(p.id)).achitat).toBe(false)

      const t = await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      expect(t).toMatchObject({ incasat: 100, avans: 200, de_incasat: 0 })
      expect((await api.programari.get(p.id)).achitat_din_avans).toBe(true)
    })

    it('bonul corectat păstrează legătura cu abonamentul; pe alt client, refuzat', async () => {
      const id = await deschis()
      const t = await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      const p = await api.programari.create(sedinta(0))
      const onorata = await api.programari.schimbaStarea(p.id, 'onorat')
      const bon = await api.vanzari.get(onorata.vanzare_id!)
      const linii = bon.linii.map((l) => ({
        articol_id: l.articol_id,
        cantitate: l.cantitate,
        pret_unitar: l.pret_unitar,
        programare_id: l.programare_id,
        tratament_id: l.tratament_id,
      }))
      await api.vanzari.update(bon.id, { linii })
      expect((await api.tratamente.get(t.id)).avans).toBe(200)

      const altul = (await api.clienti.create({ nume: 'Alt Client' })).id
      const cuAltClient = await api.vanzari.update(bon.id, { client_id: altul, linii }).catch((e) => e)
      expect(campVinovat(cuAltClient)).toBe('linii')
      // Un bon de abonament nu poate deveni datorie.
      const datorie = await api.vanzari.update(bon.id, { achitat: false }).catch((e) => e)
      expect(campVinovat(datorie)).toBe('achitat')
    })

    it('ștergerea abonamentului scoate și avansul: niciun bon rămas', async () => {
      await autentificaCa(ADMIN)
      const id = await deschis()
      const bonuriInainte = magazin.vanzare.size
      await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      expect(magazin.vanzare.size).toBe(bonuriInainte + 1)
      await api.tratamente.remove(id)
      expect(magazin.vanzare.size).toBe(bonuriInainte)
    })

    it('avansul nu e al nimănui: filtrul „Făcută de” îl lasă deoparte, ședința consumată e a executantului', async () => {
      const id = await deschis()
      await api.tratamente.incaseaza(id, { suma: 300, metoda_plata: 'card' })
      // Lista întreagă a încasărilor cere statisticile deblocate.
      await api.statistici.seteazaParola({ parola_noua: 'statistici-test' })
      const filtru = { client_id, persoana_id: executant_id, pe_pagina: 50 }
      expect((await api.vanzari.list(filtru)).randuri).toHaveLength(0)

      const p = await api.programari.create(sedinta(0))
      await api.programari.schimbaStarea(p.id, 'onorat')
      expect((await api.vanzari.list(filtru)).randuri).toHaveLength(1)
    })
  })

  it('propune a treia parte din preț și anunță că ședința ar deschide un tratament', async () => {
    const sugestie = await api.programari.pretSugerat(client_id, cura_id)
    expect(sugestie.pret).toBe(100)
    expect(sugestie.tratament).toMatchObject({ id: null, numar_sedinte: 3, sedinta_nr: 1, pret_total: 300 })
  })

  it('prima ședință deschide tratamentul singură și e „ședința 1 din 3”', async () => {
    const inainte = magazin.tratament.size
    const p = await api.programari.create(sedinta(0))
    expect(magazin.tratament.size).toBe(inainte + 1)
    expect(p.tratament_id).not.toBeNull()
    expect(p.sedinta_nr).toBe(1)
    expect(p.tratament_numar_sedinte).toBe(3)
    expect(p.pret).toBe(100)

    const t = await api.tratamente.get(p.tratament_id!)
    expect(t).toMatchObject({
      client_id, articol_id: cura_id, numar_sedinte: 3, pret_total: 300, incheiat_la: null,
      sedinte_programate: 1, sedinte_onorate: 0, sedinte_ramase: 2, alocat: 100, incasat: 0, pret_urmatoarea: 100,
    })
  })

  it('suma corectată la închidere reface partea ședințelor următoare', async () => {
    const p1 = await api.programari.create(sedinta(0))
    // S-a luat 130 în loc de 100: (300 - 130) / 2 = 85 pentru fiecare dintre următoarele.
    const onorata = await api.programari.schimbaStarea(p1.id, 'onorat', { achitat: true, pret: 130 })
    expect(onorata.pret).toBe(130)
    expect(onorata.achitat).toBe(true)

    const t = await api.tratamente.get(p1.tratament_id!)
    expect(t.incasat).toBe(130)
    expect(t.pret_urmatoarea).toBe(85)

    const sugestie = await api.programari.pretSugerat(client_id, cura_id)
    expect(sugestie.pret).toBe(85)
    expect(sugestie.tratament?.id).toBe(p1.tratament_id)
    expect(sugestie.tratament?.sedinta_nr).toBe(2)

    const p2 = await api.programari.create(sedinta(1))
    expect(p2.tratament_id).toBe(p1.tratament_id)
    expect(p2.pret).toBe(85)
    expect(p2.sedinta_nr).toBe(2)
  })

  it('nu schimbă prețul unei ședințe deja încasate, nici de la închidere', async () => {
    const p = await api.programari.create(sedinta(0))
    await api.programari.schimbaStarea(p.id, 'onorat', { achitat: true })
    const eroare = await api.programari.schimbaStarea(p.id, 'onorat', { pret: 50 }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('validare')
  })

  it('refuză o ședință peste numărul convenit — a patra într-un tratament de trei', async () => {
    await api.programari.create(sedinta(0))
    await api.programari.create(sedinta(1))
    await api.programari.create(sedinta(2))
    const eroare = await api.programari.create(sedinta(3)).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
  })

  it('o ședință anulată nu ocupă un loc și nu are număr', async () => {
    const p1 = await api.programari.create(sedinta(0))
    await api.programari.create(sedinta(1))
    const p3 = await api.programari.create(sedinta(2))
    const anulata = await api.programari.schimbaStarea(p3.id, 'anulat')
    expect(anulata.sedinta_nr).toBeNull()

    const t = await api.tratamente.get(p1.tratament_id!)
    expect(t.sedinte_ramase).toBe(1)
    // Locul eliberat se poate programa din nou.
    const p4 = await api.programari.create(sedinta(3))
    expect(p4.sedinta_nr).toBe(3)
  })

  it('ședința unui tratament nu se mută pe alt client sau alt serviciu', async () => {
    const p = await api.programari.create(sedinta(0))
    const altul = await api.clienti.create({ nume: 'Altcineva' })
    const eroare = await api.programari.update(p.id, { client_id: altul.id }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('validare')
    // Reprogramarea (ora) rămâne permisă.
    const mutata = await api.programari.update(p.id, cand(5))
    expect(mutata.tratament_id).toBe(p.tratament_id)
  })

  it('ultima ședință onorată încheie tratamentul singură', async () => {
    const p1 = await api.programari.create(sedinta(0))
    const p2 = await api.programari.create(sedinta(1))
    const p3 = await api.programari.create(sedinta(2))
    for (const p of [p1, p2]) await api.programari.schimbaStarea(p.id, 'onorat')
    expect((await api.tratamente.get(p1.tratament_id!)).incheiat_la).toBeNull()

    await api.programari.schimbaStarea(p3.id, 'onorat', { achitat: true })
    const t = await api.tratamente.get(p1.tratament_id!)
    expect(t.incheiat_la).not.toBeNull()
    expect(t.sedinte_onorate).toBe(3)
    expect(t.de_incasat).toBe(200)
    expect(t.incasat).toBe(100)
  })

  it('după încheiere, o ședință nouă deschide alt tratament', async () => {
    const p1 = await api.programari.create(sedinta(0))
    await api.tratamente.incheie(p1.tratament_id!)
    const p2 = await api.programari.create(sedinta(1))
    expect(p2.tratament_id).not.toBe(p1.tratament_id)
    expect(p2.sedinta_nr).toBe(1)

    // Cel vechi nu se mai poate redeschide cât timp există altul în curs.
    const eroare = await api.tratamente.redeschide(p1.tratament_id!).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
  })

  it('ține minte prețul total convenit — la același număr de ședințe', async () => {
    const p1 = await api.programari.create(sedinta(0))
    await api.tratamente.update(p1.tratament_id!, { pret_total: 270 })
    await api.tratamente.incheie(p1.tratament_id!)

    const sugestie = await api.programari.pretSugerat(client_id, cura_id)
    expect(sugestie.pret).toBe(90)
    expect(sugestie.din_istoric).toBe(true)
    expect(sugestie.tratament?.pret_total).toBe(270)
  })

  it('nu coboară numărul de ședințe sub cele deja programate sau făcute', async () => {
    const p1 = await api.programari.create(sedinta(0))
    await api.programari.create(sedinta(1))
    const eroare = await api.tratamente.update(p1.tratament_id!, { numar_sedinte: 1 }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('validare')

    const marit = await api.tratamente.update(p1.tratament_id!, { numar_sedinte: 4, pret_total: 400 })
    expect(marit.sedinte_ramase).toBe(2)
    // (400 - 200) / 2
    expect(marit.pret_urmatoarea).toBe(100)
  })

  it('un client are cel mult un tratament în curs la același serviciu', async () => {
    await api.tratamente.create({ client_id, articol_id: cura_id })
    const eroare = await api.tratamente.create({ client_id, articol_id: cura_id }).catch((e) => e)
    expect(esteEroareApi(eroare) && eroare.cod).toBe('conflict')
  })

  it('un tratament deschis de mână prinde și ședințele unui serviciu dintr-o venire', async () => {
    const simplu = gaseste(magazin.articol, (a) => a.tip === 'serviciu' && a.numar_sedinte === 1, 'servicii simple')
    const t = await api.tratamente.create({ client_id, articol_id: simplu.id, numar_sedinte: 2, pret_total: 100 })
    const p = await api.programari.create({ client_id, articol_id: simplu.id, executant_id, ...cand(0) })
    expect(p.tratament_id).toBe(t.id)
    expect(p.pret).toBe(50)
  })

  it('lista: în curs întâi, cele fără ședință programată primele; filtrul pe client', async () => {
    const p = await api.programari.create(sedinta(0))
    const deschis = await api.tratamente.create({
      client_id, articol_id: gaseste(magazin.articol, (a) => a.tip === 'serviciu' && a.numar_sedinte === 1 && a.activ, 'servicii simple').id,
      numar_sedinte: 2,
    })
    const lista = await api.tratamente.list({ client_id, in_curs: true })
    expect(lista.total).toBe(2)
    expect(lista.randuri[0]?.id).toBe(deschis.id)
    expect(lista.randuri[1]?.id).toBe(p.tratament_id)

    const sedintele = await api.programari.list({ tratament_id: p.tratament_id! })
    expect(sedintele.map((s) => s.id)).toEqual([p.id])
  })

  it('datele demo conțin tratamente în curs, cu ședințe numărate din programări', async () => {
    const lista = await api.tratamente.list({ in_curs: true })
    expect(lista.total).toBeGreaterThan(0)
    for (const t of lista.randuri) {
      const contate = [...magazin.programare.values()].filter(
        (p) => p.tratament_id === t.id && (p.stare === 'programat' || p.stare === 'onorat'),
      ).length
      expect(t.sedinte_programate + t.sedinte_onorate).toBe(contate)
      expect(contate).toBeLessThanOrEqual(t.numar_sedinte)
    }
  })
})

/*
  O programare, mai multe servicii: o manichiură și ședința 3 din 6 de IPL la
  aceeași venire. Fiecare serviciu e un rând `programare`, cu același
  `vizita_id` — aceleași reguli ca `routes/programari.ts` de pe server.
*/
describe('mai multe servicii într-o programare (programare.vizita_id)', () => {
  let context: { client_id: Uuid; executant_id: Uuid }
  let simple: Articol[]
  let cura: Articol

  beforeEach(async () => {
    const utilizator = await autentificaCa(ADMIN)
    // Fișă proaspătă: prețurile pornesc de la listă, tratamentele de la zero.
    const client = await api.clienti.create({ nume: 'Client Cu Mai Multe Servicii' })
    context = { client_id: client.id, executant_id: utilizator.id }
    simple = [...magazin.articol.values()].filter(
      (a) => a.tip === 'serviciu' && a.activ && a.numar_sedinte === 1,
    )
    cura = gaseste(
      magazin.articol,
      (a) => a.tip === 'serviciu' && a.activ && a.numar_sedinte > 1,
      'servicii în mai multe ședințe',
    )
  })

  /** Un interval liber, peste doi ani — departe de celelalte teste. */
  const interval = (oraInceput: number, oraSfarsit: number) => {
    const zi = new Date()
    zi.setFullYear(zi.getFullYear() + 2)
    const inceput = new Date(zi)
    inceput.setHours(oraInceput, 0, 0, 0)
    const sfarsit = new Date(zi)
    sfarsit.setHours(oraSfarsit, 0, 0, 0)
    return { incepe_la: inceput.toISOString(), se_termina_la: sfarsit.toISOString() }
  }

  const serviciile = (vizita_id: Uuid) => api.programari.list({ vizita_id })

  it('le scrie pe toate, în aceeași programare, în ordinea trimisă', async () => {
    const [a, b] = simple as [Articol, Articol]
    const prima = await api.programari.create({
      ...context,
      ...interval(10, 12),
      servicii: [{ articol_id: a.id, pret: 50 }, { articol_id: cura.id }, { articol_id: b.id }],
    })
    expect(prima.articol_id).toBe(a.id)

    const toate = await serviciile(prima.vizita_id)
    expect(toate.map((s) => s.articol_id)).toEqual([a.id, cura.id, b.id])
    expect(new Set(toate.map((s) => `${s.incepe_la}|${s.executant_id}|${s.client_id}`)).size).toBe(1)
    expect(toate[0]!.pret).toBe(50)
    // Ședința de cură își deschide tratamentul și ia partea ei.
    expect(toate[1]!.tratament_id).not.toBeNull()
    expect(toate[1]!.sedinta_nr).toBe(1)
    expect(toate[2]!.pret).toBe(b.pret_lista)
  })

  it('serviciile ei nu se ciocnesc între ele, nici cu o altă programare', async () => {
    const [a, b] = simple as [Articol, Articol]
    await api.programari.create({
      ...context, ...interval(10, 11), servicii: [{ articol_id: a.id }, { articol_id: b.id }],
    })
    await expect(
      api.programari.create({ ...context, articol_id: a.id, ...interval(10, 11) }),
    ).resolves.toBeTruthy()
  })

  it('două ședințe din același tratament se numără pe rând: 1 și 2', async () => {
    const prima = await api.programari.create({
      ...context, ...interval(10, 11), servicii: [{ articol_id: cura.id }, { articol_id: cura.id }],
    })
    const toate = await serviciile(prima.vizita_id)
    expect(toate.map((s) => s.sedinta_nr).sort()).toEqual([1, 2])
    expect(toate[0]!.tratament_id).toBe(toate[1]!.tratament_id)
  })

  it('un serviciu greșit își spune locul, iar nimic nu rămâne scris pe jumătate', async () => {
    const produs = gaseste(magazin.articol, (a) => a.tip === 'produs', 'produse')
    const programari = magazin.programare.size
    const tratamente = magazin.tratament.size

    const cuProdus = await api.programari
      .create({
        ...context, ...interval(10, 11),
        servicii: [{ articol_id: cura.id }, { articol_id: produs.id }],
      })
      .catch((e) => e)
    expect(campVinovat(cuProdus)).toBe('servicii.1.articol_id')

    // Tratamentul plin abia la ultimul serviciu: primele ședințe se scriseseră
    // deja, iar tratamentul se deschisese. Ca pe server, nu rămâne nimic.
    const preaMulte = await api.programari
      .create({
        ...context, ...interval(10, 11),
        servicii: Array.from({ length: cura.numar_sedinte + 1 }, () => ({ articol_id: cura.id })),
      })
      .catch((e) => e)
    expect(esteEroareApi(preaMulte) && preaMulte.cod).toBe('conflict')
    expect(campVinovat(preaMulte)).toBe(`servicii.${cura.numar_sedinte}.tratament_id`)

    expect(magazin.programare.size).toBe(programari)
    expect(magazin.tratament.size).toBe(tratamente)
  })

  it('o modificare trimisă pe un singur serviciu mută toată programarea', async () => {
    const [a, b] = simple as [Articol, Articol]
    const prima = await api.programari.create({
      ...context, ...interval(10, 11), servicii: [{ articol_id: a.id }, { articol_id: b.id }],
    })
    const [, alDoilea] = await serviciile(prima.vizita_id)
    await api.programari.update(alDoilea!.id, { ...interval(14, 15), nota: 'Mutată' })

    const dupa = await serviciile(prima.vizita_id)
    expect(dupa).toHaveLength(2)
    for (const s of dupa) {
      expect(s.incepe_la).toBe(interval(14, 15).incepe_la)
      expect(s.nota).toBe('Mutată')
    }
  })

  it('lista de servicii schimbă, adaugă și scoate — cel scos rămâne în istoric, anulat', async () => {
    const [a, b, c] = simple as [Articol, Articol, Articol]
    const prima = await api.programari.create({
      ...context, ...interval(10, 11),
      servicii: [{ articol_id: a.id, pret: 40 }, { articol_id: b.id }],
    })
    const [sa, sb] = await serviciile(prima.vizita_id)

    const raspuns = await api.programari.update(sa!.id, {
      servicii: [{ id: sb!.id, articol_id: b.id, pret: 33 }, { articol_id: c.id, pret: 70 }],
    })
    // Cel cerut a fost scos: răspunde primul rămas.
    expect(raspuns.id).toBe(sb!.id)

    const dupa = await serviciile(prima.vizita_id)
    expect(dupa.map((s) => [s.articol_id, s.pret])).toEqual([[b.id, 33], [c.id, 70]])
    const scos = await api.programari.get(sa!.id)
    expect(scos.stare).toBe('anulat')
    expect(scos.vizita_id).not.toBe(prima.vizita_id)
  })

  it('onorarea le închide pe toate și le încasează pe un singur bon, cu sumele corectate', async () => {
    const [a, b] = simple as [Articol, Articol]
    const prima = await api.programari.create({
      ...context, ...interval(10, 11),
      servicii: [{ articol_id: a.id, pret: 40 }, { articol_id: b.id, pret: 60 }],
    })
    const [sa, sb] = await serviciile(prima.vizita_id)
    await api.programari.schimbaStarea(sb!.id, 'onorat', { achitat: true, preturi: { [sa!.id]: 45 } })

    const dupa = await serviciile(prima.vizita_id)
    expect(dupa.every((s) => s.stare === 'onorat' && s.achitat)).toBe(true)
    expect(new Set(dupa.map((s) => s.vanzare_id)).size).toBe(1)
    const bon = await api.vanzari.get(dupa[0]!.vanzare_id!)
    expect(bon.linii).toHaveLength(2)
    expect(bon.total).toBe(105)
  })

  it('un serviciu încasat nu se anulează și nu se scoate, dar prețul lui retrimis neschimbat trece', async () => {
    const [a, b] = simple as [Articol, Articol]
    const prima = await api.programari.create({
      ...context, ...interval(10, 11), servicii: [{ articol_id: a.id }, { articol_id: b.id }],
    })
    const [sa, sb] = await serviciile(prima.vizita_id)
    await api.programari.schimbaStarea(sa!.id, 'onorat', { achitat: true })

    const anulare = await api.programari.schimbaStarea(sa!.id, 'anulat').catch((e) => e)
    expect(esteEroareApi(anulare) && anulare.camp).toBe('stare')

    const scoatere = await api.programari
      .update(sa!.id, { servicii: [{ id: sa!.id, articol_id: a.id }] })
      .catch((e) => e)
    expect(esteEroareApi(scoatere) && scoatere.camp).toBe('servicii')

    const doarNota = await api.programari.update(sb!.id, { pret: sb!.pret, nota: 'Doar nota' })
    expect(doarNota.nota).toBe('Doar nota')
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
