// One-time script: set initial passwords for seed accounts
// Run with: npx tsx src/setup-passwords.ts
import 'dotenv/config'
import argon2 from 'argon2'
import pool from './lib/db.js'

// Adresele sunt cele scrise de `npm run seed`. Schimbate acolo, se schimbă și aici.
const accounts = [
  { email: 'admin@clinica.ro', password: 'Admin2026!' },
  { email: 'andreea.popescu@clinica.ro', password: 'Andreea2026!' },
  { email: 'mihaela.stan@clinica.ro', password: 'Mihaela2026!' },
]

async function run() {
  for (const acc of accounts) {
    const hash = await argon2.hash(acc.password)
    const { rowCount } = await pool.query(
      `UPDATE utilizator SET parola_hash = $1 WHERE lower(email) = lower($2)`,
      [hash, acc.email]
    )
    if (rowCount) console.log(`✓ ${acc.email}  →  password set`)
    else          console.error(`✗ ${acc.email}: not found`)
  }
  console.log('\nDone. Change these passwords before going live.')
  await pool.end()
}

run().catch(e => { console.error(e); process.exit(1) })
