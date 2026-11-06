import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { esteStatisticiIncuiate } from '@/api/errors'
import { autentifica, deschideStatisticile, PAROLA_STATISTICI_TEST, randeaza } from '@/test/render'
import { PaginaSedintePersoane } from './PaginaSedintePersoane'

/*
  „Ședințe pe persoane” (3 și 6 nov. 2026): „o statistică și pentru Anda, în care
  să-i apară doar încasările ei și ce face ea în fiecare lună” — iar când a
  deschis-o proprietara și a găsit cifrele ei, clinica a cerut din nou: „aici
  trebuie Anda, și cu parola”. Pagina stă în spatele parolei statisticilor,
  se deschide pe Anda și nu arată nimic din clinică (cheltuieli, profit, produse).
  (Până pe 6 nov. se numea „Ședințele mele” și arăta contul autentificat, fără parolă.)
*/

vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

const OPERATOR = 'andreea.popescu@clinica.ro'
const ANDA = 'Andreea Popescu'

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

/** Randează pagina cu un cont și o deschide cu parola bună. */
async function deschisaCu(email: string) {
  await parolaAleasaDeja()
  const cont = await autentifica(email)
  const afisat = randeaza(<PaginaSedintePersoane />)
  await scrieParola(PAROLA_STATISTICI_TEST)
  return { cont, ...afisat }
}

describe('ședințe pe persoane', () => {
  it('cere parola statisticilor: fără ea nu se vede nicio cifră', async () => {
    await parolaAleasaDeja()
    await autentifica()
    randeaza(<PaginaSedintePersoane />)

    expect(await screen.findByRole('heading', { name: 'Ședințe pe persoane' }, ASTEPTARE)).toBeInTheDocument()
    expect(await screen.findByText('Statisticile sunt încuiate', {}, ASTEPTARE)).toBeInTheDocument()
    expect(screen.queryByText('Încasat din ședințe')).toBeNull()

    await scrieParola('parola123')
    expect(await screen.findByText('Parola statisticilor nu este corectă.', {}, ASTEPTARE)).toBeInTheDocument()
    expect(screen.queryByText('Încasat din ședințe')).toBeNull()
  })

  it('proprietara o deschide și vede pe Anda, nu contul ei', async () => {
    const { cont } = await deschisaCu('admin@clinica.ro')
    expect(cont.nume).not.toBe(ANDA)

    expect(await screen.findByText(`Ședințele făcute de ${ANDA}`, { exact: false }, ASTEPTARE)).toBeInTheDocument()
    expect(screen.queryByText(`Ședințele făcute de ${cont.nume}`, { exact: false })).toBeNull()

    const persoane = screen.getByRole('group', { name: 'Persoana' })
    expect(within(persoane).getByRole('button', { name: new RegExp(ANDA) })).toHaveAttribute('aria-pressed', 'true')
    // Aici nu e „toată clinica”: asta e la „Statistici”.
    expect(within(persoane).queryByRole('button', { name: 'Toată clinica' })).toBeNull()

    for (const eticheta of [
      'Încasat din ședințe',
      'Programări onorate',
      'Rămas de încasat',
      'Clienți serviți',
    ]) {
      expect(await screen.findAllByText(eticheta, {}, ASTEPTARE)).not.toHaveLength(0)
    }
    // Ce ține de clinică nu apare: nici cheltuieli, nici profit, nici produse.
    expect(screen.queryByText('Cheltuieli')).toBeNull()
    expect(screen.queryByText('Profit')).toBeNull()
    expect(screen.queryByText('Produse')).toBeNull()
  })

  it('Anda însăși, cu parola, se vede pe ea; o altă persoană se alege din butoane', async () => {
    const { cont } = await deschisaCu(OPERATOR)
    expect(cont.nume).toBe(ANDA)
    expect(await screen.findByText(`Ședințele făcute de ${ANDA}`, { exact: false }, ASTEPTARE)).toBeInTheDocument()

    // Operatoarea își vede doar propriul cont în butoane: nu pe ale colegelor.
    const persoane = screen.getByRole('group', { name: 'Persoana' })
    expect(within(persoane).getAllByRole('button')).toHaveLength(1)
  })

  it('proprietara trece pe un alt cont din butoane, și raportul își schimbă numele', async () => {
    const { cont } = await deschisaCu('admin@clinica.ro')
    await screen.findByText(`Ședințele făcute de ${ANDA}`, { exact: false }, ASTEPTARE)

    const persoane = screen.getByRole('group', { name: 'Persoana' })
    fireEvent.click(await within(persoane).findByRole('button', { name: new RegExp(cont.nume) }, ASTEPTARE))

    expect(await screen.findByText(`Ședințele făcute de ${cont.nume}`, { exact: false }, ASTEPTARE)).toBeInTheDocument()
    expect(within(persoane).getByRole('button', { name: new RegExp(cont.nume) })).toHaveAttribute('aria-pressed', 'true')
    expect(within(persoane).getByRole('button', { name: new RegExp(ANDA) })).toHaveAttribute('aria-pressed', 'false')
  })

  it('„Încuie” închide la loc, iar plecarea din pagină șterge deblocarea', async () => {
    const { unmount } = await deschisaCu('admin@clinica.ro')
    await screen.findByText(`Ședințele făcute de ${ANDA}`, { exact: false }, ASTEPTARE)

    fireEvent.click(screen.getByRole('button', { name: 'Încuie' }))
    expect(await screen.findByText('Statisticile sunt încuiate', {}, ASTEPTARE)).toBeInTheDocument()
    expect(screen.queryByText(`Ședințele făcute de ${ANDA}`, { exact: false })).toBeNull()

    await scrieParola(PAROLA_STATISTICI_TEST)
    await screen.findByText(`Ședințele făcute de ${ANDA}`, { exact: false }, ASTEPTARE)

    unmount()
    expect(
      esteStatisticiIncuiate(
        await api.statistici
          .persoana('x', { de_la: '2026-09-01', pana_la: '2026-09-02', pas: 'zi' })
          .catch((e: unknown) => e),
      ),
    ).toBe(true)
  })

  it('graficul „pe zile” are tabelul lui: încasat și programări, pe fiecare zi a lunii', async () => {
    await deschisaCu('admin@clinica.ro')

    const titlu = await screen.findByText('Încasat pe ședințe', {}, ASTEPTARE)
    const card = titlu.closest('.rounded-xl') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Tabel' }))
    const tabel = within(card).getByRole('table')
    expect(within(tabel).getByRole('columnheader', { name: 'Programări onorate' })).toBeInTheDocument()
    // Câte un rând pe fiecare zi a lunii, până azi.
    expect(within(tabel).getAllByRole('row').length).toBe(new Date().getDate() + 1)
  })
})
