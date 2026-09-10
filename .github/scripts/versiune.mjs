#!/usr/bin/env node
/**
 * Scrie numărul versiunii în toate fișierele care îl poartă.
 *
 * Sunt patru, și trebuie să spună același lucru. Cel care contează cu adevărat
 * este `tauri.conf.json`: de acolo își ia programul instalat versiunea proprie,
 * iar ea este comparată cu ce scrie în `latest.json`. Dacă rămâne în urmă,
 * aplicația se va crede veche la nesfârșit și va cere aceeași actualizare după
 * fiecare repornire.
 *
 * Folosit din `.github/workflows/windows.yml`. Se rulează din rădăcina
 * depozitului: `node .github/scripts/versiune.mjs 0.2.0`
 */
import { readFileSync, writeFileSync } from 'node:fs'

const versiune = process.argv[2]

if (!/^\d+\.\d+\.\d+$/.test(versiune ?? '')) {
  console.error(`Versiunea „${versiune ?? ''}” nu are forma 1.2.3.`)
  process.exit(1)
}

/** Rescrie un fișier JSON păstrându-i forma (două spații, linie nouă la final). */
function rescrieJson(cale, schimba) {
  const continut = JSON.parse(readFileSync(cale, 'utf8'))
  schimba(continut)
  writeFileSync(cale, `${JSON.stringify(continut, null, 2)}\n`)
}

rescrieJson('frontend/package.json', (p) => {
  p.version = versiune
})

// Fișierul de blocare poartă și el versiunea proiectului, în două locuri. Dacă
// nu se potrivesc, `npm ci` refuză să pornească la următoarea compilare.
rescrieJson('frontend/package-lock.json', (l) => {
  l.version = versiune
  if (l.packages?.['']) l.packages[''].version = versiune
})

rescrieJson('frontend/src-tauri/tauri.conf.json', (t) => {
  t.version = versiune
})

const caleCargo = 'frontend/src-tauri/Cargo.toml'
const cargo = readFileSync(caleCargo, 'utf8')
// Doar prima linie `version = "..."`, cea din secțiunea [package]. Ancora `^`
// cu `m` o prinde pe ea; `rust-version` are alt nume, deci nu e atinsă.
const rescris = cargo.replace(/^version = ".*"$/m, `version = "${versiune}"`)
if (rescris === cargo) {
  console.error(`Nu am găsit linia de versiune în ${caleCargo}.`)
  process.exit(1)
}
writeFileSync(caleCargo, rescris)

console.log(`Versiunea ${versiune} scrisă în cele patru fișiere.`)
