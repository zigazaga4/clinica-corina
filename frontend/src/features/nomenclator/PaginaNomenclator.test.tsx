import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { api } from '@/api'
import { autentifica, deschideStatisticile, randeaza } from '@/test/render'
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

/** Textele rândurilor din tabel — produsul, prețul, starea. */
const randurileTabelului = () =>
  [...document.querySelectorAll('tbody tr')].map((rand) => rand.textContent ?? '')

/** Numele filelor, fără contorul de la capăt: „Produse clienți8” -> „Produse clienți”. */
const numeleFilelor = () =>
  screen.getAllByRole('tab').map((fila) => fila.textContent?.replace(/\d+$/, '').trim())

it('produse: fiecare categorie are fila ei; produsul nou intră în fila din care a pornit', async () => {
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  // Cum a cerut clinica: serviciile și listele de prețuri, una lângă alta — nu
  // o filă „Produse” cu un filtru înăuntru. Produsele fără categorie la urmă.
  await waitFor(() =>
    expect(numeleFilelor()).toEqual([
      'Servicii',
      'Produse clienți',
      'Produse colaboratori',
      'Alte produse',
    ]),
  )
  fireEvent.click(screen.getByRole('tab', { name: /Produse colaboratori/ }))
  await waitFor(() => expect(randurileTabelului()).toHaveLength(2))
  expect(randurileTabelului().join(' ')).toMatch(/Mască facială cu argilă.*Ulei pentru masaj/)

  // Pornit de pe fila colaboratorilor, produsul nou intră în ea.
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

  // Pe fila clienților nu apare.
  fireEvent.click(screen.getByRole('tab', { name: /Produse clienți/ }))
  await waitFor(() => expect(randurileTabelului().join(' ')).toMatch(/Loțiune tonică/))
  expect(randurileTabelului().join(' ')).not.toMatch(/Cremă de probă/)
})

it('fără nicio categorie, produsele stau pe o singură filă „Produse”', async () => {
  await autentifica('admin@clinica.ro')
  for (const produs of await api.articole.list({ tip: 'produs' })) {
    await api.articole.update(produs.id, { categorie: null })
  }
  randeaza(<PaginaNomenclator />)

  await waitFor(() => expect(numeleFilelor()).toEqual(['Servicii', 'Produse']))
})

it('administrator: aceeași cremă și pe cealaltă listă, cu o categorie scrisă de mână', async () => {
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  fireEvent.click(await screen.findByRole('tab', { name: /Produse clienți/ }))
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

it('vânzare: se aleg doar produsele clienților', async () => {
  await autentifica('andreea.popescu@clinica.ro')
  randeaza(<PaginaNomenclator />)

  // Pe lista colaboratorilor nu există „Vinde” pe rând.
  fireEvent.click(await screen.findByRole('tab', { name: /Produse colaboratori/ }))
  await waitFor(() => expect(randurileTabelului()).toHaveLength(2))
  expect(screen.queryByRole('button', { name: /^Vinde Ulei pentru masaj/ })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Vinde produse/ }))
  const formular = within(screen.getAllByRole('dialog').at(-1)!)

  fireEvent.click(formular.getByRole('combobox', { name: /^Produs/ }))
  const lista = formular.getByRole('listbox')
  await waitFor(() => expect(within(lista).getAllByRole('option').length).toBeGreaterThan(0))
  const optiuni = within(lista).getAllByRole('option').map((o) => o.textContent).join(' ')
  // Lista clienților, fără colaboratori și fără produsele rămase fără categorie.
  expect(optiuni).toMatch(/Loțiune tonică/)
  expect(optiuni).not.toMatch(/Ulei pentru masaj|Mască facială cu argilă|Balsam pentru gene/)
  expect(lista.querySelectorAll('li[role="presentation"]')).toHaveLength(0)

  // Prețul vine din lista clienților.
  fireEvent.click(within(lista).getByRole('option', { name: /Loțiune tonică/ }))
  expect(formular.getByLabelText('Preț unitar')).toHaveValue('85')
})

it('produse neachitate: se plătește doar ce s-a bifat, restul rămâne datorie', async () => {
  await autentifica('admin@clinica.ro')
  const clienta = await api.clienti.create({ nume: 'Clientă Bucăți' })
  const produse = (await api.articole.list({ tip: 'produs', activ: true })).filter(
    (p) => p.categorie === 'Produse clienți',
  )
  const [lotiune, gel] = [
    produse.find((p) => p.denumire === 'Loțiune tonică')!,
    produse.find((p) => p.denumire === 'Gel de curățare facială')!,
  ]
  const datorie = await api.vanzari.create({
    client_id: clienta.id,
    efectuat_la: new Date().toISOString(),
    achitat: false,
    linii: [
      { articol_id: lotiune.id, cantitate: 1 },
      { articol_id: gel.id, cantitate: 1 },
    ],
  })
  randeaza(<PaginaNomenclator />)
  fireEvent.click(await screen.findByRole('tab', { name: /Produse clienți/ }))

  const rand = within((await screen.findByText('Clientă Bucăți')).closest('li')!)
  fireEvent.click(rand.getByRole('checkbox', { name: /Loțiune tonică/ }))
  expect(rand.getByText(/rămân 95,00 RON/)).toBeInTheDocument()
  fireEvent.click(rand.getByRole('button', { name: /Numerar/ }))

  await waitFor(async () => {
    const ramasa = await api.vanzari.get(datorie.id)
    expect(ramasa.achitat).toBe(false)
    expect(ramasa.linii.map((l) => l.articol_denumire)).toEqual(['Gel de curățare facială'])
  })
  // Lista încasărilor achitate cere parola Statisticilor.
  await deschideStatisticile()
  const [platita] = (await api.vanzari.list({ client_id: clienta.id, achitat: true })).randuri
  expect(platita?.metoda_plata).toBe('numerar')
  expect(platita?.linii.map((l) => l.articol_denumire)).toEqual(['Loțiune tonică'])
})

it('nu mai există filă de puncte de lucru', async () => {
  // Clinica are o singură locație. Testul rămâne ca regresie: dacă selectorul
  // sau fila reapar, cineva a readus un câmp pe care Beneficiarul l-a cerut scos.
  await autentifica('admin@clinica.ro')
  randeaza(<PaginaNomenclator />)

  expect(await screen.findByRole('tab', { name: /Servicii/ })).toBeInTheDocument()
  expect(await screen.findByRole('tab', { name: /Produse clienți/ })).toBeInTheDocument()
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
