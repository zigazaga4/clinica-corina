#!/usr/bin/env node
/**
 * Pregătește cele două fișiere care se publică: instalatorul și `latest.json`.
 *
 * `latest.json` este tot ce citește aplicația instalată. Conține versiunea,
 * adresa instalatorului și semnătura lui. Semnătura este produsă la compilare
 * cu cheia privată din secretele depozitului, iar aplicația o verifică cu cheia
 * publică din `tauri.conf.json` înainte de a porni orice. Un fișier pus acolo
 * de altcineva nu trece de verificare.
 *
 * Se rulează din rădăcina depozitului:
 *   node .github/scripts/manifest.mjs 0.2.0 "Ce s-a schimbat"
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

const versiune = process.argv[2]
const note = process.argv[3]?.trim() || 'Îmbunătățiri și corectări.'

const DEPOZIT = 'zigazaga4/clinica-actualizari'
const DOSAR = 'frontend/src-tauri/target/release/bundle/nsis'

if (!/^\d+\.\d+\.\d+$/.test(versiune ?? '')) {
  console.error(`Versiunea „${versiune ?? ''}” nu are forma 1.2.3.`)
  process.exit(1)
}

// Numele dat de Tauri conține un spațiu, fiindcă produsul se numește
// „Gestiune Clinica”. GitHub înlocuiește spațiile cu puncte în numele
// fișierelor atașate unei publicări, așa că adresa scrisă aici nu ar mai
// nimeri fișierul. Îl redenumim înainte de urcare, ca adresa să fie sigură.
const numeTauri = `Gestiune Clinica_${versiune}_x64-setup.exe`
const nume = `GestiuneClinica_${versiune}_x64-setup.exe`

const vechi = `${DOSAR}/${numeTauri}`
const nou = `${DOSAR}/${nume}`

for (const cale of [vechi, `${vechi}.sig`]) {
  if (!existsSync(cale)) {
    console.error(`Lipsește ${cale}.`)
    console.error(
      'Semnătura lipsă înseamnă că nu s-a compilat cu cheia privată. Verifică' +
        ' secretele TAURI_SIGNING_PRIVATE_KEY și TAURI_SIGNING_PRIVATE_KEY_PASSWORD.',
    )
    process.exit(1)
  }
}

renameSync(vechi, nou)
renameSync(`${vechi}.sig`, `${nou}.sig`)

const manifest = {
  version: versiune,
  pub_date: new Date().toISOString(),
  notes: note,
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(`${nou}.sig`, 'utf8').trim(),
      url: `https://github.com/${DEPOZIT}/releases/download/v${versiune}/${nume}`,
    },
  },
}

writeFileSync(`${DOSAR}/latest.json`, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`Pregătit pentru publicare:\n  ${nou}\n  ${DOSAR}/latest.json`)
