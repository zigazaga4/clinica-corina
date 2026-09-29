import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { magazin } from '@/api/memory/store'
import type { ProgramareDetaliu } from '@/domain/types'
import { autentifica, randeaza } from '@/test/render'
import { DetaliuProgramare } from './DetaliuProgramare'
import { elementeCalendar } from './elemente'
import { ListaAgenda } from './ListaAgenda'

/*
  O programare cu mai multe servicii, așa cum o vede recepția: un singur bloc
  în calendar, o singură fereastră cu toate serviciile și o singură închidere,
  cu câte o sumă pe serviciu și un singur bon.
*/

vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

/** Zi departe de agenda generată, ca să nu se ciocnească de nimic. */
const INCEPUT = new Date(2031, 5, 10, 9, 0)

const serviciul = (denumire: string) => {
  const articol = [...magazin.articol.values()].find((a) => a.denumire === denumire)
  if (!articol) throw new Error(`Nomenclatorul demo nu are „${denumire}”.`)
  return articol
}

/** O programare cu manichiură (80) și pedichiură (110), pentru o clientă nouă. */
async function programareCuDouaServicii(): Promise<ProgramareDetaliu[]> {
  const admin = await autentifica()
  const clienta = await api.clienti.create({ nume: 'Clientă Cu Două Servicii' })
  const prima = await api.programari.create({
    client_id: clienta.id,
    executant_id: admin.id,
    incepe_la: INCEPUT.toISOString(),
    se_termina_la: new Date(INCEPUT.getTime() + 105 * 60_000).toISOString(),
    servicii: [
      { articol_id: serviciul('Manichiură clasică').id, pret: 80 },
      { articol_id: serviciul('Pedichiură clasică').id, pret: 110 },
    ],
  })
  return api.programari.list({ vizita_id: prima.vizita_id })
}

describe('în calendar', () => {
  it('serviciile aceleiași programări sunt un singur element, cu toate numele și suma lor', async () => {
    const servicii = await programareCuDouaServicii()
    const elemente = elementeCalendar(servicii, [])
    expect(elemente).toHaveLength(1)

    render(
      <ListaAgenda zile={[INCEPUT]} programari={servicii} onAlegeProgramare={() => undefined} />,
    )
    expect(screen.getByText('1 programare')).toBeInTheDocument()
    const rand = screen.getByRole('button', { name: /Clientă Cu Două Servicii/ })
    expect(rand).toHaveTextContent('Manichiură clasică + Pedichiură clasică')
    expect(rand).toHaveTextContent('190')
  })
})

describe('în fereastra programării', () => {
  it('arată toate serviciile, oricare ar fi fost apăsat, și le închide pe un singur bon', async () => {
    const servicii = await programareCuDouaServicii()

    // Apăsat pe AL DOILEA serviciu: fereastra le arată pe amândouă.
    randeaza(
      <DetaliuProgramare programare={servicii[1]!} onInchide={() => undefined} onModifica={() => undefined} />,
    )
    const detaliu = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    expect(await detaliu.findByText('Manichiură clasică', {}, ASTEPTARE)).toBeInTheDocument()
    expect(detaliu.getByText('Pedichiură clasică')).toBeInTheDocument()
    expect(detaliu.getByText(/^Total/)).toHaveTextContent('190')

    fireEvent.click(detaliu.getByRole('button', { name: /^Onorat$/ }))
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBe(2), ASTEPTARE)
    const inchidere = within(screen.getAllByRole('dialog').at(-1)!)
    expect(inchidere.getByText('Programare efectuată')).toBeInTheDocument()

    // Câte o sumă pe serviciu; pedichiura a fost mai scurtă.
    fireEvent.change(await inchidere.findByLabelText('Suma: Pedichiură clasică', {}, ASTEPTARE), {
      target: { value: '100' },
    })
    // Butoanele stau dezactivate cât se verifică acordul GDPR.
    const achitat = await inchidere.findByRole('button', { name: /Achitat acum/ }, ASTEPTARE)
    await waitFor(() => expect(achitat).toBeEnabled(), ASTEPTARE)
    fireEvent.click(achitat)

    await waitFor(() => {
      for (const s of servicii) expect(magazin.programare.get(s.id)?.stare).toBe('onorat')
    }, ASTEPTARE)
    const linii = [...magazin.vanzare_linie.values()].filter((l) =>
      servicii.some((s) => s.id === l.programare_id),
    )
    expect(linii).toHaveLength(2)
    expect(new Set(linii.map((l) => l.vanzare_id)).size).toBe(1)
    expect(linii.map((l) => l.pret_unitar).sort((x, y) => x - y)).toEqual([80, 100])
  })
})
