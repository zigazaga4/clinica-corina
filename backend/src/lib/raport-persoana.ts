/**
 * Raportul unei singure persoane — „Statisticile mele”.
 *
 * Cerința clinicii (3 nov. 2026): „o statistică și pentru Anda, în care să-i
 * apară doar încasările ei și ce face ea în fiecare lună, doar pe contul ei.
 * Eu le văd pe toate la comun, Irina cu Anda; ea să le vadă doar pe ale Andei.”
 *
 * Persoana este cea care a FĂCUT ședința (`programare.executant_id`), nu cea
 * care a introdus plata la recepție: banii și ședințele ei sunt cele pe care le
 * socotește clinica pentru salariu (cerința din 5 oct. 2026, „Făcută de”).
 *
 * Aceleași reguli de numărare ca în `raport-statistici.ts` — încasat după ziua
 * plății, programări după ziua lor, vizite distincte, ziua în fusul clinicii —
 * cu excepția avansului pe abonament, vezi `LINII_PERSOANE`. Fără cheltuieli,
 * profit sau produse: sunt ale clinicii, nu ale unei persoane.
 *
 * Gemenul din memorie: `frontend/src/api/memory/statistici.ts`
 * (`construiesteRaportPersoana`). Dacă o regulă se schimbă aici, se schimbă și acolo.
 */

import pool, { multe, unu, type Executor } from './db.js'
import { LIMITE, LINII_PERSOANE, UNITATE, type FiltruRaport } from './raport-statistici.js'
import type {
  PerioadaPersoana,
  RaportPersoana,
  StatisticaClient,
  StatisticaServiciuPersoana,
  TotaluriPersoana,
} from '../types/database.js'

/*
  Parametrii fiecărei interogări: $1 = de_la, $2 = pana_la, $3 = fus,
  $4 = persoana, iar la grafic $5 = unitatea pasului.
*/

/** Programările ei (rânduri de ședință) din perioadă, ca fragment SQL. */
const SEDINTELE_EI = `SELECT p.* FROM programare p CROSS JOIN lim
   WHERE p.executant_id = $4 AND p.incepe_la >= lim.de AND p.incepe_la < lim.pana`

function totaluri(
  ex: Executor,
  de_la: string,
  pana_la: string,
  fus: string,
  persoana: string,
): Promise<TotaluriPersoana> {
  return unu<TotaluriPersoana>(
    ex,
    `WITH ${LIMITE}, ${LINII_PERSOANE},
     ale AS (SELECT * FROM linii_p WHERE executant_id = $4),
     sedinte AS (${SEDINTELE_EI})
     SELECT
       COALESCE((SELECT sum(total_linie) FROM ale), 0)                          AS incasat,
       (SELECT count(DISTINCT vanzare_id) FROM ale)                             AS incasari,
       COALESCE((SELECT sum(s.pret) FROM sedinte s
                 WHERE s.stare = 'onorat'
                   AND NOT EXISTS (SELECT 1 FROM vanzare_linie vl
                                   WHERE vl.programare_id = s.id)), 0)           AS neachitat,
       (SELECT count(DISTINCT vizita_id) FROM sedinte WHERE stare = 'onorat')      AS programari_onorate,
       (SELECT count(DISTINCT vizita_id) FROM sedinte WHERE stare = 'neprezentat') AS programari_neprezentate,
       (SELECT count(DISTINCT vizita_id) FROM sedinte WHERE stare = 'anulat')      AS programari_anulate,
       (SELECT count(DISTINCT vizita_id) FROM sedinte WHERE stare = 'programat')   AS programari_programate,
       (SELECT count(DISTINCT client_id) FROM sedinte WHERE stare = 'onorat')      AS clienti`,
    [de_la, pana_la, fus, persoana],
    'Raportul',
  )
}

