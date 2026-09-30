import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { esteStatisticiIncuiate } from '@/api/errors'
import { magazin } from '@/api/memory/store'
import { autentifica, deschideStatisticile, PAROLA_STATISTICI_TEST, randeaza } from '@/test/render'
import { PaginaStatistici } from './PaginaStatistici'

/*
  Ecranul Statisticilor, cum îl folosește omul: ușa cu parola ei, filele,
  graficele cu tabelul lor geamăn, cheltuielile — și încuierea la plecare.
*/

vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

/** Parola aleasă de administrator, apoi statisticile încuiate la loc — ca la o zi nouă. */
async function parolaAleasaDeja() {
  await autentifica()
  await deschideStatisticile()
  api.statistici.blocheaza()
}

async function scrieParola(parola: string) {
  fireEvent.change(await screen.findByLabelText('Parola statisticilor', {}, ASTEPTARE), {
    target: { value: parola },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Deschide statisticile' }))
}

describe('ușa', () => {
  it('prima dată, administratorul alege parola — nu pe a contului — și intră', async () => {
    await autentifica()
    randeaza(<PaginaStatistici />)

    expect(await screen.findByText('Alege parola statisticilor', {}, ASTEPTARE)).toBeInTheDocument()
    const noua = screen.getByLabelText('Parola nouă')
    const repetata = screen.getByLabelText('Scrie-o încă o dată')
    const salveaza = screen.getByRole('button', { name: 'Salvează și deschide' })

    fireEvent.change(noua, { target: { value: 'statistici-1' } })
    fireEvent.change(repetata, { target: { value: 'statistici-2' } })
    fireEvent.click(salveaza)
    expect(await screen.findByText('Cele două parole nu sunt la fel.')).toBeInTheDocument()

    // Parola contului e refuzată de server, pe câmpul ei.
    fireEvent.change(noua, { target: { value: 'parola123' } })
    fireEvent.change(repetata, { target: { value: 'parola123' } })
    fireEvent.click(salveaza)
    expect(await screen.findByText(/diferită de cea a contului/, {}, ASTEPTARE)).toBeInTheDocument()

    fireEvent.change(noua, { target: { value: PAROLA_STATISTICI_TEST } })
    fireEvent.change(repetata, { target: { value: PAROLA_STATISTICI_TEST } })
    fireEvent.click(salveaza)

    expect(await screen.findByRole('tab', { name: 'Rezumat' }, ASTEPTARE)).toBeInTheDocument()
    expect(await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)).toBeInTheDocument()
    // Cifra de sus și legenda graficului.
    expect(screen.getAllByText('Încasat').length).toBeGreaterThan(0)
  })

  it('fără parolă aleasă, cine nu e administrator află că trebuie aleasă întâi', async () => {
    await autentifica('andreea.popescu@clinica.ro')
    randeaza(<PaginaStatistici />)
    expect(await screen.findByText('Statisticile nu sunt încă deschise', {}, ASTEPTARE)).toBeInTheDocument()
    expect(screen.queryByLabelText('Parola nouă')).toBeNull()
  })

  it('parola greșită nu deschide; cea bună deschide; „Încuie” închide la loc', async () => {
    await parolaAleasaDeja()
    await autentifica('andreea.popescu@clinica.ro')
    randeaza(<PaginaStatistici />)

    await scrieParola('parola123')
    expect(await screen.findByText('Parola statisticilor nu este corectă.', {}, ASTEPTARE)).toBeInTheDocument()

    await scrieParola(PAROLA_STATISTICI_TEST)
    expect(await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)).toBeInTheDocument()
    // Operatoarea nu schimbă parola — butonul e doar al administratorului.
    expect(screen.queryByRole('button', { name: 'Schimbă parola statisticilor' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Încuie' }))
    expect(await screen.findByText('Statisticile sunt încuiate', {}, ASTEPTARE)).toBeInTheDocument()
    expect(esteStatisticiIncuiate(await api.cheltuieli.list().catch((e: unknown) => e))).toBe(true)
  })

  it('plecarea din pagină încuie: la întoarcere se cere iar parola', async () => {
    await parolaAleasaDeja()
    const { unmount } = randeaza(<PaginaStatistici />)
    await scrieParola(PAROLA_STATISTICI_TEST)
    expect(await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)).toBeInTheDocument()

    unmount()
    expect(esteStatisticiIncuiate(await api.statistici.raport({
      de_la: '2026-09-01', pana_la: '2026-09-02', pas: 'zi',
    }).catch((e: unknown) => e))).toBe(true)

    randeaza(<PaginaStatistici />)
    expect(await screen.findByText('Statisticile sunt încuiate', {}, ASTEPTARE)).toBeInTheDocument()
  })

  it('o parolă schimbată în altă parte încuie ecranul deschis, cu motivul scris', async () => {
    await parolaAleasaDeja()
    randeaza(<PaginaStatistici />)
    await scrieParola(PAROLA_STATISTICI_TEST)
    expect(await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)).toBeInTheDocument()

    // Altcineva, de pe alt calculator, a schimbat-o între timp.
    magazin.parola_statistici = {
      ...magazin.parola_statistici!,
      parola_hash: 'alta-parola-noua',
      actualizat_la: new Date(Date.now() + 1000).toISOString(),
    }
    fireEvent.change(screen.getByLabelText('Perioada'), { target: { value: 'anul' } })

    expect(await screen.findByText('Statisticile sunt încuiate', {}, ASTEPTARE)).toBeInTheDocument()
    expect(screen.getByText(/Parola statisticilor s-a schimbat/)).toBeInTheDocument()
  })
})

describe('înăuntru', () => {
  it('graficul în timp are tabelul lui, cu profitul pe fiecare zi', async () => {
    await parolaAleasaDeja()
    randeaza(<PaginaStatistici />)
    await scrieParola(PAROLA_STATISTICI_TEST)

    const titlu = await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)
    const card = titlu.closest('.rounded-xl') as HTMLElement
    expect(within(card).getByRole('group', { name: /Încasări și cheltuieli pe zile/ })).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Tabel' }))
    const tabel = within(card).getByRole('table')
    expect(within(tabel).getByRole('columnheader', { name: 'Profit' })).toBeInTheDocument()
    // Câte un rând pe fiecare zi a lunii, până azi.
    expect(within(tabel).getAllByRole('row').length).toBe(new Date().getDate() + 1)
  })

  it('o cheltuială nouă apare în listă și se scade din profit', async () => {
    await parolaAleasaDeja()
    randeaza(<PaginaStatistici />)
    await scrieParola(PAROLA_STATISTICI_TEST)
    await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)

    const inainte = (await api.statistici.raport({
      de_la: laZi(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      pana_la: laZi(new Date()),
      pas: 'zi',
    })).total

    fireEvent.click(screen.getByRole('tab', { name: 'Cheltuieli' }))
    fireEvent.click(await screen.findByRole('button', { name: /Adaugă cheltuială/ }, ASTEPTARE))
    const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))

    // Fără sumă și fără categorie, formularul spune ce lipsește.
    fireEvent.click(formular.getByRole('button', { name: 'Adaugă cheltuiala' }))
    expect(await formular.findByText('Alege categoria.')).toBeInTheDocument()

    fireEvent.change(formular.getByLabelText(/^Suma/), { target: { value: '1234,50' } })
    fireEvent.click(formular.getByRole('combobox', { name: /^Categoria/ }))
    fireEvent.click(await formular.findByRole('option', { name: 'Chirie' }))
    fireEvent.change(formular.getByLabelText('Descriere'), { target: { value: 'Chiria din test' } })
    fireEvent.click(formular.getByRole('button', { name: 'Adaugă cheltuiala' }))

    expect(await screen.findAllByText('Chiria din test', {}, ASTEPTARE)).not.toHaveLength(0)
    await waitFor(async () => {
      const dupa = (await api.statistici.raport({
        de_la: laZi(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
        pana_la: laZi(new Date()),
        pas: 'zi',
      })).total
      expect(dupa.cheltuieli).toBeCloseTo(inainte.cheltuieli + 1234.5, 2)
      expect(dupa.profit).toBeCloseTo(inainte.profit - 1234.5, 2)
    })
  })

  it('fila „Încasări” e fosta listă de încasări, cu vânzarea de produse', async () => {
    await parolaAleasaDeja()
    randeaza(<PaginaStatistici />)
    await scrieParola(PAROLA_STATISTICI_TEST)
    await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)

    fireEvent.click(screen.getByRole('tab', { name: 'Încasări' }))
    expect(await screen.findByRole('button', { name: /Vinde produse/ }, ASTEPTARE)).toBeInTheDocument()
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1), ASTEPTARE)
  })

  it('se încuie singur când expiră deblocarea', async () => {
    await parolaAleasaDeja()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      randeaza(<PaginaStatistici />)
      await scrieParola(PAROLA_STATISTICI_TEST)
      await screen.findByText('Încasări și cheltuieli', {}, ASTEPTARE)
      await act(async () => {
        vi.advanceTimersByTime(61 * 60_000)
      })
      /*
        Peste o oră a expirat și sesiunea demonstrativă (o jumătate de oră) —
        în aplicație clientul HTTP o reînnoiește singur. Aici omul se
        autentifică din nou și reîncearcă; ușa îi spune de ce s-a închis.
      */
      await autentifica()
      for (const buton of await screen.findAllByRole('button', { name: 'Încearcă din nou' }, ASTEPTARE)) {
        fireEvent.click(buton)
      }
      expect(await screen.findByText(/s-au încuiat singure după o oră/, {}, ASTEPTARE)).toBeInTheDocument()
      expect(screen.getByLabelText('Parola statisticilor')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

function laZi(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}
