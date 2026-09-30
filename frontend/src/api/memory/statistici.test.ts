import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/api'
import { campVinovat, esteStatisticiIncuiate } from '@/api/errors'
import type { Articol, RaportStatistici } from '@/domain/types'
import { laInputDate } from '@/lib/dates'
import { sumaTotal } from '@/lib/money'
import { autentifica, PAROLA_STATISTICI_TEST } from '@/test/render'
import { magazin } from './store'

/*
  Statisticile pe datele din memorie — aceleași reguli și aceleași cifre ca
  pe server (`backend/src/test-api.ts`, secțiunea „Statistici”): dacă un
  scenariu dă 300 lei acolo, trebuie să dea 300 și aici.
*/

const eroareDin = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e)

const articol = (tip: 'serviciu' | 'produs', unde: (a: Articol) => boolean = () => true): Articol => {
  const gasit = [...magazin.articol.values()].find((a) => a.tip === tip && a.activ && a.numar_sedinte === 1 && unde(a))
  if (!gasit) throw new Error(`Datele demo nu au un ${tip} potrivit.`)
  return gasit
}

describe('parola statisticilor', () => {
  beforeEach(async () => {
    await autentifica()
  })

  it('fără deblocare, raportul, cheltuielile și lista încasărilor sunt încuiate', async () => {
    const filtru = { de_la: '2026-09-01', pana_la: '2026-09-30', pas: 'zi' as const }
    for (const cerere of [api.statistici.raport(filtru), api.cheltuieli.list(), api.vanzari.list()]) {
      expect(esteStatisticiIncuiate(await eroareDin(cerere))).toBe(true)
    }
  })

  it('o alege doar un administrator, de cel puțin 8 caractere, diferită de a contului', async () => {
    expect((await api.statistici.stare()).parola_setata).toBe(false)
    expect(campVinovat(await eroareDin(api.statistici.seteazaParola({ parola_noua: 'scurta' })))).toBe('parola_noua')
    expect(campVinovat(await eroareDin(api.statistici.seteazaParola({ parola_noua: 'parola123' })))).toBe('parola_noua')

    await autentifica('andreea.popescu@clinica.ro')
    const operator = await eroareDin(api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST }))
    expect((operator as { cod?: string }).cod).toBe('interzis')

    await autentifica()
    const acces = await api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST })
    expect(new Date(acces.expira_la).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
    expect((await api.statistici.stare()).parola_setata).toBe(true)
    // Deblocat pe loc.
    await expect(api.cheltuieli.list()).resolves.toBeTruthy()
  })

  it('se deschide cu parola ei, nu cu a contului, și se schimbă doar știind-o pe cea veche', async () => {
    await api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST })
    api.statistici.blocheaza()
    expect(esteStatisticiIncuiate(await eroareDin(api.cheltuieli.list()))).toBe(true)

    await autentifica('andreea.popescu@clinica.ro')
    expect(campVinovat(await eroareDin(api.statistici.deblocheaza('parola123')))).toBe('parola')
    await api.statistici.deblocheaza(PAROLA_STATISTICI_TEST)
    await expect(api.cheltuieli.list()).resolves.toBeTruthy()

    await autentifica()
    // Deblocarea operatoarei nu deschide nimic pentru alt cont.
    expect(esteStatisticiIncuiate(await eroareDin(api.cheltuieli.list()))).toBe(true)
    expect(
      campVinovat(await eroareDin(api.statistici.seteazaParola({ parola_noua: 'alta-parola-lunga' }))),
    ).toBe('parola_curenta')
    expect(
      campVinovat(
        await eroareDin(
          api.statistici.seteazaParola({ parola_noua: 'alta-parola-lunga', parola_curenta: 'gresita' }),
        ),
      ),
    ).toBe('parola_curenta')
    await api.statistici.seteazaParola({ parola_noua: 'alta-parola-lunga', parola_curenta: PAROLA_STATISTICI_TEST })
    expect(campVinovat(await eroareDin(api.statistici.deblocheaza(PAROLA_STATISTICI_TEST)))).toBe('parola')
  })

  it('o parolă schimbată în altă parte încuie deblocarea de aici', async () => {
    await api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST })
    // Ca și cum ar fi schimbat-o altcineva, de pe alt calculator.
    magazin.parola_statistici = { ...magazin.parola_statistici!, parola_hash: 'schimbata-altundeva', actualizat_la: new Date(Date.now() + 1).toISOString() }
    const eroare = await eroareDin(api.cheltuieli.list())
    expect(esteStatisticiIncuiate(eroare)).toBe(true)
    expect((eroare as Error).message).toMatch(/s-a schimbat/)
  })

  it('delogarea uită deblocarea', async () => {
    await api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST })
    await api.auth.logout('ref.x.y')
    await autentifica()
    expect(esteStatisticiIncuiate(await eroareDin(api.cheltuieli.list()))).toBe(true)
  })
})

