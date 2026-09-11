import { describe, expect, it, vi } from 'vitest'
import { numeCurat, numeFisier } from './descarca'

// În probe aplicația nu rulează în Tauri, deci `salveazaAcord` ia drumul
// browserului. Numele fișierului este însă acelaşi pe ambele drumuri, iar el
// este partea care poate strica scrierea pe Windows.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))

describe('numele fișierului', () => {
  it('păstrează diacriticele și spațiile din numele clientului', () => {
    // Un nume românesc nu are de ce să fie stâlcit: Windows le acceptă.
    expect(numeCurat('Ștefan Mureșan')).toBe('Ștefan Mureșan')
  })

  it('înlocuiește semnele pe care Windows le refuză', () => {
    /*
      \ / : * ? " < > sunt interzise în numele fișierelor pe Windows. Lăsate
      așa, scrierea ar fi picat cu o eroare de sistem de nedeslușit, iar
      acordul nu s-ar fi salvat — pentru un client numit „Ion/Maria”.
    */
    expect(numeCurat('Ion/Maria: "cea mică" <3')).toBe('Ion-Maria- -cea mică- -3')
  })

  it('nu lasă punct la sfârșit', () => {
    // Windows taie singur punctele de la capăt; numele salvat ar fi fost
    // altul decât cel arătat omului.
    expect(numeCurat('Gheorghe Jr.')).toBe('Gheorghe Jr')
  })

  it('nu rămâne niciodată gol', () => {
    expect(numeCurat('...')).toBe('acord')
    expect(numeCurat('   ')).toBe('acord')
  })

  it('scurtează numele absurd de lungi', () => {
    expect(numeCurat('A'.repeat(300)).length).toBe(80)
  })

  it('pune data în nume, ca fișierele să se așeze în ordine', () => {
    expect(numeFisier('Gabriela Nistor', '2026-09-11T12:15:59.980Z')).toBe(
      'Gabriela Nistor - 2026-09-11.pdf',
    )
  })

  it('nu se sufocă dacă data lipsește', () => {
    expect(numeFisier('Ana Pop', 'nu-i o dată')).toBe('Ana Pop - fara-data.pdf')
  })
})
