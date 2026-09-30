/**
 * Raportul din ecranul „Statistici” — GET /statistici.
 *
 * Ce înseamnă fiecare cifră (și e bine să nu se schimbe pe tăcute, fiindcă pe
 * ele se iau decizii):
 *
 *   ÎNCASAT    — banii intrați: liniile vânzărilor ACHITATE în perioadă, după
 *                `achitat_la`. O cremă dată pe datorie în august și plătită în
 *                septembrie este un ban intrat în septembrie.
 *   CHELTUIELI — rândurile din `cheltuiala` cu `data` în perioadă.
 *   PROFIT     — încasat minus cheltuieli. Poate fi negativ.
 *   NEACHITAT  — ce s-a lucrat în perioadă și nu s-a plătit încă: ședințele
 *                onorate fără linie de încasare și produsele date pe datorie.
 *   PROGRAMĂRI — vizitele din calendar (o programare cu trei servicii este UNA),
 *                după ziua în care au loc.
 *
 * Zilele se citesc în fusul orar al clinicii, trimis de interfață: o plată de
 * la 00:30, ora României, este a zilei ei, nu a celei de dinainte, cum ar ieși
 * în UTC.
 *
 * Implementarea din memorie a aplicației (`src/api/memory/statistici.ts`)
 * calculează aceleași cifre, după aceleași reguli. Dacă una se schimbă aici,
 * se schimbă și acolo.
 */

import pool, { multe, unu, type Executor } from './db.js'
import { rotunjeste } from './bani.js'
import { eroareValidare } from './erori.js'
import { textDin } from './filtre.js'
import { dataCeruta } from './validare.js'
import type {
  PasStatistici,
  PerioadaStatistici,
  RaportStatistici,
  StatisticaArticol,
  StatisticaCategorie,
  StatisticaClient,
  StatisticaPersoana,
  TotaluriStatistici,
} from '../types/database.js'

/** Unitatea lui `date_trunc` pentru fiecare pas. */
const UNITATE: Record<PasStatistici, 'day' | 'week' | 'month'> = {
  zi: 'day',
  saptamana: 'week',
  luna: 'month',
}

/**
 * Câte bare încap într-un grafic.
 *
 * Patru sute acoperă un an zi cu zi. Peste, graficul n-ar mai fi citibil, iar
 * zece ani cerute pe zile ar fi generat trei mii de rânduri pentru nimic.
 */
const BARE_MAXIME = 400

export interface FiltruRaport {
  de_la: string
  pana_la: string
  pas: PasStatistici
  fus: string
  comparatie: { de_la: string; pana_la: string } | null
}

/**
 * Doar nume de fus IANA — „Europe/Bucharest”, „UTC”.
 *
 * Decalajele scrise ca „+02:00” le acceptă și JavaScript, dar PostgreSQL le
 * citește după convenția POSIX, cu semnul întors: „+02:00” ar fi însemnat
 * UTC−2, iar fiecare zi a raportului ar fi alunecat cu patru ore.
 */
export const FUS_IANA = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/

/** Fusul orar trimis, verificat înainte să ajungă în SQL. */
function fusCerut(valoare: unknown): string {
  const fus = textDin(valoare) ?? 'Europe/Bucharest'
  try {
    if (!FUS_IANA.test(fus)) throw new RangeError(fus)
    new Intl.DateTimeFormat('en', { timeZone: fus })
  } catch {
    throw eroareValidare('Fusul orar trimis nu este cunoscut.', 'fus')
  }
  return fus
}

