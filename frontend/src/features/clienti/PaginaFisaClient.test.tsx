import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/api'
import type { Uuid } from '@/domain/types'
import { autentifica, randeaza } from '@/test/render'
import { PaginaFisaClient } from './PaginaFisaClient'

/*
  Fișa clientului, pe traseul care a fost cerut explicit de Beneficiar:
  „ședințele să-și arate prețul, iar cine vine de mai multe ori să plătească la
  final”.

  Testele din `@/api/memory/client.test.ts` verifică regulile. Acesta verifică
  altceva: că ecranul chiar le folosește — că restanța se vede fără să sapi după
  ea, că fereastra de încasare adună exact ședințele neachitate, și că după
  apăsare banii chiar sunt înregistrați.
*/

/** Randează fișa pe ruta reală, ca `useParams` să primească identificatorul. */
function randeazaFisa(clientId: Uuid) {
  return randeaza(
    <Routes>
      <Route path="/clienti/:id" element={<PaginaFisaClient />} />
    </Routes>,
    `/clienti/${clientId}`,
  )
}

/** Citește o sumă dintr-un text românesc: „1.234,50 RON” -> 1234.5 */
function sumaDinText(text: string): number {
  const potrivire = /(\d[\d.]*,\d{2})/.exec(text)
  if (!potrivire?.[1]) return Number.NaN
  return Number(potrivire[1].replace(/\./g, '').replace(',', '.'))
}

/**
 * Un client curat, cu exact două ședințe onorate și neachitate.
 *
 * Datele demo au deja restanțe, dar în cantități care variază de la o fișă la
 * alta. Un client construit aici face testul să afirme sume EXACTE, nu „mai
 * mare ca zero” — singura formă în care o greșeală de adunare ar fi prinsă.
 */
async function clientCuDouaRestante(): Promise<{
  id: Uuid
  total: number
  serviciu: string
  programare_ids: Uuid[]
}> {
  await autentifica()
  const client = await api.clienti.create({ nume: 'Ana Restantă' })

  const serviciu = (await api.articole.list({ tip: 'serviciu', activ: true }))[0]
  const executant = (await api.utilizatori.list({ activ: true }))[0]
  if (!serviciu || !executant) throw new Error('Datele demo nu conțin serviciu sau cont activ.')

  const anViitor = new Date()
  anViitor.setFullYear(anViitor.getFullYear() + 1)

  const programare_ids: Uuid[] = []
  const preturi = [150, 90]
  for (const [indice, pret] of preturi.entries()) {
    const incepe = new Date(anViitor)
    incepe.setHours(9 + indice * 2, 0, 0, 0)
    const seTermina = new Date(incepe)
    seTermina.setHours(incepe.getHours() + 1)

    const programare = await api.programari.create({
      client_id: client.id,
      articol_id: serviciu.id,
      executant_id: executant.id,
      incepe_la: incepe.toISOString(),
      se_termina_la: seTermina.toISOString(),
      pret,
    })
    await api.programari.schimbaStarea(programare.id, 'onorat')
    programare_ids.push(programare.id)
  }

  return { id: client.id, total: 240, serviciu: serviciu.denumire, programare_ids }
}

it('arată restanța clientului și prețul fiecărei ședințe', async () => {
  const { id, total } = await clientCuDouaRestante()
  randeazaFisa(id)

  const banda = await screen.findByText(/De plată:/)
  expect(sumaDinText(banda.textContent ?? '')).toBe(total)
  expect(screen.getByText(/2 ședințe neîncasate/)).toBeInTheDocument()

  // Ambele ședințe poartă însemnul „De plată”, nu doar banda de sus.
  await waitFor(() => expect(screen.getAllByText('De plată')).toHaveLength(2))
})

