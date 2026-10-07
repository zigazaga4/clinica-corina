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

/** Deschide lista de produse a unui rând din formularul de vânzare și întoarce opțiunile. */
async function optiunileProdusului(formular: ReturnType<typeof within>, rand = 0) {
  fireEvent.click(formular.getAllByRole('combobox', { name: /^Produs/ })[rand]!)
  const lista = formular.getByRole('listbox')
  await waitFor(() => expect(within(lista).getAllByRole('option').length).toBeGreaterThan(0))
  return { lista, text: within(lista).getAllByRole('option').map((o) => o.textContent).join(' ') }
}

/** Butonul apăsat din „Lista de prețuri” a formularului de vânzare. */
const listaApasata = (formular: ReturnType<typeof within>) =>
  within(formular.getByRole('group', { name: 'Lista de prețuri' }))
    .getAllByRole('button')
    .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent

it('vânzare: de pe fiecare filă se vinde din lista ei — cum a cerut clinica', async () => {
  await autentifica('andreea.popescu@clinica.ro')
  randeaza(<PaginaNomenclator />)

  // De pe „Produse clienți”: lista clienților, fără colaboratori și fără
  // produsele rămase fără categorie.
  fireEvent.click(await screen.findByRole('tab', { name: /Produse clienți/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Vinde produse/ }))
  let formular = within(screen.getAllByRole('dialog').at(-1)!)
  // Comutatorul apare când sosesc produsele (listele se citesc din ele).
  await waitFor(() => expect(listaApasata(formular)).toBe('Produse clienți'))
  const clienti = await optiunileProdusului(formular)
  expect(clienti.text).toMatch(/Loțiune tonică/)
  expect(clienti.text).not.toMatch(/Ulei pentru masaj|Mască facială cu argilă|Balsam pentru gene/)
  expect(clienti.lista.querySelectorAll('li[role="presentation"]')).toHaveLength(0)
  fireEvent.click(formular.getByRole('button', { name: 'Renunță' }))
  await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0))

  // De pe „Produse colaboratori”: lista colaboratorilor (mesajul clinicii:
  // „dacă intru la colaboratori și dau Vinde produse, … nu-mi apar produsele
  // din lista asta, ci din lista de clienți”).
  fireEvent.click(screen.getByRole('tab', { name: /Produse colaboratori/ }))
  await waitFor(() => expect(randurileTabelului()).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: /Vinde produse/ }))
  formular = within(screen.getAllByRole('dialog').at(-1)!)
  await waitFor(() => expect(listaApasata(formular)).toBe('Produse colaboratori'))
  const colaboratori = await optiunileProdusului(formular)
  expect(within(colaboratori.lista).getAllByRole('option')).toHaveLength(2)
  expect(colaboratori.text).toMatch(/Mască facială cu argilă.*Ulei pentru masaj/)
  expect(colaboratori.text).not.toMatch(/Loțiune tonică/)

  // Prețul vine din lista colaboratorilor, iar vânzarea se și salvează.
  fireEvent.click(within(colaboratori.lista).getByRole('option', { name: /Ulei pentru masaj/ }))
  expect(formular.getByLabelText('Preț unitar')).toHaveValue('70')
  const colaborator = await api.clienti.create({ nume: 'Colaborator Salon' })
  fireEvent.click(formular.getByRole('combobox', { name: /^Client/ }))
  fireEvent.change(formular.getByRole('textbox', { name: 'Caută în listă' }), {
    target: { value: 'Colaborator Salon' },
  })
  fireEvent.click(await formular.findByRole('option', { name: /Colaborator Salon/ }, { timeout: 10_000 }))
  fireEvent.click(formular.getByRole('button', { name: /^Neachitat$/ }))
  fireEvent.click(formular.getByRole('button', { name: 'Salvează vânzarea' }))
  // `de_incasat` stă pe rândul din lista de clienți.
  await waitFor(async () => {
    const { randuri } = await api.clienti.list({ q: 'Colaborator Salon' })
    expect(randuri.find((c) => c.id === colaborator.id)?.de_incasat).toBe(70)
  })
})

