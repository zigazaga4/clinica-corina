import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CampOra, oreDinPas } from './CampOra'

/*
  Ora cu minutul exact.

  Recepția cere „09:43” când o clientă sună din mașină: lista din sfert în
  sfert nu poate da asta, deci „Altă oră…” deschide un câmp de oră. Testele
  merg pe un părinte care ține valoarea, ca în formularul real — câmpul este
  controlat, și tocmai starea lui intermediară (cifre tastate pe jumătate) e
  partea cu riscuri.
*/

function Gazda({ initial }: { initial: string }) {
  const [ora, setOra] = useState(initial)
  return (
    <>
      <CampOra eticheta="Ora" obligatoriu value={ora} onChange={setOra} />
      <output data-testid="valoare">{ora}</output>
    </>
  )
}

const valoare = () => screen.getByTestId('valoare').textContent

describe('oreDinPas', () => {
  it('face lista din sfert în sfert, de la 06:00 la 22:00', () => {
    const ore = oreDinPas()
    expect(ore[0]).toBe('06:00')
    expect(ore[1]).toBe('06:15')
    expect(ore.at(-1)).toBe('22:00')
    expect(ore).toHaveLength(65)
  })
})

describe('CampOra', () => {
  it('pornește ca listă, cu ora curentă aleasă', () => {
    render(<Gazda initial="10:30" />)
    const lista = screen.getByLabelText(/^Ora/) as HTMLSelectElement
    expect(lista.tagName).toBe('SELECT')
    expect(lista).toHaveValue('10:30')
  })

  it('alege o oră din listă', () => {
    render(<Gazda initial="10:30" />)
    fireEvent.change(screen.getByLabelText(/^Ora/), { target: { value: '14:45' } })
    expect(valoare()).toBe('14:45')
  })

  it('„Altă oră…” deschide câmpul liber, în care se scrie 09:43', () => {
    render(<Gazda initial="10:30" />)
    fireEvent.change(screen.getByLabelText(/^Ora/), { target: { value: '__alta_ora__' } })

    const liber = screen.getByLabelText(/^Ora/) as HTMLInputElement
    expect(liber.tagName).toBe('INPUT')
    expect(liber.type).toBe('time')
    // Ora de dinainte rămâne în câmp: se corectează, nu se scrie de la zero.
    expect(liber).toHaveValue('10:30')

    fireEvent.change(liber, { target: { value: '09:43' } })
    expect(valoare()).toBe('09:43')
    expect(screen.getByLabelText(/^Ora/)).toHaveValue('09:43')
  })

  it('o oră care nu e în listă (14:07) se vede ca atare, nu înlocuită cu una apropiată', () => {
    render(<Gazda initial="14:07" />)
    const liber = screen.getByLabelText(/^Ora/) as HTMLInputElement
    expect(liber.tagName).toBe('INPUT')
    expect(liber).toHaveValue('14:07')
    expect(valoare()).toBe('14:07')
  })

  it('o oră începută și nefinalizată nu strică valoarea de dinainte', () => {
    render(<Gazda initial="14:07" />)
    // Câmpul de oră raportează „gol” cât timp ora nu e completă.
    fireEvent.change(screen.getByLabelText(/^Ora/), { target: { value: '' } })
    expect(valoare()).toBe('14:07')
  })

  it('„Alege din listă” rotunjește ora liberă la cel mai apropiat sfert', () => {
    render(<Gazda initial="14:07" />)
    fireEvent.click(screen.getByRole('button', { name: 'Alege din listă' }))

    const lista = screen.getByLabelText(/^Ora/) as HTMLSelectElement
    expect(lista.tagName).toBe('SELECT')
    expect(lista).toHaveValue('14:00')
    expect(valoare()).toBe('14:00')
  })

  it('rotunjirea în sus trece la sfertul următor (14:08 -> 14:15)', () => {
    render(<Gazda initial="14:08" />)
    fireEvent.click(screen.getByRole('button', { name: 'Alege din listă' }))
    expect(valoare()).toBe('14:15')
  })
})
