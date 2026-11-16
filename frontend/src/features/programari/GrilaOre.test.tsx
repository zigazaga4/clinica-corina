import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GrilaOre, type ColoanaGrila, type LocGrila } from './GrilaOre'
import {
  ORA_INCEPUT,
  ORA_SFARSIT,
  PIXELI_PE_ORA,
  PIXELI_PE_ORA_MARE,
  inaltimeGrila,
  minutLaPozitie,
} from './constante'

/*
  Programarea direct din grilă: apăsare pe un loc liber, sau tragere cu mouse-ul.

  jsdom nu așază nimic: orice element are dreptunghiul la 0, deci `clientY`
  este chiar distanța de la vârful grilei — 8:00. O oră are `PIXELI_PE_ORA`.
*/

const ZI = new Date(2026, 9, 6) // marți, 6 octombrie 2026

/** Pixelul (în grilă) la care cade ora `h:m`. */
const la = (h: number, m = 0) => ((h - 8) * 60 + m) * (PIXELI_PE_ORA / 60)

function grila(onProgrameaza?: (loc: LocGrila) => void, coloana: Partial<ColoanaGrila> = {}) {
  const { container } = render(
    <GrilaOre
      coloane={[{ id: 'c', eticheta: 'Marți', zi: ZI, programari: [], executantId: 'u-1', ...coloana }]}
      onAlegeProgramare={() => undefined}
      {...(onProgrameaza ? { onProgrameaza } : {})}
    />,
  )
  return container.querySelector<HTMLElement>('[data-strat-selectie]')
}

const mouse = (clientY: number) => ({ clientY, button: 0, pointerId: 1, pointerType: 'mouse' })
const ora = (h: number, m = 0) => new Date(2026, 9, 6, h, m)

describe('programare din grila orară', () => {
  it('o apăsare alege sfertul de sub cursor, cu persoana coloanei', () => {
    const alege = vi.fn()
    const strat = grila(alege)!
    // 10:20 cade în sfertul 10:15.
    fireEvent.pointerDown(strat, mouse(la(10, 20)))
    fireEvent.pointerUp(strat, mouse(la(10, 20)))

    expect(alege).toHaveBeenCalledTimes(1)
    const loc = alege.mock.calls[0]![0] as LocGrila
    expect(loc.inceput).toEqual(ora(10, 15))
    // Doar apăsat: durata o hotărăște serviciul, în formular.
    expect(loc.sfarsit).toBeNull()
    expect(loc.coloana.executantId).toBe('u-1')
  })

  it('tras în jos alege intervalul întreg, cu ultimul sfert inclus', () => {
    const alege = vi.fn()
    const strat = grila(alege)!
    fireEvent.pointerDown(strat, mouse(la(10)))
    fireEvent.pointerMove(strat, mouse(la(11, 35)))
    // Cât se trage, intervalul se vede, cu orele lui.
    expect(strat).toHaveTextContent('10:00 – 11:45')
    fireEvent.pointerUp(strat, mouse(la(11, 35)))

    const loc = alege.mock.calls[0]![0] as LocGrila
    expect(loc.inceput).toEqual(ora(10))
    expect(loc.sfarsit).toEqual(ora(11, 45))
  })

  it('tras în sus dă același interval', () => {
    const alege = vi.fn()
    const strat = grila(alege)!
    fireEvent.pointerDown(strat, mouse(la(11, 35)))
    fireEvent.pointerMove(strat, mouse(la(10)))
    fireEvent.pointerUp(strat, mouse(la(10)))

    const loc = alege.mock.calls[0]![0] as LocGrila
    expect(loc.inceput).toEqual(ora(10))
    expect(loc.sfarsit).toEqual(ora(11, 45))
  })

  it('mouse-ul fără apăsare arată doar sfertul, fără să programeze', () => {
    const alege = vi.fn()
    const strat = grila(alege)!
    fireEvent.pointerMove(strat, mouse(la(14, 40)))
    expect(strat).toHaveTextContent('14:30')
    fireEvent.pointerLeave(strat, mouse(la(14, 40)))
    expect(strat).toHaveTextContent('')
    expect(alege).not.toHaveBeenCalled()
  })

  it('clicul dreapta și derularea cu degetul nu programează', () => {
    const alege = vi.fn()
    const strat = grila(alege)!
    fireEvent.pointerDown(strat, { ...mouse(la(9)), button: 2 })
    fireEvent.pointerUp(strat, { ...mouse(la(9)), button: 2 })

    // Pe ecranul tactil, tragerea derulează: browserul trimite `pointercancel`.
    const deget = { clientY: la(9), button: 0, pointerId: 2, pointerType: 'touch' }
    fireEvent.pointerDown(strat, deget)
    fireEvent.pointerCancel(strat, deget)

    expect(alege).not.toHaveBeenCalled()
  })

  it('o atingere scurtă programează, ca o apăsare', () => {
    const alege = vi.fn()
    const strat = grila(alege)!
    const deget = { clientY: la(16), button: 0, pointerId: 3, pointerType: 'touch' }
    fireEvent.pointerDown(strat, deget)
    fireEvent.pointerUp(strat, deget)
    expect((alege.mock.calls[0]![0] as LocGrila).inceput).toEqual(ora(16))
  })

  it('coloana notițelor clinicii nu primește programări', () => {
    expect(grila(vi.fn(), { doarNotite: true })).toBeNull()
  })

  it('fără `onProgrameaza`, grila rămâne doar de citit', () => {
    expect(grila()).toBeNull()
  })
})

