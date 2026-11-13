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

/*
  Pe telefon (forma din jsdom) acțiunile secundare stau sub „Mai multe”, iar
  filtrele sub „Filtre”: antetul are două rânduri, nu o jumătate de ecran.
*/
async function deschideNotitaNoua() {
  fireEvent.click(await screen.findByRole('button', { name: 'Mai multe' }, ASTEPTARE))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Notiță nouă/ }, ASTEPTARE))
}

async function deschideFiltrele() {
  fireEvent.click(await screen.findByRole('button', { name: /^Filtre/ }, ASTEPTARE))
}

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

    await deschideNotitaNoua()
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

    await deschideNotitaNoua()
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

    // Selectorul de client din panoul de filtre nu are etichetă; se găsește
    // după substituentul afișat în el.
    await deschideFiltrele()
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

/*
  Antetul de telefon: două rânduri, nu o jumătate de ecran.

  jsdom se crede telefon (v. mai sus), deci aceste teste văd exact forma pe care
  o vede recepția pe mobil.
*/
describe('antet compact pe telefon', () => {
  it('nu are rând de titlu: intervalul stă pe butonul calendarului', async () => {
    await autentifica()
    randeaza(<PaginaProgramari />)
    await screen.findByRole('button', { name: 'Mai multe' }, ASTEPTARE)

    expect(screen.queryByRole('heading', { name: 'Programări' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Interval anterior' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adaugă' })).toBeInTheDocument()
  })

  it('ține filtrele strânse până se apasă „Filtre”, și numără filtrele puse', async () => {
    await autentifica()
    const client = (await api.clienti.list({ pe_pagina: 1 })).randuri[0]!
    randeaza(<PaginaProgramari />)

    // Strânse: selectoarele nu sunt pe ecran, deci programările au tot locul.
    const buton = await screen.findByRole('button', { name: /^Filtre/ }, ASTEPTARE)
    expect(buton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Toți clienții')).not.toBeInTheDocument()

    fireEvent.click(buton)
    expect(buton).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByText('Toți clienții').closest('button')!)
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(client.nume) }, ASTEPTARE))

    // Panoul se strânge la loc, dar un filtru uitat pus se vede pe buton.
    fireEvent.click(buton)
    expect(buton).toHaveAttribute('aria-expanded', 'false')
    expect(buton).toHaveTextContent(/Filtre\s*1/)
  })

  it('comută vederea din butoanele scurte, cu numele întreg pentru cititorul de ecran', async () => {
    await autentifica()
    randeaza(<PaginaProgramari />)

    const luna = await screen.findByRole('button', { name: 'Lună' }, ASTEPTARE)
    expect(luna).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(luna)
    expect(luna).toHaveAttribute('aria-pressed', 'true')
    // „Săpt.” pe ecran, „Săptămână” pentru cititorul de ecran.
    expect(screen.getByRole('button', { name: 'Săptămână' })).toHaveTextContent('Săpt.')
  })
})

/*
  Culorile procedurilor, dintr-un buton cu nume.

  Clinica a cerut „un buton care să se vadă clar” pentru culori, cu o paletă
  pentru fiecare procedură. Fereastra citește aceeași listă de servicii ca
  Nomenclatorul și calendarul, deci culoarea aleasă ajunge pe chipuri imediat.
*/
describe('culorile procedurilor', () => {
  it('„Culori” deschide lista procedurilor; culoarea apăsată se salvează pe loc', async () => {
    await autentifica()
    const serviciu = [...magazin.articol.values()].find((a) => a.tip === 'serviciu' && a.activ)!
    randeaza(<PaginaProgramari />)

    fireEvent.click(await screen.findByRole('button', { name: /^Culori/ }, ASTEPTARE))
    const fereastra = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    const paleta = await fereastra.findByRole(
      'group',
      { name: `Culoarea procedurii ${serviciu.denumire}` },
      ASTEPTARE,
    )

    fireEvent.click(within(paleta).getByRole('button', { name: 'Verde' }))
    // Bulina se mută pe loc, fără să aștepte serverul…
    expect(within(paleta).getByRole('button', { name: 'Verde' })).toHaveAttribute('aria-pressed', 'true')
    // …iar serverul primește culoarea, fără „Salvează” de apăsat.
    await waitFor(() => expect(magazin.articol.get(serviciu.id)?.culoare).toBe('#22c55e'), ASTEPTARE)

    // O scoate: înapoi la culoarea persoanei.
    fireEvent.click(within(paleta).getByRole('button', { name: 'Fără culoare' }))
    await waitFor(() => expect(magazin.articol.get(serviciu.id)?.culoare).toBeNull(), ASTEPTARE)
  })

  it('butonul „Culori” apare și pe conturile obișnuite, iar culoarea se salvează și de acolo', async () => {
    // Recepția: cont fără drepturi de administrator (nu poate schimba prețuri).
    const operator = await autentifica('andreea.popescu@clinica.ro')
    expect(operator.rol).not.toBe('administrator')
    const serviciu = [...magazin.articol.values()].find((a) => a.tip === 'serviciu' && a.activ)!
    randeaza(<PaginaProgramari />)

    fireEvent.click(await screen.findByRole('button', { name: /^Culori/ }, ASTEPTARE))
    const fereastra = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    const paleta = await fereastra.findByRole(
      'group',
      { name: `Culoarea procedurii ${serviciu.denumire}` },
      ASTEPTARE,
    )
    fireEvent.click(within(paleta).getByRole('button', { name: 'Albastru' }))

    await waitFor(() => expect(magazin.articol.get(serviciu.id)?.culoare).toBe('#3b82f6'), ASTEPTARE)
    // Nicio eroare de drepturi: bulina rămâne pe culoarea aleasă.
    expect(within(paleta).getByRole('button', { name: 'Albastru' })).toHaveAttribute('aria-pressed', 'true')
  })
})