function perioade(ex: Executor, f: FiltruRaport, persoana: string): Promise<PerioadaPersoana[]> {
  return multe<PerioadaPersoana>(
    ex,
    `WITH ${LIMITE}, ${LINII_PERSOANE},
     serie AS (
       SELECT generate_series(
         date_trunc($5, $1::date::timestamp),
         date_trunc($5, $2::date::timestamp),
         ('1 ' || $5)::interval
       )::date AS inceput
     ),
     incasat AS (
       SELECT date_trunc($5, data_ref AT TIME ZONE $3)::date AS inceput, sum(total_linie) AS suma
       FROM linii_p WHERE executant_id = $4 GROUP BY 1
     ),
     onorate AS (
       SELECT date_trunc($5, s.incepe_la AT TIME ZONE $3)::date AS inceput,
              count(DISTINCT s.vizita_id) AS programari
       FROM (${SEDINTELE_EI}) s WHERE s.stare = 'onorat' GROUP BY 1
     )
     SELECT s.inceput,
            COALESCE(i.suma, 0)      AS incasat,
            COALESCE(o.programari, 0) AS programari_onorate
     FROM serie s
     LEFT JOIN incasat i ON i.inceput = s.inceput
     LEFT JOIN onorate o ON o.inceput = s.inceput
     ORDER BY s.inceput`,
    [f.de_la, f.pana_la, f.fus, persoana, UNITATE[f.pas]],
  )
}

/** Serviciile ei: câte ședințe a făcut din fiecare și câți bani au intrat pe ele. */
function servicii(ex: Executor, f: FiltruRaport, persoana: string): Promise<StatisticaServiciuPersoana[]> {
  return multe<StatisticaServiciuPersoana>(
    ex,
    `WITH ${LIMITE}, ${LINII_PERSOANE},
     bani AS (
       SELECT articol_id, sum(total_linie) AS incasat
       FROM linii_p WHERE executant_id = $4 GROUP BY articol_id
     ),
     facute AS (
       SELECT s.articol_id, count(*) AS sedinte
       FROM (${SEDINTELE_EI}) s WHERE s.stare = 'onorat' GROUP BY s.articol_id
     )
     SELECT COALESCE(b.articol_id, fa.articol_id) AS articol_id,
            COALESCE(a.denumire, '—')             AS denumire,
            COALESCE(fa.sedinte, 0)               AS sedinte,
            COALESCE(b.incasat, 0)                AS incasat
     FROM bani b
     FULL JOIN facute fa ON fa.articol_id = b.articol_id
     LEFT JOIN articol a ON a.id = COALESCE(b.articol_id, fa.articol_id)
     ORDER BY incasat DESC, sedinte DESC, denumire`,
    [f.de_la, f.pana_la, f.fus, persoana],
  )
}

/** Clienții care au adus cei mai mulți bani prin ședințele ei — primii zece. */
function clienti(ex: Executor, f: FiltruRaport, persoana: string): Promise<StatisticaClient[]> {
  return multe<StatisticaClient>(
    ex,
    `WITH ${LIMITE}, ${LINII_PERSOANE}
     SELECT l.client_id, COALESCE(c.nume, '—') AS nume,
            sum(l.total_linie) AS incasat, count(DISTINCT l.vanzare_id) AS incasari
     FROM linii_p l LEFT JOIN client c ON c.id = l.client_id
     WHERE l.executant_id = $4
     GROUP BY l.client_id, c.nume
     ORDER BY incasat DESC, nume
     LIMIT 10`,
    [f.de_la, f.pana_la, f.fus, persoana],
  )
}

/**
 * Raportul întreg al unei persoane. Bucățile nu depind una de alta, deci
 * pleacă toate deodată, ca la raportul clinicii.
 *
 * Persoana inexistentă dă 404 (`unu`), nu un raport gol: un identificator
 * greșit trebuie să se vadă, nu să arate „n-a lucrat nimic”.
 */
export async function construiesteRaportPersoana(
  f: FiltruRaport,
  utilizator_id: string,
): Promise<RaportPersoana> {
  const [persoana, total, comparatie, listaPerioade, listaServicii, listaClienti] = await Promise.all([
    unu<{ id: string; nume: string }>(
      pool, `SELECT id, nume FROM utilizator WHERE id = $1`, [utilizator_id], 'Persoana',
    ),
    totaluri(pool, f.de_la, f.pana_la, f.fus, utilizator_id),
    f.comparatie ? totaluri(pool, f.comparatie.de_la, f.comparatie.pana_la, f.fus, utilizator_id) : null,
    perioade(pool, f, utilizator_id),
    servicii(pool, f, utilizator_id),
    clienti(pool, f, utilizator_id),
  ])

  return {
    de_la: f.de_la,
    pana_la: f.pana_la,
    pas: f.pas,
    utilizator_id: persoana.id,
    nume: persoana.nume,
    total,
    comparatie,
    perioade: listaPerioade,
    servicii: listaServicii,
    clienti: listaClienti,
  }
}