/** Câte bare ar avea intervalul pe pasul dat — aceeași socoteală ca `generate_series`. */
function numarBare(de_la: string, pana_la: string, pas: PasStatistici): number {
  const zi = (text: string) => new Date(`${text}T00:00:00Z`)
  const a = zi(de_la)
  const b = zi(pana_la)
  if (pas === 'luna') {
    return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1
  }
  const lunea = (d: Date) => {
    const inapoi = (d.getUTCDay() + 6) % 7
    return d.getTime() - inapoi * 86_400_000
  }
  if (pas === 'saptamana') return Math.round((lunea(b) - lunea(a)) / (7 * 86_400_000)) + 1
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

/** Filtrul din query string, cu toate verificările făcute. */
export function filtruRaportDin(q: Record<string, unknown>): FiltruRaport {
  const de_la = dataCeruta(q['de_la'], 'de_la', 'Începutul perioadei')
  const pana_la = dataCeruta(q['pana_la'], 'pana_la', 'Sfârșitul perioadei')
  if (pana_la < de_la) {
    throw eroareValidare('Sfârșitul perioadei trebuie să fie după începutul ei.', 'pana_la')
  }

  const pas = textDin(q['pas']) ?? 'zi'
  // `hasOwn`, nu `in`: „toString” sau „__proto__” sunt și ele „în” orice obiect.
  if (!Object.hasOwn(UNITATE, pas)) {
    throw eroareValidare('Gruparea poate fi doar pe zi, săptămână sau lună.', 'pas')
  }
  if (numarBare(de_la, pana_la, pas as PasStatistici) > BARE_MAXIME) {
    throw eroareValidare('Perioada este prea lungă pentru această grupare; alege una mai mare.', 'pas')
  }

  const areComparatie = q['comparatie_de_la'] !== undefined || q['comparatie_pana_la'] !== undefined
  let comparatie: FiltruRaport['comparatie'] = null
  if (areComparatie) {
    const c_de_la = dataCeruta(q['comparatie_de_la'], 'comparatie_de_la', 'Începutul comparației')
    const c_pana_la = dataCeruta(q['comparatie_pana_la'], 'comparatie_pana_la', 'Sfârșitul comparației')
    if (c_pana_la < c_de_la) {
      throw eroareValidare('Sfârșitul comparației trebuie să fie după începutul ei.', 'comparatie_pana_la')
    }
    comparatie = { de_la: c_de_la, pana_la: c_pana_la }
  }

  return { de_la, pana_la, pas: pas as PasStatistici, fus: fusCerut(q['fus']), comparatie }
}

/*
  Capetele perioadei, ca momente: de la miezul nopții primei zile până la
  miezul nopții de DUPĂ ultima, în fusul clinicii. Intervalul e deschis la
  dreapta, ca o plată de la 23:59:59,9 să nu cadă între două zile.

  Parametrii fiecărei interogări încep cu $1 = de_la, $2 = pana_la, $3 = fus.
*/
const LIMITE = `lim AS (
  SELECT ($1::date)::timestamp AT TIME ZONE $3     AS de,
         ($2::date + 1)::timestamp AT TIME ZONE $3 AS pana
)`

/** Liniile încasate în perioadă, cu tipul articolului. */
const LINII_INCASATE = `linii AS (
  SELECT v.id AS vanzare_id, v.client_id, vl.articol_id, vl.cantitate, vl.total_linie,
         vl.programare_id, v.achitat_la, COALESCE(a.tip, 'produs') AS tip
  FROM vanzare v
  JOIN vanzare_linie vl ON vl.vanzare_id = v.id
  LEFT JOIN articol a ON a.id = vl.articol_id
  CROSS JOIN lim
  WHERE v.achitat_la >= lim.de AND v.achitat_la < lim.pana
)`

async function totaluri(
  ex: Executor,
  de_la: string,
  pana_la: string,
  fus: string,
): Promise<TotaluriStatistici> {
  const rand = await unu<Omit<TotaluriStatistici, 'profit'>>(
    ex,
    `WITH ${LIMITE}, ${LINII_INCASATE},
     vizite AS (
       SELECT p.vizita_id, p.stare, p.client_id
       FROM programare p CROSS JOIN lim
       WHERE p.incepe_la >= lim.de AND p.incepe_la < lim.pana
     )
     SELECT
       COALESCE((SELECT sum(total_linie) FROM linii), 0)                          AS incasat,
       COALESCE((SELECT sum(total_linie) FROM linii WHERE tip = 'serviciu'), 0)   AS incasat_servicii,
       COALESCE((SELECT sum(total_linie) FROM linii WHERE tip <> 'serviciu'), 0)  AS incasat_produse,
       (SELECT count(DISTINCT vanzare_id) FROM linii)                             AS incasari,
       COALESCE((SELECT sum(suma) FROM cheltuiala
                 WHERE data BETWEEN $1::date AND $2::date), 0)                    AS cheltuieli,
       COALESCE((SELECT sum(p.pret) FROM programare p CROSS JOIN lim
                 WHERE p.stare = 'onorat'
                   AND p.incepe_la >= lim.de AND p.incepe_la < lim.pana
                   AND NOT EXISTS (SELECT 1 FROM vanzare_linie vl
                                   WHERE vl.programare_id = p.id)), 0)
       + COALESCE((SELECT sum(vl.total_linie)
                   FROM vanzare v JOIN vanzare_linie vl ON vl.vanzare_id = v.id
                   CROSS JOIN lim
                   WHERE v.achitat_la IS NULL
                     AND v.efectuat_la >= lim.de AND v.efectuat_la < lim.pana), 0) AS neachitat,
       (SELECT count(DISTINCT vizita_id) FROM vizite WHERE stare = 'onorat')      AS programari_onorate,
       (SELECT count(DISTINCT vizita_id) FROM vizite WHERE stare = 'neprezentat') AS programari_neprezentate,
       (SELECT count(DISTINCT vizita_id) FROM vizite WHERE stare = 'anulat')      AS programari_anulate,
       (SELECT count(DISTINCT vizita_id) FROM vizite WHERE stare = 'programat')   AS programari_programate,
       (SELECT count(*) FROM (
          SELECT client_id FROM vizite WHERE stare = 'onorat'
          UNION
          SELECT v.client_id FROM vanzare v CROSS JOIN lim
          WHERE v.efectuat_la >= lim.de AND v.efectuat_la < lim.pana
        ) serviti)                                                                AS clienti,
       (SELECT count(*) FROM client c CROSS JOIN lim
        WHERE c.creat_la >= lim.de AND c.creat_la < lim.pana)                     AS clienti_noi`,
    [de_la, pana_la, fus],
    'Raportul',
  )
  return { ...rand, profit: rotunjeste(rand.incasat - rand.cheltuieli) }
}

function perioade(ex: Executor, f: FiltruRaport): Promise<PerioadaStatistici[]> {
  const unitate = UNITATE[f.pas]
  return multe<PerioadaStatistici>(
    ex,
    `WITH ${LIMITE}, ${LINII_INCASATE},
     serie AS (
       SELECT generate_series(
         date_trunc($4, $1::date::timestamp),
         date_trunc($4, $2::date::timestamp),
         ('1 ' || $4)::interval
       )::date AS inceput
     ),
     incasat AS (
       SELECT date_trunc($4, achitat_la AT TIME ZONE $3)::date AS inceput,
              sum(total_linie) FILTER (WHERE tip = 'serviciu')  AS servicii,
              sum(total_linie) FILTER (WHERE tip <> 'serviciu') AS produse
       FROM linii GROUP BY 1
     ),
     cheltuit AS (
       SELECT date_trunc($4, data::timestamp)::date AS inceput, sum(suma) AS suma
       FROM cheltuiala WHERE data BETWEEN $1::date AND $2::date
       GROUP BY 1
     )
     SELECT s.inceput,
            COALESCE(i.servicii, 0) AS incasat_servicii,
            COALESCE(i.produse, 0)  AS incasat_produse,
            COALESCE(c.suma, 0)     AS cheltuieli
     FROM serie s
     LEFT JOIN incasat  i ON i.inceput = s.inceput
     LEFT JOIN cheltuit c ON c.inceput = s.inceput
     ORDER BY s.inceput`,
    [f.de_la, f.pana_la, f.fus, unitate],
  )
}

/** Serviciile sau produsele, după banii aduși. */
function articole(ex: Executor, f: FiltruRaport, tip: 'serviciu' | 'produs'): Promise<StatisticaArticol[]> {
  return multe<StatisticaArticol>(
    ex,
    `WITH ${LIMITE}, ${LINII_INCASATE}
     SELECT l.articol_id, COALESCE(a.denumire, '—') AS denumire,
            sum(l.cantitate) AS cantitate, sum(l.total_linie) AS suma
     FROM linii l LEFT JOIN articol a ON a.id = l.articol_id
     WHERE (l.tip = 'serviciu') = ($4 = 'serviciu')
     GROUP BY l.articol_id, a.denumire
     ORDER BY suma DESC, denumire`,
    [f.de_la, f.pana_la, f.fus, tip],
  )
}

/**
 * Pe persoane: programările onorate (după ziua lor) și banii încasați din
 * serviciile lor (după ziua plății). Produsele nu au executant — nu intră aici.
 */
function persoane(ex: Executor, f: FiltruRaport): Promise<StatisticaPersoana[]> {
  return multe<StatisticaPersoana>(
    ex,
    `WITH ${LIMITE}, ${LINII_INCASATE},
     incasat AS (
       SELECT p.executant_id AS id, sum(l.total_linie) AS incasat
       FROM linii l JOIN programare p ON p.id = l.programare_id
       GROUP BY p.executant_id
     ),
     onorate AS (
       SELECT p.executant_id AS id, count(DISTINCT p.vizita_id) AS programari_onorate
       FROM programare p CROSS JOIN lim
       WHERE p.stare = 'onorat' AND p.incepe_la >= lim.de AND p.incepe_la < lim.pana
       GROUP BY p.executant_id
     )
     SELECT u.id AS utilizator_id, u.nume,
            COALESCE(o.programari_onorate, 0) AS programari_onorate,
            COALESCE(i.incasat, 0)            AS incasat
     FROM utilizator u
     LEFT JOIN incasat i ON i.id = u.id
     LEFT JOIN onorate o ON o.id = u.id
     WHERE i.id IS NOT NULL OR o.id IS NOT NULL
     ORDER BY incasat DESC, programari_onorate DESC, u.nume`,
    [f.de_la, f.pana_la, f.fus],
  )
}

function categorii(ex: Executor, f: FiltruRaport): Promise<StatisticaCategorie[]> {
  return multe<StatisticaCategorie>(
    ex,
    `SELECT categorie, sum(suma) AS suma, count(*) AS numar
     FROM cheltuiala WHERE data BETWEEN $1::date AND $2::date
     GROUP BY categorie ORDER BY suma DESC, categorie`,
    [f.de_la, f.pana_la],
  )
}

/** Programările onorate pe zilele săptămânii, luni = 1. Toate șapte, și cele goale. */
async function zileSaptamana(ex: Executor, f: FiltruRaport): Promise<RaportStatistici['zile_saptamana']> {
  const randuri = await multe<{ zi: number; programari: number }>(
    ex,
    `WITH ${LIMITE}
     SELECT extract(isodow FROM p.incepe_la AT TIME ZONE $3)::int AS zi,
            count(DISTINCT p.vizita_id) AS programari
     FROM programare p CROSS JOIN lim
     WHERE p.stare = 'onorat' AND p.incepe_la >= lim.de AND p.incepe_la < lim.pana
     GROUP BY 1`,
    [f.de_la, f.pana_la, f.fus],
  )
  const pe = new Map(randuri.map((r) => [r.zi, r.programari]))
  return [1, 2, 3, 4, 5, 6, 7].map((zi) => ({ zi, programari: pe.get(zi) ?? 0 }))
}

/** Clienții care au adus cei mai mulți bani în perioadă — primii zece. */
function clienti(ex: Executor, f: FiltruRaport): Promise<StatisticaClient[]> {
  return multe<StatisticaClient>(
    ex,
    `WITH ${LIMITE}, ${LINII_INCASATE}
     SELECT l.client_id, COALESCE(c.nume, '—') AS nume,
            sum(l.total_linie) AS incasat, count(DISTINCT l.vanzare_id) AS incasari
     FROM linii l LEFT JOIN client c ON c.id = l.client_id
     GROUP BY l.client_id, c.nume
     ORDER BY incasat DESC, nume
     LIMIT 10`,
    [f.de_la, f.pana_la, f.fus],
  )
}

/**
 * Raportul întreg. Bucățile nu depind una de alta, deci pleacă toate deodată:
 * fiecare e o interogare scurtă, iar așteptate pe rând ar fi adunat timpii.
 */
export async function construiesteRaport(f: FiltruRaport): Promise<RaportStatistici> {
  const [
    total,
    comparatie,
    listaPerioade,
    servicii,
    produse,
    listaPersoane,
    listaCategorii,
    zile,
    listaClienti,
  ] = await Promise.all([
    totaluri(pool, f.de_la, f.pana_la, f.fus),
    f.comparatie ? totaluri(pool, f.comparatie.de_la, f.comparatie.pana_la, f.fus) : null,
    perioade(pool, f),
    articole(pool, f, 'serviciu'),
    articole(pool, f, 'produs'),
    persoane(pool, f),
    categorii(pool, f),
    zileSaptamana(pool, f),
    clienti(pool, f),
  ])

  return {
    de_la: f.de_la,
    pana_la: f.pana_la,
    pas: f.pas,
    total,
    comparatie,
    perioade: listaPerioade,
    servicii,
    produse,
    persoane: listaPersoane,
    cheltuieli: listaCategorii,
    zile_saptamana: zile,
    clienti: listaClienti,
  }
}