describe('raportul, pe o zi cunoscută', () => {
  /*
    O zi departe de datele demo, în care se știe tot ce s-a întâmplat — ca pe
    server: o ședință de 200 plătită cu două produse de 50, una de 80
    neplătită, o neprezentare, o cremă de 40 pe datorie, cheltuieli de 150.
  */
  const ZI = '2031-06-11'
  const la = (ora: number) => new Date(2031, 5, 11, ora).toISOString()

  let raport: RaportStatistici
  let clientId: string
  let executantId: string
  let serviciuId: string
  let produsId: string

  beforeEach(async () => {
    executantId = (await autentifica()).id
    await api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST })
    const serviciu = articol('serviciu')
    const produs = articol('produs')
    serviciuId = serviciu.id
    produsId = produs.id
    clientId = (await api.clienti.create({ nume: 'Clientă Statistici' })).id

    const programeaza = async (ora: number, pret: number) =>
      api.programari.create({
        client_id: clientId,
        executant_id: executantId,
        incepe_la: la(ora),
        se_termina_la: la(ora + 1),
        servicii: [{ articol_id: serviciuId, pret }],
      })
    const a = await programeaza(9, 200)
    const b = await programeaza(10, 80)
    const c = await programeaza(11, 150)
    await api.programari.schimbaStarea(a.id, 'onorat')
    await api.programari.schimbaStarea(b.id, 'onorat')
    await api.programari.schimbaStarea(c.id, 'neprezentat')
    await api.vanzari.incaseaza({
      client_id: clientId,
      programare_ids: [a.id],
      efectuat_la: la(14),
      linii: [{ articol_id: produsId, cantitate: 2, pret_unitar: 50 }],
    })
    await api.vanzari.create({
      client_id: clientId,
      efectuat_la: la(12),
      achitat: false,
      linii: [{ articol_id: produsId, cantitate: 1, pret_unitar: 40 }],
    })
    await api.cheltuieli.create({ data: ZI, categorie: 'Chirie test', suma: 120, descriere: 'Chiria lunii' })
    const mica = await api.cheltuieli.create({ data: ZI, categorie: '  chirie TEST ', suma: 30 })
    expect(mica.categorie).toBe('Chirie test')

    raport = await api.statistici.raport({
      de_la: ZI,
      pana_la: ZI,
      pas: 'zi',
      comparatie_de_la: '2031-06-10',
      comparatie_pana_la: '2031-06-10',
    })
  })

  it('banii: încasat, cheltuit, profit, rămas de încasat', () => {
    expect(raport.total).toMatchObject({
      incasat: 300,
      incasat_servicii: 200,
      incasat_produse: 100,
      incasari: 1,
      cheltuieli: 150,
      profit: 150,
      neachitat: 120,
    })
  })

  it('programările și clienții zilei; comparația cu ziua dinainte e goală', () => {
    expect(raport.total).toMatchObject({
      programari_onorate: 2,
      programari_neprezentate: 1,
      programari_anulate: 0,
      programari_programate: 0,
      clienti: 1,
      clienti_noi: 0,
    })
    expect(raport.comparatie?.incasat).toBe(0)
    expect(raport.comparatie?.programari_onorate).toBe(0)
  })

  it('desfacerile: bara zilei, servicii, produse, persoane, categorii, zile, clienți', () => {
    expect(raport.perioade).toEqual([
      { inceput: ZI, incasat_servicii: 200, incasat_produse: 100, cheltuieli: 150 },
    ])
    expect(raport.servicii).toEqual([
      expect.objectContaining({ articol_id: serviciuId, cantitate: 1, suma: 200 }),
    ])
    expect(raport.produse).toEqual([expect.objectContaining({ articol_id: produsId, cantitate: 2, suma: 100 })])
    expect(raport.persoane.find((p) => p.utilizator_id === executantId)).toMatchObject({
      incasat: 200,
      programari_onorate: 2,
    })
    expect(raport.cheltuieli).toEqual([{ categorie: 'Chirie test', suma: 150, numar: 2 }])
    // 11 iunie 2031 este miercuri.
    expect(raport.zile_saptamana).toHaveLength(7)
    expect(raport.zile_saptamana.find((z) => z.zi === 3)?.programari).toBe(2)
    expect(raport.clienti).toEqual([
      expect.objectContaining({ client_id: clientId, incasat: 300, incasari: 1 }),
    ])
  })

  it('cheltuielile corectate și șterse mută profitul', async () => {
    const { randuri } = await api.cheltuieli.list({ de_la: ZI, pana_la: ZI })
    const [prima, a_doua] = randuri
    await api.cheltuieli.update(prima!.id, { suma: 60 })
    await api.cheltuieli.remove(a_doua!.id)
    const dupa = await api.statistici.raport({ de_la: ZI, pana_la: ZI, pas: 'zi' })
    expect(dupa.total.cheltuieli).toBe(60)
    expect(dupa.total.profit).toBe(240)
    expect(dupa.comparatie).toBeNull()
    expect(magazin.jurnal_operatiuni.some((j) => j.entitate === 'cheltuiala' && j.actiune === 'stergere')).toBe(true)
  })
})

