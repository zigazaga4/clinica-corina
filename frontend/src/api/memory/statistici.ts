/**
 * Raportul Statisticilor, calculat peste tabelele din memorie.
 *
 * Gemenul lui `backend/src/lib/raport-statistici.ts`: aceleași cifre, după
 * aceleași reguli, ca ecranul să arate la fel pe datele demo și pe server.
 * Pe scurt:
 *
 *   ÎNCASAT    — liniile vânzărilor ACHITATE în perioadă, după ziua plății;
 *   CHELTUIELI — cheltuielile cu `data` în perioadă;
 *   PROFIT     — încasat minus cheltuieli;
 *   NEACHITAT  — ședințe onorate fără încasare + produse date pe datorie,
 *                din ce s-a lucrat în perioadă;
 *   PROGRAMĂRI — vizitele din calendar (o programare cu trei servicii e UNA).
 *
 * Singura diferență este fusul orar: serverul citește zilele în fusul trimis,
 * aici se citesc în cel al calculatorului — care, pentru datele demo, este
 * chiar cel trimis.
 */

import { addDays, addMonths, addWeeks, format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import type { FiltruStatistici } from '@/api/contract'
import { eroareValidare } from '@/api/errors'
import type {
  DateOnly,
  PasStatistici,
  PerioadaStatistici,
  RaportStatistici,
  StatisticaArticol,
  StatisticaCategorie,
  StatisticaClient,
  StatisticaPersoana,
  Timestamptz,
  TotaluriStatistici,
  Uuid,
  Vanzare,
  VanzareLinie,
} from '@/domain/types'
import { PAS_STATISTICI } from '@/domain/types'
import { rotunjeste, sumaTotal } from '@/lib/money'
import { dataCeruta } from './constraints'
import { magazin } from './store'

/** Câte bare încap într-un grafic — un an zi cu zi. Ca pe server. */
const BARE_MAXIME = 400

/** Ziua locală a unui moment, `YYYY-MM-DD`. */
const ziua = (moment: Timestamptz): DateOnly => format(parseISO(moment), 'yyyy-MM-dd')

/** Prima zi a barei din care face parte ziua dată. */
function inceputBara(zi: DateOnly, pas: PasStatistici): DateOnly {
  const d = parseISO(zi)
  if (pas === 'luna') return format(startOfMonth(d), 'yyyy-MM-dd')
  if (pas === 'saptamana') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  return zi
}

const urmatoareaBara: Record<PasStatistici, (d: Date) => Date> = {
  zi: (d) => addDays(d, 1),
  saptamana: (d) => addWeeks(d, 1),
  luna: (d) => addMonths(d, 1),
}

/** Toate barele dintre două zile — și cele goale, ca `generate_series`. */
function serie(de_la: DateOnly, pana_la: DateOnly, pas: PasStatistici, maxim = Infinity): DateOnly[] {
  const bare: DateOnly[] = []
  const ultima = inceputBara(pana_la, pas)
  let curenta = parseISO(inceputBara(de_la, pas))
  for (let zi = format(curenta, 'yyyy-MM-dd'); zi <= ultima; zi = format(curenta, 'yyyy-MM-dd')) {
    bare.push(zi)
    if (bare.length > maxim) break
    curenta = urmatoareaBara[pas](curenta)
  }
  return bare
}

/** Filtrul, cu aceleași verificări și aceleași câmpuri vinovate ca pe server. */
export function verificaFiltruStatistici(filtru: FiltruStatistici): FiltruStatistici {
  const de_la = dataCeruta(filtru.de_la, 'de_la', 'Începutul perioadei')
  const pana_la = dataCeruta(filtru.pana_la, 'pana_la', 'Sfârșitul perioadei')
  if (pana_la < de_la) {
    throw eroareValidare('Sfârșitul perioadei trebuie să fie după începutul ei.', 'pana_la')
  }

  const pas = filtru.pas ?? 'zi'
  if (!PAS_STATISTICI.includes(pas)) {
    throw eroareValidare('Gruparea poate fi doar pe zi, săptămână sau lună.', 'pas')
  }
  if (serie(de_la, pana_la, pas, BARE_MAXIME).length > BARE_MAXIME) {
    throw eroareValidare('Perioada este prea lungă pentru această grupare; alege una mai mare.', 'pas')
  }

  if (filtru.fus !== undefined) {
    try {
      // Doar nume IANA, ca pe server: „+02:00” l-ar citi PostgreSQL cu semnul întors.
      if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/.test(filtru.fus)) throw new RangeError(filtru.fus)
      new Intl.DateTimeFormat('en', { timeZone: filtru.fus })
    } catch {
      throw eroareValidare('Fusul orar trimis nu este cunoscut.', 'fus')
    }
  }

  const areComparatie = filtru.comparatie_de_la !== undefined || filtru.comparatie_pana_la !== undefined
  if (!areComparatie) return { de_la, pana_la, pas, fus: filtru.fus }

  const comparatie_de_la = dataCeruta(filtru.comparatie_de_la, 'comparatie_de_la', 'Începutul comparației')
  const comparatie_pana_la = dataCeruta(filtru.comparatie_pana_la, 'comparatie_pana_la', 'Sfârșitul comparației')
  if (comparatie_pana_la < comparatie_de_la) {
    throw eroareValidare('Sfârșitul comparației trebuie să fie după începutul ei.', 'comparatie_pana_la')
  }
  return { de_la, pana_la, pas, fus: filtru.fus, comparatie_de_la, comparatie_pana_la }
}

