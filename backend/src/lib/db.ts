import { Pool, types, type PoolClient, type QueryResultRow } from 'pg'
import 'dotenv/config'
import { eroareNegasit, eroareValidare } from './erori.js'

if (!process.env.DATABASE_URL) {
  throw new Error('Lipsește DATABASE_URL din .env — copiază .env.example și completează-l.')
}

// Return date columns as plain YYYY-MM-DD strings, not JS Date objects
types.setTypeParser(1082, v => v)

/*
  numeric -> number, bigint -> number.

  Driverul `pg` le întoarce implicit ca TEXT, fiindcă `numeric` are precizie
  arbitrară și `bigint` depășește ce poate ține exact un număr JavaScript. Pe
  firul HTTP asta înseamnă `"180.00"` acolo unde interfața așteaptă `180`, iar
  totalurile ei devin „180.00280.00” în loc de 460 — o adunare de șiruri.

  Valorile din această bază încap fără pierdere: prețuri `numeric(10,2)` sub
  două miliarde și identificatori de jurnal care ar avea nevoie de mii de ani
  ca să atingă 2^53.
*/
types.setTypeParser(1700, Number)  // numeric
types.setTypeParser(20, Number)    // int8 / bigserial

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Momentele pleacă în UTC, cu `Z` la coadă, indiferent de fusul serverului.
  options: '-c timezone=UTC',
})

pool.on('error', (err) => console.error('PG pool error', err))

export default pool

// ---------------------------------------------------------------------------
// Interogări
// ---------------------------------------------------------------------------

/** Executor: fie pool-ul, fie conexiunea unei tranzacții în curs. */
export interface Executor {
  query: PoolClient['query']
}

/** Toate rândurile. */
export async function multe<T extends QueryResultRow>(
  ex: Executor,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const { rows } = await ex.query<T>(text, values)
  return rows
}

/** Primul rând, sau `null`. */
export async function unuSauNimic<T extends QueryResultRow>(
  ex: Executor,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const { rows } = await ex.query<T>(text, values)
  return rows[0] ?? null
}

/**
 * Primul rând, altfel 404.
 *
 * `ce` este substantivul din mesaj: „Clientul nu a fost găsit.” Rutele nu mai
 * scriu fiecare propriul `if (!rows[0]) res.status(404)…`, iar mesajele rămân
 * la fel peste tot.
 */
export async function unu<T extends QueryResultRow>(
  ex: Executor,
  text: string,
  values: unknown[],
  ce: string,
): Promise<T> {
  const rand = await unuSauNimic<T>(ex, text, values)
  if (!rand) throw eroareNegasit(ce)
  return rand
}

/**
 * Rulează totul într-o singură tranzacție.
 *
 * Antetul unei încasări și liniile ei nu au voie să existe pe jumătate: un bon
 * fără linii nu înseamnă nimic, iar o ședință stinsă de o linie a cărei
 * încasare lipsește ar rămâne plătită de nimeni. La orice excepție se face
 * ROLLBACK și baza rămâne exact cum era.
 */
export async function tranzactie<T>(lucreaza: (ex: Executor) => Promise<T>): Promise<T> {
  const conexiune = await pool.connect()
  try {
    await conexiune.query('BEGIN')
    const rezultat = await lucreaza(conexiune)
    await conexiune.query('COMMIT')
    return rezultat
  } catch (e) {
    await conexiune.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    conexiune.release()
  }
}

// ---------------------------------------------------------------------------
// Construcția interogărilor dintr-un obiect
// ---------------------------------------------------------------------------

function colSafe(k: string) {
  return /^[a-z_][a-z0-9_]*$/.test(k)
}

/**
 * Păstrează din corpul cererii doar câmpurile pe care ruta le acceptă.
 *
 * Fără ea, `dynamicInsert('client', req.body)` scrie ORICE coloană trimisă de
 * client: un POST cu `{"nume":"X","arhivat_la":"2020-01-01"}` creează o fișă
 * născută arhivată, iar un PATCH cu `{"id":"…"}` mută rândul peste altul.
 * Lista de câmpuri permise stă lângă fiecare rută, ca parte din contractul ei.
 */
export function alege<T extends Record<string, unknown>>(
  date: T,
  permise: readonly string[],
): Record<string, unknown> {
  const rezultat: Record<string, unknown> = {}
  for (const cheie of permise) {
    if (Object.hasOwn(date, cheie) && date[cheie] !== undefined) rezultat[cheie] = date[cheie]
  }
  return rezultat
}

export function dynamicInsert(table: string, data: Record<string, unknown>) {
  const entries = Object.entries(data).filter(([k]) => colSafe(k))
  const cols = entries.map(([k]) => `"${k}"`).join(', ')
  const vals = entries.map((_, i) => `$${i + 1}`).join(', ')
  return {
    text: `INSERT INTO "${table}" (${cols}) VALUES (${vals}) RETURNING *`,
    values: entries.map(([, v]) => v)
  }
}

export function dynamicUpdate(table: string, data: Record<string, unknown>, whereCol: string, whereVal: unknown) {
  const entries = Object.entries(data).filter(([k]) => colSafe(k))
  // Un PATCH gol nu este o eroare de server, ci o cerere fără conținut.
  if (!entries.length) throw eroareValidare('Nu ai trimis niciun câmp de modificat.')
  const set = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ')
  return {
    text: `UPDATE "${table}" SET ${set} WHERE "${whereCol}" = $${entries.length + 1} RETURNING *`,
    values: [...entries.map(([, v]) => v), whereVal]
  }
}