describe('minutLaPozitie', () => {
  it('rotunjește în jos la sfert și rămâne în grilă', () => {
    expect(minutLaPozitie(0)).toBe(0)
    expect(minutLaPozitie(la(8, 14))).toBe(0)
    expect(minutLaPozitie(la(8, 15))).toBe(15)
    expect(minutLaPozitie(-40)).toBe(0)
    // Ultimul sfert începe cu un pas înainte de închidere (21:45): un interval
    // nu poate ieși din grilă.
    expect(minutLaPozitie(la(ORA_SFARSIT + 1))).toBe((ORA_SFARSIT - ORA_INCEPUT) * 60 - 15)
  })
})

/*
  Ziua „mare” de pe telefon (cerința Corinei, 13 nov. 2026): ore înalte, text
  mare, blocuri pe toată lățimea. Din 16 nov. 2026 golul se apasă pentru o
  programare nouă, ca pe calculator; derularea cu degetul tot nu deschide nimic.
*/
describe('ziua mare', () => {
  const mare = (onProgrameaza?: (loc: LocGrila) => void) =>
    render(
      <GrilaOre
        mare
        coloane={[{ id: 'ziua', eticheta: 'Marți', zi: ZI, programari: [], executantId: 'u-1' }]}
        onAlegeProgramare={() => undefined}
        {...(onProgrameaza ? { onProgrameaza } : {})}
      />,
    ).container

  it('o atingere pe gol programează la ora de sub deget, pe orele înalte', () => {
    const alege = vi.fn()
    const strat = mare(alege).querySelector<HTMLElement>('[data-strat-selectie]')!
    // 14:40 pe orele de 96px cade în sfertul 14:30 — nu în cel de pe grila mică.
    const y = ((14 - 8) * 60 + 40) * (PIXELI_PE_ORA_MARE / 60)
    const deget = { clientY: y, button: 0, pointerId: 4, pointerType: 'touch' }
    fireEvent.pointerDown(strat, deget)
    fireEvent.pointerUp(strat, deget)
    expect((alege.mock.calls[0]![0] as LocGrila).inceput).toEqual(ora(14, 30))
  })

  it('derularea cu degetul nu programează', () => {
    const alege = vi.fn()
    const strat = mare(alege).querySelector<HTMLElement>('[data-strat-selectie]')!
    const deget = { clientY: 200, button: 0, pointerId: 5, pointerType: 'touch' }
    fireEvent.pointerDown(strat, deget)
    fireEvent.pointerCancel(strat, deget)
    expect(alege).not.toHaveBeenCalled()
  })

  it('fără `onProgrameaza` rămâne doar de citit', () => {
    expect(mare().querySelector('[data-strat-selectie]')).toBeNull()
  })

  it('are ore de 96px, nu de 56px: toată ziua, de la 8:00 la 22:00', () => {
    expect(mare().querySelector(`[style*="height: ${inaltimeGrila(PIXELI_PE_ORA_MARE)}px"]`)).not.toBeNull()
    expect(mare().querySelector(`[style*="height: ${inaltimeGrila(PIXELI_PE_ORA)}px"]`)).toBeNull()
  })

  it('desenează și jumătățile de oră, punctate', () => {
    // Câte una pentru fiecare oră plină a zilei (8:30 … 21:30).
    expect(mare().querySelectorAll('.border-dashed')).toHaveLength(ORA_SFARSIT - ORA_INCEPUT)
  })

  it('programul ajunge la 22:00: ultima oră de pe coloană e 22:00', () => {
    expect(ORA_SFARSIT).toBe(22)
    expect(mare().textContent).toContain('22:00')
  })
})