interface LinieIncasata {
  vanzare: Vanzare
  linie: VanzareLinie
  tip: 'serviciu' | 'produs'
}

/** Liniile vânzărilor achitate în perioadă — rândurile din care se numără banii. */
function liniiIncasate(de_la: DateOnly, pana_la: DateOnly): LinieIncasata[] {
  const rezultat: LinieIncasata[] = []
  for (const linie of magazin.vanzare_linie.values()) {
    const vanzare = magazin.vanzare.get(linie.vanzare_id)
    if (!vanzare || vanzare.achitat_la === null) continue
    const zi = ziua(vanzare.achitat_la)
    if (zi < de_la || zi > pana_la) continue
    rezultat.push({ vanzare, linie, tip: magazin.articol.get(linie.articol_id)?.tip ?? 'produs' })
  }
  return rezultat
}

const inPerioada = (moment: Timestamptz, de_la: DateOnly, pana_la: DateOnly) => {
  const zi = ziua(moment)
  return zi >= de_la && zi <= pana_la
}

function totaluri(de_la: DateOnly, pana_la: DateOnly): TotaluriStatistici {
  const linii = liniiIncasate(de_la, pana_la)
  const bani = (lista: LinieIncasata[]) => sumaTotal(lista.map((l) => l.linie.total_linie))

  const incasat = bani(linii)
  const cheltuieli = sumaTotal(
    [...magazin.cheltuiala.values()]
      .filter((c) => c.data >= de_la && c.data <= pana_la)
      .map((c) => c.suma),
  )

  const sedinteIncasate = new Set(
    [...magazin.vanzare_linie.values()].map((l) => l.programare_id).filter((id) => id !== null),
  )
  const programari = [...magazin.programare.values()].filter((p) => inPerioada(p.incepe_la, de_la, pana_la))
  const vizite = (stare: string) =>
    new Set(programari.filter((p) => p.stare === stare).map((p) => p.vizita_id)).size

  const neachitat = sumaTotal([
    ...programari.filter((p) => p.stare === 'onorat' && !sedinteIncasate.has(p.id)).map((p) => p.pret),
    ...[...magazin.vanzare_linie.values()]
      .filter((l) => {
        const v = magazin.vanzare.get(l.vanzare_id)
        return v !== undefined && v.achitat_la === null && inPerioada(v.efectuat_la, de_la, pana_la)
      })
      .map((l) => l.total_linie),
  ])

  const serviti = new Set([
    ...programari.filter((p) => p.stare === 'onorat').map((p) => p.client_id),
    ...[...magazin.vanzare.values()]
      .filter((v) => inPerioada(v.efectuat_la, de_la, pana_la))
      .map((v) => v.client_id),
  ])

  return {
    incasat,
    incasat_servicii: bani(linii.filter((l) => l.tip === 'serviciu')),
    incasat_produse: bani(linii.filter((l) => l.tip !== 'serviciu')),
    incasat_numerar: bani(linii.filter((l) => l.vanzare.metoda_plata === 'numerar')),
    incasat_card: bani(linii.filter((l) => l.vanzare.metoda_plata === 'card')),
    incasat_nespecificat: bani(linii.filter((l) => l.vanzare.metoda_plata === null)),
    incasari: new Set(linii.map((l) => l.vanzare.id)).size,
    cheltuieli,
    profit: rotunjeste(incasat - cheltuieli),
    neachitat,
    programari_onorate: vizite('onorat'),
    programari_neprezentate: vizite('neprezentat'),
    programari_anulate: vizite('anulat'),
    programari_programate: vizite('programat'),
    clienti: serviti.size,
    clienti_noi: [...magazin.client.values()].filter((c) => inPerioada(c.creat_la, de_la, pana_la)).length,
  }
}

