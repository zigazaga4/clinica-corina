import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { numeCurat, numeFisier, salveazaAcord } from './descarca'

// În probe aplicația nu rulează în Tauri, deci `salveazaAcord` ia drumul
// browserului. Numele fișierului este însă acelaşi pe ambele drumuri, iar el
// este partea care poate strica scrierea pe Windows.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => false) }))
// Partea de Windows, prefăcută: dosarele cu despărțitorul lui, scrierea spionată.
vi.mock('@tauri-apps/api/path', () => ({
  documentDir: async () => 'C:\\Users\\Recepție\\Documents',
  downloadDir: async () => 'C:\\Users\\Recepție\\Downloads',
  join: async (...parti: string[]) => parti.join('\\'),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }))

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(false)
  vi.mocked(mkdir).mockReset()
  vi.mocked(writeFile).mockReset()
})

describe('salvarea în aplicația instalată', () => {
  const pdf = () => new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' })

  it('scrie în Documente › Acorduri GDPR, cu calea întreagă', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const salvat = await salveazaAcord(pdf(), 'Laura Bavela', '2026-11-16T16:42:37Z')

    expect(mkdir).toHaveBeenCalledWith('C:\\Users\\Recepție\\Documents\\Acorduri GDPR', { recursive: true })
    const cale = 'C:\\Users\\Recepție\\Documents\\Acorduri GDPR\\Laura Bavela - 2026-11-16.pdf'
    expect(vi.mocked(writeFile).mock.calls[0]![0]).toBe(cale)
    expect(salvat).toEqual({ nume: 'Laura Bavela - 2026-11-16.pdf', cale, loc: 'Documente › Acorduri GDPR' })
  })

  it('dacă Documente e refuzat, acordul ajunge în Descărcări', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    // Tauri respinge cu text simplu, nu cu `Error`.
    vi.mocked(writeFile).mockRejectedValueOnce('forbidden path: C:\\Users\\Recepție\\Documents')
    const salvat = await salveazaAcord(pdf(), 'Laura Bavela', '2026-11-16T16:42:37Z')

    expect(salvat.loc).toBe('Descărcări')
    expect(salvat.cale).toBe('C:\\Users\\Recepție\\Downloads\\Laura Bavela - 2026-11-16.pdf')
  })
})

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
