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

/** Textele rândurilor din tabel — produsul, categoria, prețul, starea. */
const randurileTabelului = () =>
  [...document.querySelectorAll('tbody tr')].map((rand) => rand.textContent ?? '')

it('produse: categoria are coloană și filtru; produsul nou intră în lista filtrată', async () => {
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  fireEvent.click(await screen.findByRole('tab', { name: /Produse/ }))
  expect(await screen.findByRole('columnheader', { name: 'Categorie' })).toBeInTheDocument()

  // Listele de prețuri ale clinicii, plus produsele rămase fără categorie.
  fireEvent.click(screen.getByRole('combobox', { name: 'Filtrare după categorie' }))
  expect(screen.getByRole('option', { name: 'Produse clienți' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Fără categorie' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: 'Produse colaboratori' }))

  await waitFor(() => {
    const randuri = randurileTabelului()
    expect(randuri).toHaveLength(2)
    expect(randuri.every((r) => r.includes('Produse colaboratori'))).toBe(true)
  })

  // Pornit din lista colaboratorilor, produsul nou intră în ea.
  fireEvent.click(screen.getByRole('button', { name: /Produs nou/ }))
  const dialog = document.querySelector('dialog') as HTMLElement
  expect(within(dialog).getByRole('combobox', { name: /^Categorie/ })).toHaveTextContent(
    'Produse colaboratori',
  )
  fireEvent.change(within(dialog).getByLabelText(/Denumire/), {
    target: { value: 'Cremă de probă 250 ml' },
  })
  fireEvent.change(within(dialog).getByLabelText(/Preț listă/), { target: { value: '185' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Adaugă' }))

  await waitFor(() => expect(randurileTabelului()).toHaveLength(3))
  const [nou] = await api.articole.list({ q: 'Cremă de probă' })
  expect(nou?.categorie).toBe('Produse colaboratori')
  expect(nou?.pret_lista).toBe(185)
})

it('administrator: aceeași cremă și pe cealaltă listă, cu o categorie scrisă de mână', async () => {
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  fireEvent.click(await screen.findByRole('tab', { name: /Produse/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Produs nou/ }))
  const dialog = document.querySelector('dialog') as HTMLElement

  // Scrisă cu litere mici și fără diacritice: se lipește de lista existentă.
  fireEvent.click(within(dialog).getByRole('combobox', { name: /^Categorie/ }))
  const cautare = within(dialog).getByRole('textbox', { name: 'Caută în listă' })
  fireEvent.change(cautare, { target: { value: 'produse COLABORATORI' } })
  fireEvent.keyDown(cautare, { key: 'Enter' })
  expect(within(dialog).getByRole('combobox', { name: /^Categorie/ })).toHaveTextContent(
    'Produse colaboratori',
  )

  fireEvent.change(within(dialog).getByLabelText(/Denumire/), {
    target: { value: 'Loțiune tonică' },
  })
  fireEvent.change(within(dialog).getByLabelText(/Preț listă/), { target: { value: '60' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Adaugă' }))

  await waitFor(async () => {
    const lotiuni = await api.articole.list({ tip: 'produs', q: 'Loțiune tonică' })
    expect(lotiuni.map((a) => [a.categorie, a.pret_lista]).sort()).toEqual([
      ['Produse clienți', 85],
      ['Produse colaboratori', 60],
    ])
  })
})

it('vânzare: produsele apar grupate pe listele de prețuri, iar căutarea găsește și după listă', async () => {
  await autentifica('andreea.popescu@clinica.ro')
  randeaza(<PaginaNomenclator />)

  fireEvent.click(await screen.findByRole('tab', { name: /Produse/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Vinde produse/ }))
  const formular = within(screen.getAllByRole('dialog').at(-1)!)

  fireEvent.click(formular.getByRole('combobox', { name: /^Produs/ }))
  const lista = formular.getByRole('listbox')
  await waitFor(() =>
    expect(
      [...lista.querySelectorAll('li[role="presentation"]')].map((li) => li.textContent),
    ).toEqual(['Produse clienți', 'Produse colaboratori', 'Fără categorie']),
  )

  // „colab” aduce lista colaboratorilor, sub titlul ei.
  fireEvent.change(formular.getByRole('textbox', { name: 'Caută în listă' }), {
    target: { value: 'colab' },
  })
  const optiuni = within(lista).getAllByRole('option').map((o) => o.textContent)
  expect(optiuni).toHaveLength(2)
  expect(optiuni.join(' ')).toMatch(/Mască facială cu argilă.*Ulei pentru masaj/)

  // Prețul vine din lista aleasă.
  fireEvent.click(within(lista).getByRole('option', { name: /Ulei pentru masaj/ }))
  expect(formular.getByLabelText('Preț unitar')).toHaveValue('70')
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