/** Grupează și adună — cheia dă grupul, `adauga` strânge valorile lui. */
function grupeaza<T, G>(lista: T[], cheie: (x: T) => string, nou: (x: T) => G, adauga: (g: G, x: T) => void): G[] {
  const grupuri = new Map<string, G>()
  for (const x of lista) {
    const k = cheie(x)
    let g = grupuri.get(k)
    if (!g) {
      g = nou(x)
      grupuri.set(k, g)
    }
    adauga(g, x)
  }
  return [...grupuri.values()]
}

const dupaSumaApoiNume = <T extends { denumire?: string; nume?: string }>(
  a: T,
  b: T,
  suma: (x: T) => number,
) => suma(b) - suma(a) || (a.denumire ?? a.nume ?? '').localeCompare(b.denumire ?? b.nume ?? '', 'ro')

function articole(linii: LinieIncasata[], tip: 'serviciu' | 'produs'): StatisticaArticol[] {
  return grupeaza(
    linii.filter((l) => (l.tip === 'serviciu') === (tip === 'serviciu')),
    (l) => l.linie.articol_id,
    (l): StatisticaArticol => ({
      articol_id: l.linie.articol_id,
      denumire: magazin.articol.get(l.linie.articol_id)?.denumire ?? '—',
      categorie: magazin.articol.get(l.linie.articol_id)?.categorie ?? null,
      cantitate: 0,
      suma: 0,
    }),
    (g, l) => {
      // Trei zecimale, ca `numeric(10,3)`: altfel 0,1 + 0,2 ar ieși 0,30000000000000004.
      g.cantitate = Math.round((g.cantitate + l.linie.cantitate) * 1000) / 1000
      g.suma = rotunjeste(g.suma + l.linie.total_linie)
    },
  ).sort((a, b) => dupaSumaApoiNume(a, b, (x) => x.suma))
}

