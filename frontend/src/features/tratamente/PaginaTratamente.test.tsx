import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { magazin } from '@/api/memory/store'
import type { TratamentDetaliu } from '@/domain/types'
import { autentifica, randeaza } from '@/test/render'
import { PaginaTratamente } from './PaginaTratamente'

/*
  Ecranul „Tratamente”, prin gesturile recepției.

  Regulile tratamentului — cine deschide unul, cum se împarte prețul, când se
  încheie — stau în `@/api/memory/client.test.ts`. Aici se verifică faptul că
  ecranul chiar le folosește: că un tratament din „bază” apare în listă cu
  ședințele numărate, că „Programează” deschide formularul cu clientul și
  serviciul fixate și anunță „ședința k din N”, și că suma unei ședințe se
  poate corecta la închidere.
*/

vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

/** Un tratament în curs din datele demo, care satisface condiția. */
async function tratamentInCurs(
  conditie: (t: TratamentDetaliu) => boolean = (t) => t.sedinte_ramase > 0,
): Promise<TratamentDetaliu> {
  const lista = await api.tratamente.list({ in_curs: true, pe_pagina: 200 })
  const t = lista.randuri.find(conditie)
  if (!t) throw new Error('Datele demo nu au un tratament în curs potrivit.')
  return t
}

/*
  Rândurile tabelului au și ele `role="button"` (se deschid la clic), iar
  numele lor accesibil cuprinde textul butonului dinăuntru. `/^Programează$/`
  prinde doar butonul, nu și rândul din jurul lui.
*/
const BUTON_PROGRAMEAZA = { name: /^Programează$/ }

