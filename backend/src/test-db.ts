/**
 * Verificarea legăturii cu baza — `npm run test:db`.
 *
 * Prima întrebare când ceva nu merge este „serverul chiar vede baza, și baza
 * chiar are schema?”. Scriptul răspunde la amândouă și spune pe ce se
 * conectează, fără parolă în ieșire.
 */

import 'dotenv/config'
import pool, { multe } from './lib/db.js'

/*
  Lista se ține la zi cu `01_schema.sql`.

  Nu este o formalitate: verificarea citește fiecare obiect cu rolul aplicației,
  deci prinde și tabela care lipsește, și pe cea creată din greșeală de alt rol —
  cazul în care obiectul există, dar aplicația primește „permission denied”.
  Un obiect uitat aici înseamnă un ecran care cade abia la client.
*/
const TABELE = [
  'utilizator', 'punct_lucru', 'articol', 'client', 'nota_client',
  'programare', 'vanzare', 'vanzare_linie',
  'abonament', 'abonament_sedinta', 'plata',
  'sesiune', 'jurnal_operatiuni',
  'consimtamant', 'notita', 'tratament',
  'cheltuiala', 'parola_statistici', 'program_lucru',
]

const VEDERI = [
  'v_client_detaliu', 'v_programare_detaliu',
  'v_vanzare_detaliu', 'v_vanzare_linie_detaliu',
  'v_consimtamant_detaliu', 'v_notita_detaliu', 'v_tratament_detaliu',
  'v_cheltuiala_detaliu',
]

/** Adresa de conectare, fără parolă — ieșirea ajunge des într-un e-mail. */
function undeSuntem(): string {
  try {
    const u = new URL(process.env.DATABASE_URL!)
    return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`
  } catch {
    return '(DATABASE_URL nu este o adresă validă)'
  }
}

async function ruleaza(): Promise<void> {
  console.log(`\n=== Legătura cu baza de date ===\n${undeSuntem()}\n`)

  const verificari: { nume: string; ok: boolean; detaliu: string }[] = []

  for (const obiect of [...TABELE, ...VEDERI]) {
    try {
      const [rand] = await multe<{ numar: number }>(
        pool, `SELECT count(*)::bigint AS numar FROM ${obiect}`,
      )
      verificari.push({ nume: obiect, ok: true, detaliu: `${rand?.numar ?? 0} rânduri` })
    } catch (e) {
      verificari.push({ nume: obiect, ok: false, detaliu: (e as Error).message })
    }
  }

  // Constrângerile pe care se sprijină regulile de business. Absente, serverul
  // pornește și pare să meargă — până când o ședință se încasează de două ori.
  const constrangeri = [
    'vanzare_linie_programare_uk',
    'articol_durata_ck',
    'utilizator_email_uk',
    'articol_sedinte_ck',
    'tratament_articol_fk',
    // Semnul migrației 2026-09-29: fără ea, vânzările nu pot rămâne neachitate.
    'vanzare_neachitata_idx',
    // Semnul migrației cu mai multe servicii într-o programare.
    'programare_vizita_idx',
    // Semnul migrației statisticilor: fără ele, profitul ar primi cheltuieli de zero lei.
    'cheltuiala_suma_ck',
    'cheltuiala_data_idx',
    // Semnul migrației 2026-10-04: fără ea, produsele n-au liste de prețuri.
    'articol_categorie_ck',
    // Semnul migrației 2026-10-08: fără ea, abonamentele nu țin minte reducerea.
    'tratament_pret_lista_ck',
  ]
  const gasite = await multe<{ conname: string }>(
    pool,
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1)
     UNION SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
    [constrangeri],
  )
  const numeGasite = new Set(gasite.map((c) => c.conname))
  for (const c of constrangeri) {
    verificari.push({
      nume: c,
      ok: numeGasite.has(c),
      detaliu: numeGasite.has(c) ? 'prezentă' : 'LIPSEȘTE — rulează sql/01_schema.sql',
    })
  }

  /*
    Din 2026-10-01 aceeași persoană poate avea programări suprapuse: vechea
    constrângere trebuie să LIPSEASCĂ, altfel a doua programare cade cu 409.
  */
  const [suprapunere] = await multe<{ conname: string }>(
    pool,
    `SELECT conname FROM pg_constraint WHERE conname = 'programare_fara_suprapunere'`,
  )
  verificari.push({
    nume: 'programări suprapuse permise',
    ok: !suprapunere,
    detaliu: suprapunere
      ? 'CONSTRÂNGEREA VECHE — rulează sql/migratii/2026-10-01-programari-suprapuse.sql'
      : 'aceeași persoană poate avea mai multe programări la aceeași oră',
  })

  const lat = (s: string, n: number) => s.padEnd(n)
  console.log(lat('Obiect', 32), lat('Stare', 8), 'Detaliu')
  console.log('─'.repeat(78))
  for (const v of verificari) console.log(lat(v.nume, 32), lat(v.ok ? '✓' : '✗', 8), v.detaliu)

  const esuate = verificari.filter((v) => !v.ok)
  console.log(`\n${verificari.length - esuate.length}/${verificari.length} verificări trecute`)
  if (esuate.length) process.exitCode = 1
}

ruleaza()
  .catch((e) => {
    console.error('\nNu m-am putut conecta:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => pool.end())
