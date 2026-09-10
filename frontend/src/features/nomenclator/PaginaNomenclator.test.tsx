import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { api } from '@/api'
import { autentifica, randeaza } from '@/test/render'
import { PaginaNomenclator } from './PaginaNomenclator'

/*
  Nomenclatorul are două file — servicii și produse. Punctele de lucru nu mai
  au ecran: clinica are o singură locație.
*/

it('administrator: listează, creează un serviciu și comută tipul', async () => {
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  expect(await screen.findByRole('heading', { name: 'Nomenclator' })).toBeInTheDocument()
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1))

  // Serviciu nou, fără durată: validarea locală trebuie să prindă articol_durata_ck.
  fireEvent.click(screen.getByRole('button', { name: /Serviciu nou/ }))
  const dialog = document.querySelector('dialog') as HTMLElement
  fireEvent.click(within(dialog).getByRole('button', { name: 'Adaugă' }))
  expect(await screen.findByText(/durată exprimată în minute/)).toBeInTheDocument()
  expect(screen.getByText('Denumirea este obligatorie.')).toBeInTheDocument()
  expect(screen.getByText('Completează prețul de listă.')).toBeInTheDocument()

  // Comutarea pe produs scoate câmpul de durată din formular.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Produs' }))
  expect(within(dialog).queryByLabelText(/Durată/)).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Serviciu' }))
  expect(within(dialog).getByLabelText(/Durată/)).toBeInTheDocument()

  fireEvent.change(within(dialog).getByLabelText(/Denumire/), {
    target: { value: 'Masaj de probă' },
  })
  fireEvent.change(within(dialog).getByLabelText(/Durată/), { target: { value: '45' } })
  // Virgulă zecimală, ca de la o tastatură românească.
  fireEvent.change(within(dialog).getByLabelText(/Preț listă/), { target: { value: '199,90' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Adaugă' }))

  await waitFor(async () => {
    const lista = await api.articole.list({ q: 'Masaj de probă' })
    expect(lista).toHaveLength(1)
    expect(lista[0]?.durata_minute).toBe(45)
    expect(lista[0]?.pret_lista).toBe(199.9)
  })
})

it('nu mai există filă de puncte de lucru', async () => {
  // Clinica are o singură locație. Testul rămâne ca regresie: dacă selectorul
  // sau fila reapar, cineva a readus un câmp pe care Beneficiarul l-a cerut scos.
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  expect(await screen.findByRole('tab', { name: /Servicii/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Produse/ })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /Puncte de lucru/ })).toBeNull()
})

it('utilizator: nu vede butoanele de modificare', async () => {
  await autentifica('andreea.popescu@clinica.ro')
  randeaza(<PaginaNomenclator />)

  expect(await screen.findByRole('heading', { name: 'Nomenclator' })).toBeInTheDocument()
  await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1))
  expect(screen.queryByRole('button', { name: /Serviciu nou/ })).toBeNull()
  expect(screen.getByText(/contul de administrator/)).toBeInTheDocument()
  // Rândurile nu sunt clicabile fără drept de modificare.
  expect(document.querySelector('tbody tr[role="button"]')).toBeNull()
})