/*
  Ziua „mare” de pe telefon (cerința Corinei, 13 nov. 2026): „când deschid pagina
  cu ziua de programări, fă-o mare, ca în softul vechi — cu culoarea pe tot
  blocul și scris mare”. jsdom se crede telefon, deci aici se vede forma ei.
*/
describe('ziua mare pe telefon', () => {
  /** O programare de 30 de minute, azi la 9:00, la o procedură cu culoare. */
  async function programareColorataAzi(nume: string) {
    const admin = await autentifica()
    const serviciu = [...magazin.articol.values()].find((a) => a.tip === 'serviciu' && a.activ)!
    await api.articole.update(serviciu.id, { culoare: '#3b82f6' })
    const clienta = await api.clienti.create({ nume })
    const inceput = new Date()
    inceput.setHours(9, 0, 0, 0)
    await api.programari.create({
      client_id: clienta.id,
      executant_id: admin.id,
      incepe_la: inceput.toISOString(),
      se_termina_la: new Date(inceput.getTime() + 30 * 60_000).toISOString(),
      servicii: [{ articol_id: serviciu.id, pret: 0 }],
    })
  }

  it('„Zi” arată ziua pe ore, cu blocul umplut în culoarea procedurii', async () => {
    await programareColorataAzi('Clientă Ziua Mare')
    randeaza(<PaginaProgramari />)

    fireEvent.click(await screen.findByRole('button', { name: 'Zi' }, ASTEPTARE))
    const bloc = await screen.findByTitle(/Clientă Ziua Mare/, {}, ASTEPTARE)

    // Tot blocul poartă culoarea, nu doar un punct lângă nume…
    expect(bloc).toHaveClass('bg-(--persoana)')
    expect(bloc.style.getPropertyValue('--persoana')).toBe('#3b82f6')
    // …și e înalt: 30 de minute la 96px/oră = 48px (−2 de aer), nu 26px.
    expect(bloc.style.height).toBe('46px')
    // Textul e mare.
    expect(bloc.querySelector('.text-\\[15px\\]')).not.toBeNull()
  })

  it('apăsat, blocul deschide detaliul programării', async () => {
    await programareColorataAzi('Clientă Detaliu Mare')
    randeaza(<PaginaProgramari />)

    fireEvent.click(await screen.findByRole('button', { name: 'Zi' }, ASTEPTARE))
    fireEvent.click(await screen.findByTitle(/Clientă Detaliu Mare/, {}, ASTEPTARE))

    const detaliu = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    expect(detaliu.getByText('Clientă Detaliu Mare')).toBeInTheDocument()
  })

  it('antetul unei zile din listă deschide ziua aceea, singură, pe ore', async () => {
    await autentifica()
    randeaza(<PaginaProgramari />)

    // Săptămâna e listă; a treia zi a ei, nu azi, ca să se vadă că ALEGE ziua.
    const zi = intervalPentruVedere(new Date(), 'saptamana').zile[2]!
    fireEvent.click(
      await screen.findByRole('button', { name: `Deschide ziua ${formateazaZiLunga(zi)}` }, ASTEPTARE),
    )

    // Vederea s-a mutat pe „Zi”, lista a dispărut, iar grila poartă data zilei.
    expect(screen.getByRole('button', { name: 'Zi' })).toHaveAttribute('aria-pressed', 'true')
    // Grila mare: 12 ore × 96px (cea obișnuită ar avea 672px).
    await waitFor(
      () => expect(document.querySelector('[style*="height: 1152px"]')).not.toBeNull(),
      ASTEPTARE,
    )
    expect(screen.getByText(formateazaZiLunga(zi), { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Deschide ziua/ })).not.toBeInTheDocument()
  })
})
