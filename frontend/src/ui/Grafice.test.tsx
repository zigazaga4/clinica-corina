import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardGrafic, formateazaAxa, GraficBare, gradatii } from './Grafice'

describe('axa', () => {
  it('pași rotunzi, de la zero până peste maxim, cel mult șase linii', () => {
    expect(gradatii(0)).toEqual([0])
    expect(gradatii(9_300)).toEqual([0, 2500, 5000, 7500, 10000])
    expect(gradatii(152_000)).toEqual([0, 50_000, 100_000, 150_000, 200_000])
    expect(gradatii(7)).toEqual([0, 2, 4, 6, 8])
    for (const maxim of [1, 13, 99, 1234.5, 87_654]) {
      const axa = gradatii(maxim)
      expect(axa.at(-1)).toBeGreaterThanOrEqual(maxim)
      expect(axa.length).toBeLessThanOrEqual(6)
    }
  })

  it('unitatea o alege plafonul axei, nu fiecare gradație', () => {
    expect(formateazaAxa(7500, 7500)).toBe('7.500')
    expect(formateazaAxa(7500, 10_000)).toBe('7,5 mii')
    expect(formateazaAxa(0, 10_000)).toBe('0')
    expect(formateazaAxa(15_000_000, 20_000_000)).toBe('15 mil.')
  })
})

describe('barele orizontale', () => {
  it('coada se strânge în „Altele”, care nu intră în scară', () => {
    const randuri = Array.from({ length: 12 }, (_, i) => ({
      cheie: String(i),
      eticheta: `Serviciul ${i + 1}`,
      valoare: 100 - i,
    }))
    render(<GraficBare randuri={randuri} formateaza={String} maxim={5} detaliuAltele={(n) => `încă ${n}`} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.getByText('Altele')).toBeInTheDocument()
    expect(screen.getByText('încă 7')).toBeInTheDocument()
    // Suma celor șapte strânse, scrisă fără bară.
    expect(screen.getByText(String([95, 94, 93, 92, 91, 90, 89].reduce((a, b) => a + b)))).toBeInTheDocument()
  })
})

describe('cardul graficului', () => {
  it('butonul „Tabel” arată aceleași cifre ca tabel, iar „Grafic” întoarce graficul', () => {
    render(
      <CardGrafic
        titlu="Probă"
        tabel={{ antete: ['Nume', 'Suma'], laDreapta: [1], randuri: [{ cheie: 'a', celule: ['A', '10'] }] }}
      >
        <p>graficul</p>
      </CardGrafic>,
    )
    expect(screen.getByText('graficul')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tabel' }))
    const tabel = screen.getByRole('table')
    expect(within(tabel).getByRole('cell', { name: '10' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Grafic' }))
    expect(screen.getByText('graficul')).toBeInTheDocument()
  })
})
