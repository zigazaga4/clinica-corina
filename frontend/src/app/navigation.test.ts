import { expect, it } from 'vitest'
import { esteInElement, NAVIGARE, navigarePentru } from './navigation'

const element = (cale: string) => NAVIGARE.find((e) => e.cale === cale)!

it('elementul curent se află pe segmente, nu pe prefix de text', () => {
  // „/statisticile-mele” începe cu „/statistici”, dar nu este în ea.
  expect(esteInElement('/statisticile-mele', element('/statistici'))).toBe(false)
  expect(esteInElement('/statisticile-mele', element('/statisticile-mele'))).toBe(true)
  expect(esteInElement('/statistici', element('/statistici'))).toBe(true)
  // Ruta cu copii rămâne în elementul ei: fișa unui client este tot „Clienți”.
  expect(esteInElement('/clienti/abc-123', element('/clienti'))).toBe(true)
})

it('„Statisticile mele” se vede pentru orice rol, fără parola statisticilor', () => {
  for (const esteAdministrator of [true, false]) {
    expect(navigarePentru(esteAdministrator).some((e) => e.cale === '/statisticile-mele')).toBe(true)
  }
})
