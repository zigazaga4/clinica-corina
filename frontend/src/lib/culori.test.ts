import { expect, it } from 'vitest'
import { contrast, luminanta, textPeCuloare } from './culori'

it('luminanța: negru 0, alb 1', () => {
  expect(luminanta('#000000')).toBe(0)
  expect(luminanta('#ffffff')).toBeCloseTo(1, 5)
})

it('contrast: alb pe negru e 21, o culoare cu ea însăși e 1', () => {
  expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 3)
  expect(contrast('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5)
})

it('textul se alege după fundal: alb pe culorile închise, închis pe cele deschise', () => {
  // Culorile din softul vechi al clinicii (mov, roșu închis, portocaliu): text alb.
  expect(textPeCuloare('#7b2a9f')).toBe('#ffffff')
  expect(textPeCuloare('#a52a24')).toBe('#ffffff')
  expect(textPeCuloare('#c44a24')).toBe('#ffffff')
  // Albastrul și roșul obișnuite rămân cu alb, ca peste tot.
  expect(textPeCuloare('#3b82f6')).toBe('#ffffff')
  expect(textPeCuloare('#ef4444')).toBe('#ffffff')
  // Galbenul și verdele deschis nu se citesc cu alb.
  expect(textPeCuloare('#eab308')).not.toBe('#ffffff')
  expect(textPeCuloare('#22c55e')).not.toBe('#ffffff')
  expect(textPeCuloare('#fde047')).not.toBe('#ffffff')
})

it('o valoare care nu e culoare nu strică nimic', () => {
  expect(luminanta('albastru')).toBe(0)
  expect(textPeCuloare('albastru')).toBe('#ffffff')
})