it('nu arată banda de plată unui client fără restanțe', async () => {
  await autentifica()
  const client = await api.clienti.create({ nume: 'Fără Datorii' })
  randeazaFisa(client.id)

  expect(await screen.findByText('Fără Datorii')).toBeInTheDocument()
  expect(screen.queryByText(/De plată:/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Încasează' })).toBeNull()
})

it('încasează într-o singură plată toate ședințele rămase', async () => {
  const { id, total } = await clientCuDouaRestante()
  randeazaFisa(id)

  fireEvent.click(await screen.findByRole('button', { name: 'Încasează' }))

  // Butonul de confirmare poartă suma: operatoarea o citește înainte de a apăsa.
  const fereastra = within(screen.getByRole('dialog'))
  const confirma = await fereastra.findByRole('button', { name: /^Încasează / })
  expect(sumaDinText(confirma.textContent ?? '')).toBe(total)

  const inainte = (await api.vanzari.list({ client_id: id })).total
  fireEvent.click(confirma)

  await waitFor(async () => {
    const dupa = await api.vanzari.list({ client_id: id })
    // O SINGURĂ încasare pentru amândouă — asta a cerut Beneficiarul.
    expect(dupa.total).toBe(inainte + 1)
    expect(dupa.randuri[0]?.total).toBe(total)
    expect(dupa.randuri[0]?.linii).toHaveLength(2)
  })

  // Restanța dispare de pe fișă fără reîncărcare: invalidarea din
  // `useIncaseaza` trebuie să atingă și istoricul clientului.
  await waitFor(() => expect(screen.queryByText(/De plată:/)).toBeNull())
})

it('nu repetă ședința ca rând de bon după ce a fost încasată', async () => {
  // Reclamația Beneficiarului: aceeași ședință apărea de două ori în
  // cronologie — o dată ca ședință, o dată în bonul care a plătit-o.
  const { id, serviciu, programare_ids } = await clientCuDouaRestante()
  await api.vanzari.incaseaza({ client_id: id, programare_ids })

  randeazaFisa(id)

  // De două ori: o dată pentru fiecare ședință. Nu de patru.
  await waitFor(() => expect(screen.getAllByText(serviciu)).toHaveLength(2))
  expect(screen.getAllByText('Achitat')).toHaveLength(2)
  expect(screen.queryByText(/^Ședința din/)).toBeNull()

  // Filă și cronologie numără la fel; altfel eticheta ar promite mai mult
  // decât se vede dedesubt.
  expect(screen.getByRole('tab', { name: /Istoric/ })).toHaveTextContent('2')
})

it('păstrează produsele cumpărate, chiar plătite odată cu ședințele', async () => {
  const { id, serviciu, programare_ids } = await clientCuDouaRestante()
  const produs = (await api.articole.list({ tip: 'produs', activ: true }))[0]
  if (!produs) throw new Error('Datele demo nu conțin niciun produs activ.')

  await api.vanzari.incaseaza({
    client_id: id,
    programare_ids,
    linii: [{ articol_id: produs.id, cantitate: 2 }],
  })

  randeazaFisa(id)

  // Crema nu are altă intrare în care să apară, deci bonul rămâne — dar redus
  // la ea, cu totalul ei, nu al bonului întreg.
  // Două bucăți pe un singur rând — antetul numără bucățile, nu rândurile.
  expect(await screen.findByText('2 produse cumpărate')).toBeInTheDocument()
  expect(screen.getByText(produs.denumire)).toBeInTheDocument()
  expect(screen.getAllByText(serviciu)).toHaveLength(2)
})

it('adună produsele neachitate la „De plată” și le încasează odată cu ședințele', async () => {
  const { id, total } = await clientCuDouaRestante()
  const produs = (await api.articole.list({ tip: 'produs', activ: true }))[0]
  if (!produs) throw new Error('Datele demo nu conțin niciun produs activ.')
  const datorie = await api.vanzari.create({
    client_id: id,
    efectuat_la: new Date().toISOString(),
    achitat: false,
    linii: [{ articol_id: produs.id, cantitate: 2, pret_unitar: 250 }],
  })

  randeazaFisa(id)

  const banda = await screen.findByText(/De plată:/)
  expect(sumaDinText(banda.textContent ?? '')).toBe(total + 500)
  // Căutat în bandă: fereastra de încasare, închisă, spune și ea câte sunt.
  expect(banda.parentElement).toHaveTextContent(
    /2 ședințe neîncasate · 1 vânzare de produse neachitată/,
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Încasează' }))
  const fereastra = within(screen.getByRole('dialog'))
  // Două ședințe și o vânzare: trei bife, toate bifate.
  expect(await fereastra.findAllByRole('checkbox')).toHaveLength(3)
  const confirma = fereastra.getByRole('button', { name: /^Încasează / })
  expect(sumaDinText(confirma.textContent ?? '')).toBe(total + 500)
  fireEvent.click(confirma)

  await waitFor(async () => {
    expect((await api.vanzari.get(datorie.id)).achitat).toBe(true)
    const lista = await api.clienti.list({ q: 'Ana Restantă', pe_pagina: 500 })
    expect(lista.randuri.find((c) => c.id === id)?.de_incasat).toBe(0)
  })
  await waitFor(() => expect(screen.queryByText(/De plată:/)).toBeNull())
})

it('trece o vânzare de produse achitată chiar de pe rândul ei din fișă', async () => {
  await autentifica()
  const client = await api.clienti.create({ nume: 'Maria Datoare' })
  const produs = (await api.articole.list({ tip: 'produs', activ: true }))[0]
  if (!produs) throw new Error('Datele demo nu conțin niciun produs activ.')
  const datorie = await api.vanzari.create({
    client_id: client.id,
    efectuat_la: new Date().toISOString(),
    achitat: false,
    linii: [{ articol_id: produs.id, cantitate: 1, pret_unitar: 500 }],
  })

  randeazaFisa(client.id)

  fireEvent.click(await screen.findByRole('button', { name: /^Achitat$/ }))
  await waitFor(async () => expect((await api.vanzari.get(datorie.id)).achitat).toBe(true))
  await waitFor(() => expect(screen.queryByText(/De plată:/)).toBeNull())

  // Și înapoi: „Neachitat” readuce datoria.
  fireEvent.click(screen.getByRole('button', { name: /^Neachitat$/ }))
  expect(await screen.findByText(/De plată:/)).toBeInTheDocument()
})

it('debifarea unei ședințe scade totalul de încasat', async () => {
  const { id } = await clientCuDouaRestante()
  randeazaFisa(id)

  fireEvent.click(await screen.findByRole('button', { name: 'Încasează' }))
  const fereastra = within(screen.getByRole('dialog'))

  const bife = await fereastra.findAllByRole('checkbox')
  expect(bife).toHaveLength(2)
  fireEvent.click(bife[0] as HTMLElement)

  // 240 - 150 sau 240 - 90, în funcție de ordinea cronologică; oricum, mai puțin.
  const confirma = fereastra.getByRole('button', { name: /^Încasează / })
  const ramas = sumaDinText(confirma.textContent ?? '')
  expect(ramas).toBeLessThan(240)
  expect(ramas).toBeGreaterThan(0)
})
