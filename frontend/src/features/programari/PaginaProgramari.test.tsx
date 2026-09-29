import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { magazin } from '@/api/memory/store'
import { addDays, formateazaZiLunga, intervalPentruVedere, laInputDate } from '@/lib/dates'
import { autentifica, randeaza } from '@/test/render'
import { PaginaProgramari } from './PaginaProgramari'

/*
  Notițele în calendar, prin ecranul real.

  Regulile lor stau în `@/api/memory/client.test.ts`. Aici se verifică faptul
  că ecranul chiar le folosește: că o notiță din „bază” apare în agendă lângă
  programări, că se deschide, că se face din buton și că se poate șterge —
  gesturile pe care le face recepția.

  jsdom nu are lățime de ecran, iar completarea lui `matchMedia` răspunde
  „nu” la orice interogare: ecranul se crede telefon și desenează agenda ca
  listă. Testele caută deci RÂNDUL notiței, nu chipul din grilă — și e bine
  așa, fiindcă rândul e forma pe care o vede recepția pe tabletă.
*/

/*
  Ecranul e greu: o săptămână întreagă de programări, fiecare rând cu hook-urile
  lui. Rulat singur trece într-o secundă; în suita întreagă, cu celelalte
  fișiere în paralel pe aceleași nuclee, pragurile implicite nu ajung.
*/
vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

/** Rândul notiței din agendă — un buton al cărui nume conține titlul. */
const randulNotitei = (titlu: string) =>
  screen.findByRole('button', { name: new RegExp(titlu) }, ASTEPTARE)

/** Notița de azi din datele demo — „Curățenie generală”, 8:00–10:00. */
function notitaDeAzi() {
  const azi = new Date()
  for (const n of magazin.notita.values()) {
    const d = new Date(n.incepe_la)
    if (d.toDateString() === azi.toDateString()) return n
  }
  throw new Error('Datele demo nu au o notiță pentru azi.')
}

describe('notițe în calendar', () => {
  it('arată notița zilei în agendă, alături de programări', async () => {
    await autentifica()
    const notita = notitaDeAzi()
    randeaza(<PaginaProgramari />)

    const rand = await randulNotitei(notita.titlu)
    expect(rand).toHaveTextContent('Toată clinica')
    // Antetul zilei le numără separat: notița nu e o programare.
    expect((await screen.findAllByText(/1 notiță/, {}, ASTEPTARE)).length).toBeGreaterThan(0)
  })

  it('deschide detaliul notiței și o șterge, cu confirmare', async () => {
    await autentifica()
    const notita = notitaDeAzi()
    randeaza(<PaginaProgramari />)

    fireEvent.click(await randulNotitei(notita.titlu))
    const detaliu = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    expect(detaliu.getByText('Toată clinica')).toBeInTheDocument()

    fireEvent.click(detaliu.getByRole('button', { name: /Șterge/ }))
    // Confirmarea este a doua fereastră deschisă; se apasă butonul EI.
    await screen.findByText(/Ștergi notița\?/, {}, ASTEPTARE)
    const ferestre = screen.getAllByRole('dialog')
    const confirmare = within(ferestre[ferestre.length - 1]!)
    fireEvent.click(confirmare.getByRole('button', { name: /^Șterge$/ }))

    await waitFor(() => expect(magazin.notita.has(notita.id)).toBe(false), ASTEPTARE)
  })

  it('adaugă o notiță din buton, fără client și fără preț', async () => {
    await autentifica()
    randeaza(<PaginaProgramari />)
    const inainte = magazin.notita.size

    fireEvent.click(await screen.findByRole('button', { name: /Notiță nouă/ }, ASTEPTARE))
    const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    expect(formular.queryByRole('combobox', { name: /^Client/ })).not.toBeInTheDocument()
    expect(formular.queryByLabelText(/Preț/)).not.toBeInTheDocument()

    fireEvent.change(formular.getByLabelText(/Titlu/), { target: { value: 'Vine curierul' } })
    fireEvent.click(formular.getByRole('button', { name: 'Adaugă notița' }))

    await waitFor(() => expect(magazin.notita.size).toBe(inainte + 1), ASTEPTARE)
    const noua = [...magazin.notita.values()].find((n) => n.titlu === 'Vine curierul')
    // Implicit pentru toată clinica, de o oră.
    expect(noua?.executant_id).toBeNull()
    expect(new Date(noua!.se_termina_la).getTime() - new Date(noua!.incepe_la).getTime()).toBe(
      60 * 60_000,
    )
  })

  it('oprește o notiță fără titlu înainte să ajungă la server', async () => {
    await autentifica()
    randeaza(<PaginaProgramari />)
    const inainte = magazin.notita.size

    fireEvent.click(await screen.findByRole('button', { name: /Notiță nouă/ }, ASTEPTARE))
    const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    fireEvent.click(formular.getByRole('button', { name: 'Adaugă notița' }))

    expect(await formular.findByText('Scrie un titlu.')).toBeInTheDocument()
    expect(magazin.notita.size).toBe(inainte)
  })

  it('filtrul pe client ascunde notițele — nu îl privesc', async () => {
    await autentifica()
    const notita = notitaDeAzi()
    const client = (await api.clienti.list({ pe_pagina: 1 })).randuri[0]!
    randeaza(<PaginaProgramari />)
    await randulNotitei(notita.titlu)

    // Selectorul de client din bara de filtre nu are etichetă; se găsește
    // după substituentul afișat în el.
    fireEvent.click(screen.getByText('Toți clienții').closest('button')!)
    const optiune = await screen.findByRole('option', { name: new RegExp(client.nume) }, ASTEPTARE)
    fireEvent.click(optiune)

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: new RegExp(notita.titlu) }),
      ).not.toBeInTheDocument(),
    ASTEPTARE)
  })
})

/*
  Programare din locul apăsat în calendar — aici prin agendă, forma din jsdom
  (și de pe telefon). Grila orară își are testele în `GrilaOre.test.tsx`.
*/
describe('programare direct din calendar', () => {
  it('„+” pe o zi deschide „Programare nouă” în ziua aceea, la deschiderea clinicii', async () => {
    await autentifica()
    randeaza(<PaginaProgramari />)

    // Săptămâna viitoare: nicio zi nu e azi, deci ora propusă e 8:00.
    fireEvent.click(await screen.findByRole('button', { name: 'Interval următor' }, ASTEPTARE))
    const luni = intervalPentruVedere(addDays(new Date(), 7), 'saptamana').zile[0]!
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: `Programare nouă pe ${formateazaZiLunga(luni)}` },
        ASTEPTARE,
      ),
    )

    const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    expect(formular.getByText('Programare nouă')).toBeInTheDocument()
    expect(formular.getByLabelText(/^Ziua/)).toHaveValue(laInputDate(luni))
    expect(formular.getByLabelText(/^Ora/)).toHaveValue('08:00')
  })
})