function persoane(linii: LinieIncasata[], de_la: DateOnly, pana_la: DateOnly): StatisticaPersoana[] {
  const incasat = new Map<Uuid, number>()
  for (const l of linii) {
    const programare = l.linie.programare_id ? magazin.programare.get(l.linie.programare_id) : undefined
    if (!programare) continue
    incasat.set(programare.executant_id, rotunjeste((incasat.get(programare.executant_id) ?? 0) + l.linie.total_linie))
  }

  const onorate = new Map<Uuid, Set<Uuid>>()
  for (const p of magazin.programare.values()) {
    if (p.stare !== 'onorat' || !inPerioada(p.incepe_la, de_la, pana_la)) continue
    const vizite = onorate.get(p.executant_id) ?? new Set<Uuid>()
    vizite.add(p.vizita_id)
    onorate.set(p.executant_id, vizite)
  }

  const ids = new Set([...incasat.keys(), ...onorate.keys()])
  return [...ids]
    .map((id): StatisticaPersoana => ({
      utilizator_id: id,
      nume: magazin.utilizator.get(id)?.nume ?? '—',
      programari_onorate: onorate.get(id)?.size ?? 0,
      incasat: incasat.get(id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.incasat - a.incasat ||
        b.programari_onorate - a.programari_onorate ||
        a.nume.localeCompare(b.nume, 'ro'),
    )
}

function perioade(linii: LinieIncasata[], f: FiltruStatistici): PerioadaStatistici[] {
  const bare = new Map<DateOnly, PerioadaStatistici>(
    serie(f.de_la, f.pana_la, f.pas).map((inceput) => [
      inceput,
      { inceput, incasat_servicii: 0, incasat_produse: 0, cheltuieli: 0 },
    ]),
  )
  for (const l of linii) {
    const bara = bare.get(inceputBara(ziua(l.vanzare.achitat_la as Timestamptz), f.pas))
    if (!bara) continue
    if (l.tip === 'serviciu') bara.incasat_servicii = rotunjeste(bara.incasat_servicii + l.linie.total_linie)
    else bara.incasat_produse = rotunjeste(bara.incasat_produse + l.linie.total_linie)
  }
  for (const c of magazin.cheltuiala.values()) {
    if (c.data < f.de_la || c.data > f.pana_la) continue
    const bara = bare.get(inceputBara(c.data, f.pas))
    if (bara) bara.cheltuieli = rotunjeste(bara.cheltuieli + c.suma)
  }
  return [...bare.values()]
}

function categorii(de_la: DateOnly, pana_la: DateOnly): StatisticaCategorie[] {
  return grupeaza(
    [...magazin.cheltuiala.values()].filter((c) => c.data >= de_la && c.data <= pana_la),
    (c) => c.categorie,
    (c): StatisticaCategorie => ({ categorie: c.categorie, suma: 0, numar: 0 }),
    (g, c) => {
      g.suma = rotunjeste(g.suma + c.suma)
      g.numar += 1
    },
  ).sort((a, b) => b.suma - a.suma || a.categorie.localeCompare(b.categorie, 'ro'))
}

function zileSaptamana(de_la: DateOnly, pana_la: DateOnly): RaportStatistici['zile_saptamana'] {
  const vizite = new Map<number, Set<Uuid>>()
  for (const p of magazin.programare.values()) {
    if (p.stare !== 'onorat' || !inPerioada(p.incepe_la, de_la, pana_la)) continue
    const zi = ((parseISO(p.incepe_la).getDay() + 6) % 7) + 1
    const set = vizite.get(zi) ?? new Set<Uuid>()
    set.add(p.vizita_id)
    vizite.set(zi, set)
  }
  return [1, 2, 3, 4, 5, 6, 7].map((zi) => ({ zi, programari: vizite.get(zi)?.size ?? 0 }))
}

function clienti(linii: LinieIncasata[]): StatisticaClient[] {
  const bonuri = new Map<Uuid, Set<Uuid>>()
  return grupeaza(
    linii,
    (l) => l.vanzare.client_id,
    (l): StatisticaClient => ({
      client_id: l.vanzare.client_id,
      nume: magazin.client.get(l.vanzare.client_id)?.nume ?? '—',
      incasat: 0,
      incasari: 0,
    }),
    (g, l) => {
      g.incasat = rotunjeste(g.incasat + l.linie.total_linie)
      const ale = bonuri.get(g.client_id) ?? new Set<Uuid>()
      ale.add(l.vanzare.id)
      bonuri.set(g.client_id, ale)
      g.incasari = ale.size
    },
  )
    .sort((a, b) => dupaSumaApoiNume(a, b, (x) => x.incasat))
    .slice(0, 10)
}

/** Raportul întreg, pentru un filtru deja verificat. */
export function calculeazaRaport(filtru: FiltruStatistici): RaportStatistici {
  const f = verificaFiltruStatistici(filtru)
  const linii = liniiIncasate(f.de_la, f.pana_la)
  return {
    de_la: f.de_la,
    pana_la: f.pana_la,
    pas: f.pas,
    total: totaluri(f.de_la, f.pana_la),
    comparatie:
      f.comparatie_de_la && f.comparatie_pana_la
        ? totaluri(f.comparatie_de_la, f.comparatie_pana_la)
        : null,
    perioade: perioade(linii, f),
    servicii: articole(linii, 'serviciu'),
    produse: articole(linii, 'produs'),
    persoane: persoane(linii, f.de_la, f.pana_la),
    cheltuieli: categorii(f.de_la, f.pana_la),
    zile_saptamana: zileSaptamana(f.de_la, f.pana_la),
    clienti: clienti(linii),
  }
}
