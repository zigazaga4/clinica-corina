import { expect, it } from 'vitest'
import { esteInElement, NAVIGARE, navigarePentru } from './navigation'

const element = (cale: string) => NAVIGARE.find((e) => e.cale === cale)!

it('elementul curent se află pe segmente, nu pe prefix de text', () => {
  // „/statistici-vechi” începe cu „/statistici”, dar nu este în ea.
  expect(esteInElement('/statistici-vechi', element('/statistici'))).toBe(false)
  expect(esteInElement('/sedinte-pe-persoane', element('/sedinte-pe-persoane'))).toBe(true)
  expect(esteInElement('/statistici', element('/statistici'))).toBe(true)
  // Ruta cu copii rămâne în elementul ei: fișa unui client este tot „Clienți”.
  expect(esteInElement('/clienti/abc-123', element('/clienti'))).toBe(true)
})

it('„Ședințe pe persoane” se vede pentru orice rol — parola statisticilor, nu rolul, hotărăște', () => {
  for (const esteAdministrator of [true, false]) {
    expect(navigarePentru(esteAdministrator).some((e) => e.cale === '/sedinte-pe-persoane')).toBe(true)
  }
  // Fostul nume nu mai e în meniu: un semn de carte vechi doar redirecționează.
  expect(NAVIGARE.some((e) => e.cale === '/statisticile-mele')).toBe(false)
})
