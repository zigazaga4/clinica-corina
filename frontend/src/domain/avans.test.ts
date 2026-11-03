import { describe, expect, it } from 'vitest'
import { incasatPeAbonament, maiDeIncasatPeAbonament, seStingeDinAvans } from './avans'

describe('avansul pe abonament', () => {
  it('încasat în total = ședințele plătite + avansul neconsumat', () => {
    expect(incasatPeAbonament({ incasat: 250, avans: 750 })).toBe(1000)
    expect(incasatPeAbonament({ incasat: 0.1, avans: 0.2 })).toBe(0.3)
  })

  it('cât mai poate primi: totalul minus ce e încasat, niciodată sub zero', () => {
    expect(maiDeIncasatPeAbonament({ pret_total: 1000, incasat: 250, avans: 500 })).toBe(250)
    expect(maiDeIncasatPeAbonament({ pret_total: 1000, incasat: 500, avans: 500 })).toBe(0)
    // Prețul total scăzut după încasare: nu iese o sumă negativă.
    expect(maiDeIncasatPeAbonament({ pret_total: 400, incasat: 250, avans: 500 })).toBe(0)
  })

  it('o ședință se stinge din avans doar dacă avansul o acoperă întreagă', () => {
    const sedinta = { achitat: false, tratament_id: 't1', tratament_avans: 250, pret: 250 }
    expect(seStingeDinAvans(sedinta)).toBe(true)
    expect(seStingeDinAvans({ ...sedinta, tratament_avans: 249.99 })).toBe(false)
    expect(seStingeDinAvans({ ...sedinta, achitat: true })).toBe(false)
    expect(seStingeDinAvans({ ...sedinta, tratament_id: null })).toBe(false)
    expect(seStingeDinAvans({ ...sedinta, pret: 0 })).toBe(false)
  })
})
