import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { api } from '@/api'
import { autentifica, deschideStatisticile, randeaza } from '@/test/render'
import { ListaIncasari } from './ListaIncasari'

/*
  Traseul complet al unei încasări de produse, prin interfața reală.

  Lista stă acum în Statistici, în spatele parolei lor; fiecare test o
  deblochează întâi, cum face omul la ușa ecranului.

  Testele din `@/api/memory/client.test.ts` verifică regulile bazei. Acesta
  verifică altceva: că ecranul chiar le folosește — că formularul oprește o
  trimitere incompletă, că prețul de listă ajunge în linie și că apăsarea
  butonului chiar scrie o încasare. Sunt exact pașii pe care îi face operatoarea
  la recepție.
*/

/**
 * Deschide un `Combobox` din formular și alege prima opțiune.
 *
 * Căutarea este limitată la fereastra modală: bara de filtre a listei are
 * propriile selectoare, cu aceleași etichete, iar o interogare pe tot
 * documentul ar găsi două potriviri și ar eșua.
 */
async function alegePrimaOptiune(eticheta: RegExp) {
  const formular = within(screen.getByRole('dialog'))
  fireEvent.click(formular.getByRole('combobox', { name: eticheta }))
  const optiuni = await formular.findAllByRole('option')
  const prima = optiuni[0]
  if (!prima) throw new Error(`Nicio opțiune disponibilă pentru ${String(eticheta)}.`)
  fireEvent.click(prima)
}

/** Citește suma dintr-un text formatat românește: „1.234,50 RON” -> 1234.5 */
function sumaDinText(text: string): number {
  const potrivire = /(\d[\d.]*,\d{2})/.exec(text)
  if (!potrivire?.[1]) return Number.NaN
  return Number(potrivire[1].replace(/\./g, '').replace(',', '.'))
}

/** Ce datorează clientul — `de_incasat` stă pe rândul din lista de clienți. */
async function deIncasat(nume: string): Promise<number> {
  const lista = await api.clienti.list({ q: nume })
  return lista.randuri.find((c) => c.nume === nume)?.de_incasat ?? Number.NaN
}

it('afișează lista de încasări cu datele din magazin', async () => {
  await autentifica()
  await deschideStatisticile()
  randeaza(<ListaIncasari />)

  expect(await screen.findByRole('button', { name: /Vinde produse/ })).toBeInTheDocument()
  await waitFor(() =>
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1),
  )
})

it('oprește trimiterea unei încasări incomplete', async () => {
  await autentifica()
  await deschideStatisticile()
  randeaza(<ListaIncasari />)

  fireEvent.click(await screen.findByRole('button', { name: /Vinde produse/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Salvează vânzarea' }))

  // Validarea locală prinde lipsurile înainte de a ajunge la server.
  expect(await screen.findByText('Alege clientul.')).toBeInTheDocument()
  expect(screen.getByText('Alege produsul.')).toBeInTheDocument()
})

it('copiază prețul de listă în linie și înregistrează încasarea', async () => {
  await autentifica()
  await deschideStatisticile()
  randeaza(<ListaIncasari />)

  fireEvent.click(await screen.findByRole('button', { name: /Vinde produse/ }))
  await screen.findByRole('button', { name: 'Salvează vânzarea' })

  await alegePrimaOptiune(/^Client/)
  // Formularul manual vinde doar produse; serviciile se încasează din programare.
  await alegePrimaOptiune(/^Produs/)

  // Prețul se copiază din nomenclator la alegerea articolului, deci totalul
  // nu mai poate fi zero. Comparația se face pe VALOARE, nu pe text: „90,00”
  // conține „0,00”, iar o potrivire de șir ar trece un total nul drept bun.
  const total = screen.getByText('Total de plată').parentElement?.textContent ?? ''
  expect(sumaDinText(total)).toBeGreaterThan(0)

  const inainte = (await api.vanzari.list({})).total
  fireEvent.click(screen.getByRole('button', { name: 'Salvează vânzarea' }))

  await waitFor(async () => {
    const dupa = await api.vanzari.list({})
    expect(dupa.total).toBe(inainte + 1)
    // Fără o alegere, vânzarea e achitată pe loc — ca înainte să existe butoanele.
    expect(dupa.randuri[0]?.achitat).toBe(true)
  })
})

/*
  Cererea clinicii, pas cu pas: „îi dau Mariei niște creme, nu plătește acum —
  bifez «Neachitat»; când plătește, schimb în «Achitat»”.
*/
it('vinde produse neachitate, apoi le trece achitate de pe bon', async () => {
  await autentifica()
  await deschideStatisticile()
  const maria = await api.clienti.create({ nume: 'Maria Cremă' })
  randeaza(<ListaIncasari />)

  fireEvent.click(await screen.findByRole('button', { name: /Vinde produse/ }))
  const formular = within(await screen.findByRole('dialog'))

  fireEvent.click(formular.getByRole('combobox', { name: /^Client/ }))
  fireEvent.click(await formular.findByRole('option', { name: /Maria Cremă/ }))
  await alegePrimaOptiune(/^Produs/)
  fireEvent.change(formular.getByLabelText('Preț unitar'), { target: { value: '150' } })

  // A doua cremă, pe un rând nou — „apoi adaug câte creme vreau”.
  fireEvent.click(formular.getByRole('button', { name: 'Adaugă produs' }))
  const produse = formular.getAllByRole('combobox', { name: /^Produs/ })
  fireEvent.click(produse[1] as HTMLElement)
  const optiuni = await formular.findAllByRole('option')
  fireEvent.click(optiuni[1] as HTMLElement)
  fireEvent.change(formular.getAllByLabelText('Preț unitar')[1] as HTMLElement, {
    target: { value: '350' },
  })

  expect(sumaDinText(formular.getByText('Total de plată').parentElement?.textContent ?? '')).toBe(500)

  fireEvent.click(formular.getByRole('button', { name: /Neachitat/ }))
  fireEvent.click(formular.getByRole('button', { name: 'Salvează vânzarea' }))

  // Neachitată: nu intră la bani, ci la datoria clientei.
  await waitFor(async () => {
    const datorii = await api.vanzari.list({ client_id: maria.id, achitat: false })
    expect(datorii.total).toBe(1)
    expect(datorii.randuri[0]?.total).toBe(500)
  })
  expect(await deIncasat('Maria Cremă')).toBe(500)

  // Când plătește: rândul din listă -> detaliul -> „Achitat”.
  // Rândul de tabel și cardul de telefon sunt amândouă în pagină (CSS alege).
  fireEvent.click((await screen.findAllByRole('button', { name: /Maria Cremă/ }))[0] as HTMLElement)
  const detaliu = within(screen.getAllByRole('dialog').at(-1) as HTMLElement)
  fireEvent.click(await detaliu.findByRole('button', { name: /^Achitat$/ }))

  await waitFor(async () => {
    expect(await deIncasat('Maria Cremă')).toBe(0)
  })
  const [vanzare] = (await api.vanzari.list({ client_id: maria.id })).randuri
  expect(vanzare?.achitat).toBe(true)
  expect(vanzare?.achitat_la).not.toBeNull()
})
