import { describe, expect, it } from 'vitest'
import {
  calculeazaPerioada,
  eticheteBara,
  formateazaPerioada,
  numeZiSaptamana,
  pasPentru,
  type Preset,
} from './perioade'

/*
  Perioadele și comparațiile lor. Totul se ține de un „azi” fix — marți,
  29 septembrie 2026 — ca rezultatele să nu depindă de ziua rulării.
*/

const AZI = new Date(2026, 8, 29, 15, 30)
const pentru = (preset: Preset, azi = AZI, interval = { de_la: '2026-09-01', pana_la: '2026-09-10' }) =>
  calculeazaPerioada({ preset, interval }, azi)

describe('alegerile obișnuite', () => {
  it('luna aceasta: până azi, comparată cu aceleași zile din luna trecută', () => {
    const r = pentru('luna')
    expect(r.perioada).toEqual({ de_la: '2026-09-01', pana_la: '2026-09-29' })
    expect(r.comparatie).toEqual({ de_la: '2026-08-01', pana_la: '2026-08-29' })
    expect(r.pas).toBe('zi')
  })

  it('pe 31 martie, luna trecută se oprește la sfârșitul lui februarie', () => {
    const r = pentru('luna', new Date(2026, 2, 31))
    expect(r.comparatie).toEqual({ de_la: '2026-02-01', pana_la: '2026-02-28' })
  })

  it('luna trecută: întreagă, comparată cu cea dinainte, întreagă', () => {
    const r = pentru('luna_trecuta')
    expect(r.perioada).toEqual({ de_la: '2026-08-01', pana_la: '2026-08-31' })
    expect(r.comparatie).toEqual({ de_la: '2026-07-01', pana_la: '2026-07-31' })
  })

  it('azi și săptămâna aceasta', () => {
    expect(pentru('azi').perioada).toEqual({ de_la: '2026-09-29', pana_la: '2026-09-29' })
    expect(pentru('azi').comparatie).toEqual({ de_la: '2026-09-28', pana_la: '2026-09-28' })
    // Săptămâna începe lunea.
    expect(pentru('saptamana').perioada).toEqual({ de_la: '2026-09-28', pana_la: '2026-09-29' })
    expect(pentru('saptamana').comparatie).toEqual({ de_la: '2026-09-21', pana_la: '2026-09-22' })
  })

  it('ultimele 12 luni și anii se împart pe luni', () => {
    const douasprezece = pentru('ultimele_12_luni')
    expect(douasprezece.perioada).toEqual({ de_la: '2025-10-01', pana_la: '2026-09-29' })
    expect(douasprezece.comparatie).toEqual({ de_la: '2024-10-01', pana_la: '2025-09-29' })
    expect(douasprezece.pas).toBe('luna')

    expect(pentru('anul').perioada).toEqual({ de_la: '2026-01-01', pana_la: '2026-09-29' })
    expect(pentru('anul').comparatie).toEqual({ de_la: '2025-01-01', pana_la: '2025-09-29' })
    expect(pentru('anul_trecut').perioada).toEqual({ de_la: '2025-01-01', pana_la: '2025-12-31' })
    expect(pentru('anul_trecut').comparatie).toEqual({ de_la: '2024-01-01', pana_la: '2024-12-31' })
  })

  it('un interval ales se compară cu tot atâtea zile chiar dinaintea lui, și se întoarce dacă e scris invers', () => {
    const r = pentru('interval', AZI, { de_la: '2026-09-10', pana_la: '2026-09-01' })
    expect(r.perioada).toEqual({ de_la: '2026-09-01', pana_la: '2026-09-10' })
    expect(r.comparatie).toEqual({ de_la: '2026-08-22', pana_la: '2026-08-31' })
  })
})

describe('mărimea barelor', () => {
  it('zile până la 45, apoi săptămâni până la 200, apoi luni', () => {
    expect(pasPentru({ de_la: '2026-01-01', pana_la: '2026-02-14' })).toBe('zi')
    expect(pasPentru({ de_la: '2026-01-01', pana_la: '2026-02-15' })).toBe('saptamana')
    expect(pasPentru({ de_la: '2026-01-01', pana_la: '2026-07-19' })).toBe('saptamana')
    expect(pasPentru({ de_la: '2026-01-01', pana_la: '2026-07-20' })).toBe('luna')
  })
})

describe('texte', () => {
  it('perioada se scrie cât mai scurt, fără să piardă nimic', () => {
    expect(formateazaPerioada({ de_la: '2026-09-29', pana_la: '2026-09-29' })).toBe('29 septembrie 2026')
    expect(formateazaPerioada({ de_la: '2026-09-01', pana_la: '2026-09-29' })).toBe('1–29 septembrie 2026')
    expect(formateazaPerioada({ de_la: '2026-01-01', pana_la: '2026-09-29' })).toMatch(/^1 ian\.? – 29 sept?\.? 2026$/)
    expect(formateazaPerioada({ de_la: '2025-10-01', pana_la: '2026-09-29' })).toMatch(/2025 – .*2026$/)
  })

  it('sub bară: ziua lunii într-o singură lună, luna scurtă pe un an', () => {
    const luna = { de_la: '2026-09-01', pana_la: '2026-09-29' }
    expect(eticheteBara('2026-09-12', 'zi', luna).eticheta).toBe('12')
    expect(eticheteBara('2026-09-12', 'zi', luna).titlu).toMatch(/12 septembrie/)
    const an = { de_la: '2026-01-01', pana_la: '2026-09-29' }
    expect(eticheteBara('2026-03-01', 'luna', an).titlu).toBe('martie 2026')
    expect(eticheteBara('2026-09-21', 'saptamana', an).titlu).toBe('Săptămâna din 21 septembrie')
  })

  it('zilele săptămânii, după numărul ISO', () => {
    expect(numeZiSaptamana(1, true)).toBe('luni')
    expect(numeZiSaptamana(7, true)).toBe('duminică')
  })
})