describe('raportul pe datele demo', () => {
  beforeEach(async () => {
    await autentifica()
    await api.statistici.seteazaParola({ parola_noua: PAROLA_STATISTICI_TEST })
  })

  it('barele și desfacerile însumează exact totalurile, pe orice grupare', async () => {
    const azi = new Date()
    const de_la = laInputDate(new Date(azi.getFullYear(), azi.getMonth() - 2, 1))
    const pana_la = laInputDate(azi)
    for (const pas of ['zi', 'saptamana', 'luna'] as const) {
      const r = await api.statistici.raport({ de_la, pana_la, pas })
      expect(r.total.incasat).toBeGreaterThan(0)
      expect(r.total.cheltuieli).toBeGreaterThan(0)
      expect(sumaTotal(r.perioade.map((p) => p.incasat_servicii + p.incasat_produse))).toBe(r.total.incasat)
      expect(sumaTotal(r.perioade.map((p) => p.cheltuieli))).toBe(r.total.cheltuieli)
      expect(sumaTotal(r.servicii.map((s) => s.suma))).toBe(r.total.incasat_servicii)
      expect(sumaTotal(r.produse.map((s) => s.suma))).toBe(r.total.incasat_produse)
      expect(sumaTotal(r.cheltuieli.map((c) => c.suma))).toBe(r.total.cheltuieli)
      expect(r.total.profit).toBe(sumaTotal([r.total.incasat, -r.total.cheltuieli]))
    }
  })

  it('refuză filtrele greșite pe câmpul lor, ca serverul', async () => {
    const cazuri: [Parameters<typeof api.statistici.raport>[0], string][] = [
      [{ de_la: '2026-09-10', pana_la: '2026-09-01', pas: 'zi' }, 'pana_la'],
      [{ de_la: '2026-02-30', pana_la: '2026-03-01', pas: 'zi' }, 'de_la'],
      [{ de_la: '2020-01-01', pana_la: '2022-01-01', pas: 'zi' }, 'pas'],
      [{ de_la: '2026-09-01', pana_la: '2026-09-02', pas: 'zi', fus: 'Marte/Olimp' }, 'fus'],
      // PostgreSQL ar citi „+02:00” ca UTC−2 — se primesc doar nume IANA.
      [{ de_la: '2026-09-01', pana_la: '2026-09-02', pas: 'zi', fus: '+02:00' }, 'fus'],
      [{ de_la: '2026-09-01', pana_la: '2026-09-02', pas: 'zi', comparatie_de_la: '2026-08-01' }, 'comparatie_pana_la'],
    ]
    for (const [filtru, camp] of cazuri) {
      expect(campVinovat(await eroareDin(api.statistici.raport(filtru)))).toBe(camp)
    }
    // Un an întreg zi cu zi încape.
    await expect(api.statistici.raport({ de_la: '2025-01-01', pana_la: '2025-12-31', pas: 'zi' })).resolves.toBeTruthy()
  })

  it('refuză cheltuielile greșite pe câmpul lor', async () => {
    const cazuri: [Parameters<typeof api.cheltuieli.create>[0], string][] = [
      [{ data: '2026-09-01', categorie: 'X', suma: 0 }, 'suma'],
      [{ data: '2026-02-30', categorie: 'X', suma: 5 }, 'data'],
      [{ data: '2026-09-01T10:00:00Z', categorie: 'X', suma: 5 }, 'data'],
      [{ data: '2026-09-01', categorie: '  ', suma: 5 }, 'categorie'],
    ]
    for (const [date, camp] of cazuri) {
      expect(campVinovat(await eroareDin(api.cheltuieli.create(date)))).toBe(camp)
    }
    // O corectură fără niciun câmp este o cerere greșită, ca pe server.
    const cheltuiala = await api.cheltuieli.create({ data: '2026-09-01', categorie: 'X', suma: 5 })
    expect(((await eroareDin(api.cheltuieli.update(cheltuiala.id, {}))) as { cod?: string }).cod).toBe('validare')
  })

  it('jurnalul arată cine și când, dar sumele cheltuielilor doar cu statisticile deblocate', async () => {
    const cheltuiala = await api.cheltuieli.create({ data: '2026-09-01', categorie: 'Chirie', suma: 3500 })
    const cu = await api.jurnal.list({ entitate: 'cheltuiala', entitate_id: cheltuiala.id })
    expect(cu.randuri[0]?.date_noi).toMatchObject({ suma: 3500 })

    api.statistici.blocheaza()
    const fara = await api.jurnal.list({ entitate: 'cheltuiala', entitate_id: cheltuiala.id })
    expect(fara.randuri).toHaveLength(1)
    expect(fara.randuri[0]).toMatchObject({ actiune: 'creare', date_noi: null, date_vechi: null })
  })
})