it('vânzare: „Vinde” pe un produs al colaboratorilor pornește din lista lui, care se poate schimba', async () => {
  await autentifica('andreea.popescu@clinica.ro')
  randeaza(<PaginaNomenclator />)

  fireEvent.click(await screen.findByRole('tab', { name: /Produse colaboratori/ }))
  // Butonul stă și pe rândul din tabel, și pe cardul de telefon.
  fireEvent.click((await screen.findAllByRole('button', { name: /^Vinde Ulei pentru masaj/ }))[0]!)
  const formular = within(screen.getAllByRole('dialog').at(-1)!)
  await waitFor(() => expect(listaApasata(formular)).toBe('Produse colaboratori'))
  expect(formular.getByRole('combobox', { name: /^Produs/ })).toHaveTextContent('Ulei pentru masaj')
  expect(formular.getByLabelText('Preț unitar')).toHaveValue('70')

  // Altă listă: rândul completat rămâne cum era, cel nou alege din lista nouă.
  fireEvent.click(formular.getByRole('button', { name: 'Produse clienți' }))
  expect(listaApasata(formular)).toBe('Produse clienți')
  expect(formular.getByRole('combobox', { name: /^Produs/ })).toHaveTextContent('Ulei pentru masaj')
  fireEvent.click(formular.getByRole('button', { name: /Adaugă produs/ }))
  const { text } = await optiunileProdusului(formular, 1)
  expect(text).toMatch(/Loțiune tonică/)
  expect(text).not.toMatch(/Mască facială cu argilă/)
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

/** Deschide fereastra articolului dintr-un rând al tabelului (administrator). */
async function deschideArticolul(denumire: string) {
  // Denumirea stă și pe rândul tabelului, și pe cardul de telefon.
  const gasite = await screen.findAllByText(denumire)
  const rand = gasite.map((el) => el.closest('tr')).find((tr) => tr !== null) as HTMLElement
  fireEvent.click(rand)
  return within(await screen.findByRole('dialog'))
}

it('administrator: „Șterge” scoate de tot un produs nefolosit', async () => {
  await autentifica('admin@clinica.ro')
  await api.articole.create({
    tip: 'produs', denumire: 'Cremă pusă din greșeală', pret_lista: 1, categorie: 'Produse clienți',
  })
  randeaza(<PaginaNomenclator />)
  fireEvent.click(await screen.findByRole('tab', { name: /Produse clienți/ }))

  const fereastra = await deschideArticolul('Cremă pusă din greșeală')
  fireEvent.click(fereastra.getByRole('button', { name: /Șterge/ }))
  const confirmare = within(screen.getAllByRole('dialog').at(-1)!)
  expect(confirmare.getByText(/dispare de tot din Nomenclator/)).toBeInTheDocument()
  fireEvent.click(confirmare.getByRole('button', { name: 'Șterge' }))

  await waitFor(() => expect(randurileTabelului().join(' ')).not.toMatch(/Cremă pusă din greșeală/))
  expect(await api.articole.list({ q: 'Cremă pusă din greșeală' })).toHaveLength(0)
})

it('administrator: produsul vândut nu se șterge — se dezactivează și dispare din listă', async () => {
  await autentifica('admin@clinica.ro')
  const produs = await api.articole.create({
    tip: 'produs', denumire: 'Cremă vândută', pret_lista: 50, categorie: 'Produse clienți',
  })
  const clienta = await api.clienti.create({ nume: 'Clientă Cremă' })
  await api.vanzari.create({
    client_id: clienta.id,
    efectuat_la: new Date().toISOString(),
    metoda_plata: 'card',
    linii: [{ articol_id: produs.id, cantitate: 1 }],
  })
  randeaza(<PaginaNomenclator />)
  fireEvent.click(await screen.findByRole('tab', { name: /Produse clienți/ }))

  const fereastra = await deschideArticolul('Cremă vândută')
  fireEvent.click(fereastra.getByRole('button', { name: /Șterge/ }))
  fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Șterge' }))

  // Serverul refuză: istoricul are nevoie de el. Fereastra propune dezactivarea.
  // Toate modalele împart id-ul titlului: cea de deasupra e ultima.
  expect(await screen.findByText(/„Cremă vândută” nu se poate șterge/)).toBeInTheDocument()
  const refuz = within(screen.getAllByRole('dialog').at(-1)!)
  expect(refuz.getByText(/pe 1 bon/)).toBeInTheDocument()
  fireEvent.click(refuz.getByRole('button', { name: 'Dezactivează' }))

  await waitFor(async () => expect((await api.articole.list({ q: 'Cremă vândută' }))[0]?.activ).toBe(false))
  // Nomenclatorul pornește pe „Active”: produsul dezactivat nu mai stă în listă…
  await waitFor(() => expect(randurileTabelului().join(' ')).not.toMatch(/Cremă vândută/))
  // …dar se găsește la „Inactive”.
  fireEvent.click(screen.getByRole('button', { name: 'Inactive' }))
  await waitFor(() => expect(randurileTabelului().join(' ')).toMatch(/Cremă vândută/))
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
