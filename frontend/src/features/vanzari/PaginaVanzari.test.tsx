import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { api } from '@/api'
import { autentifica, randeaza } from '@/test/render'
import { PaginaVanzari } from './PaginaVanzari'

/*
  Traseul complet al unei încasări de produse, prin interfața reală.

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

it('afișează lista de încasări cu datele din magazin', async () => {
  await autentifica()
  randeaza(<PaginaVanzari />)

  expect(await screen.findByRole('heading', { name: 'Încasări' })).toBeInTheDocument()
  await waitFor(() =>
    expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1),
  )
})

it('oprește trimiterea unei încasări incomplete', async () => {
  await autentifica()
  randeaza(<PaginaVanzari />)

  fireEvent.click(await screen.findByRole('button', { name: /Încasare nouă/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Înregistrează încasarea' }))

  // Validarea locală prinde lipsurile înainte de a ajunge la server.
  expect(await screen.findByText('Alege clientul.')).toBeInTheDocument()
  expect(screen.getByText('Alege produsul.')).toBeInTheDocument()
})

it('copiază prețul de listă în linie și înregistrează încasarea', async () => {
  await autentifica()
  randeaza(<PaginaVanzari />)

  fireEvent.click(await screen.findByRole('button', { name: /Încasare nouă/ }))
  await screen.findByRole('button', { name: 'Înregistrează încasarea' })

  await alegePrimaOptiune(/^Client/)
  // Formularul manual vinde doar produse; serviciile se încasează din programare.
  await alegePrimaOptiune(/^Produs/)

  // Prețul se copiază din nomenclator la alegerea articolului, deci totalul
  // nu mai poate fi zero. Comparația se face pe VALOARE, nu pe text: „90,00”
  // conține „0,00”, iar o potrivire de șir ar trece un total nul drept bun.
  const total = screen.getByText('Total încasare').parentElement?.textContent ?? ''
  expect(sumaDinText(total)).toBeGreaterThan(0)

  const inainte = (await api.vanzari.list({})).total
  fireEvent.click(screen.getByRole('button', { name: 'Înregistrează încasarea' }))

  await waitFor(async () => {
    expect((await api.vanzari.list({})).total).toBe(inainte + 1)
  })
})