describe('ecranul de tratamente', () => {
  it('arată tratamentele în curs, cu ședințele numărate din programări', async () => {
    await autentifica()
    const t = await tratamentInCurs()
    randeaza(<PaginaTratamente />)

    // Rândul clientului, cu bara de progres etichetată din contoare.
    const bare = await screen.findAllByRole('img', {
      name: new RegExp(`${t.sedinte_onorate} din ${t.numar_sedinte} ședințe făcute`),
    }, ASTEPTARE)
    expect(bare.length).toBeGreaterThan(0)
    expect(screen.getAllByText(t.client_nume).length).toBeGreaterThan(0)
  })

  it('„Programează” deschide formularul cu clientul și serviciul fixate și spune a câta ședință e', async () => {
    await autentifica()
    const t = await tratamentInCurs()
    randeaza(<PaginaTratamente />)

    // Butonul de pe rândul tratamentului ales: rândul se găsește după numele
    // clientului, butonul înăuntrul lui.
    const celula = (await screen.findAllByText(t.client_nume, {}, ASTEPTARE))[0]!
    const rand = celula.closest('tr') ?? celula.closest('li')!
    fireEvent.click(within(rand).getByRole('button', BUTON_PROGRAMEAZA))

    const formular = within(await screen.findByRole('dialog', { name: /Programare nouă/ }, ASTEPTARE))
    // Clientul și serviciul sunt ale tratamentului: completate și blocate.
    await waitFor(() => {
      expect(formular.getByRole('combobox', { name: /^Client/ })).toHaveTextContent(t.client_nume)
      expect(formular.getByRole('combobox', { name: /^Serviciu/ })).toHaveTextContent(t.articol_denumire)
    }, ASTEPTARE)
    expect(formular.getByRole('combobox', { name: /^Client/ })).toBeDisabled()

    const urmatoarea = t.sedinte_programate + t.sedinte_onorate + 1
    expect(
      await formular.findByText(new RegExp(`Ședința ${urmatoarea} din ${t.numar_sedinte}`), {}, ASTEPTARE),
    ).toBeInTheDocument()
    // Prețul propus este partea ședinței, nu prețul din nomenclator.
    await waitFor(() =>
      expect(formular.getByLabelText(/^Preț/)).toHaveValue(String(t.pret_urmatoarea).replace('.', ',')),
    ASTEPTARE)
  })

  it('salvarea ședinței o pune în tratament, iar lista numără una în plus', async () => {
    await autentifica()
    const t = await tratamentInCurs()
    randeaza(<PaginaTratamente />)

    const celula = (await screen.findAllByText(t.client_nume, {}, ASTEPTARE))[0]!
    const rand = celula.closest('tr') ?? celula.closest('li')!
    fireEvent.click(within(rand).getByRole('button', BUTON_PROGRAMEAZA))
    const formular = within(await screen.findByRole('dialog', { name: /Programare nouă/ }, ASTEPTARE))
    await formular.findByText(/Ședința \d+ din \d+/, {}, ASTEPTARE)

    // Ora: departe în viitor, ca să nu se suprapună cu agenda generată.
    const inceput = new Date()
    inceput.setFullYear(inceput.getFullYear() + 3)
    inceput.setHours(10, 0, 0, 0)
    const zi = inceput.toISOString().slice(0, 10)
    fireEvent.change(formular.getByLabelText(/^Zi/), { target: { value: zi } })

    const inainte = [...magazin.programare.values()].filter((p) => p.tratament_id === t.id).length
    fireEvent.click(formular.getByRole('button', { name: 'Adaugă programarea' }))

    await waitFor(() => {
      const acum = [...magazin.programare.values()].filter((p) => p.tratament_id === t.id)
      expect(acum.length).toBe(inainte + 1)
    }, ASTEPTARE)
  })

  it('suma ședinței se corectează la închidere și intră așa în încasare', async () => {
    await autentifica()
    // O ședință programată a unui tratament, deschisă din fișa lui.
    const t = await tratamentInCurs((t) => t.sedinte_programate > 0)
    const sedinta = (await api.programari.list({ tratament_id: t.id })).find((p) => p.stare === 'programat')!

    randeaza(<PaginaTratamente />)
    // Lista pune întâi tratamentele fără ședință programată; al nostru poate
    // fi pe altă pagină, deci se caută după client.
    fireEvent.change(await screen.findByLabelText('Caută tratamente', {}, ASTEPTARE), {
      target: { value: t.client_nume },
    })
    // Clientul poate avea mai multe tratamente: rândul se alege și după serviciu.
    const rand = await waitFor(() => {
      const gasit = screen
        .getAllByText(t.client_nume)
        .map((celula) => celula.closest('tr') ?? celula.closest('li'))
        .find((r) => r?.textContent?.includes(t.articol_denumire))
      if (!gasit) throw new Error('rândul tratamentului nu e încă pe ecran')
      return gasit
    }, ASTEPTARE)
    fireEvent.click(rand)
    const fisa = within(await screen.findByRole('dialog', { name: t.client_nume }, ASTEPTARE))

    // Rândul ședinței programate, apoi „Onorat” din detaliul ei — care se
    // deschide PESTE fișa tratamentului, deci e ultimul dialog din pagină.
    const randuri = await fisa.findAllByRole('button', { name: /Programat/ }, ASTEPTARE)
    fireEvent.click(randuri[0]!)
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(2), ASTEPTARE)
    const detaliu = within(screen.getAllByRole('dialog').at(-1)!)
    fireEvent.click(await detaliu.findByRole('button', { name: /^Onorat$/ }, ASTEPTARE))

    // A treia fereastră, peste celelalte două: „Ședință efectuată”.
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBe(3), ASTEPTARE)
    const inchidere = within(screen.getAllByRole('dialog').at(-1)!)
    expect(inchidere.getByText('Ședință efectuată')).toBeInTheDocument()
    const suma = await inchidere.findByLabelText(/Suma ședinței/, {}, ASTEPTARE)
    fireEvent.change(suma, { target: { value: '77,5' } })
    // Butoanele stau dezactivate cât se verifică acordul GDPR.
    const achitat = await inchidere.findByRole('button', { name: /Achitat acum, numerar/ }, ASTEPTARE)
    await waitFor(() => expect(achitat).toBeEnabled(), ASTEPTARE)
    fireEvent.click(achitat)

    await waitFor(() => {
      const dupa = magazin.programare.get(sedinta.id)!
      expect(dupa.stare).toBe('onorat')
      expect(dupa.pret).toBe(77.5)
    }, ASTEPTARE)
    // Linia de vânzare poartă suma corectată, nu prețul de dinainte.
    const linie = [...magazin.vanzare_linie.values()].find((l) => l.programare_id === sedinta.id)
    expect(linie?.pret_unitar).toBe(77.5)
  })
})
