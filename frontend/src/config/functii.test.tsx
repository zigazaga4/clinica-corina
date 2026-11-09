import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/api'
import { navigarePentru } from '@/app/navigation'
import { PaginaClienti } from '@/features/clienti/PaginaClienti'
import { PaginaFisaClient } from '@/features/clienti/PaginaFisaClient'
import { PaginaNomenclator } from '@/features/nomenclator/PaginaNomenclator'
import { autentifica, randeaza } from '@/test/render'
import { functii, seteazaFunctii } from './functii'

/*
  Modul simplu (fork-ul pentru Corina Burcut, 9 nov. 2026): „o vrea cât mai
  simplă, nu vrea costuri”. Prețurile, plățile, produsele, statisticile și
  abonamentele sunt ascunse în spatele a două comutatoare, nu șterse.

  Ce se păzește aici: (1) cu comutatoarele oprite, niciun ecran de bani nu
  mai poate fi atins; (2) pornite la loc, totul revine — „vedem dacă mai vrea
  ceva adăugat” trebuie să însemne o variabilă, nu o rescriere.

  `test/setup.ts` le pornește pe amândouă înaintea fiecărui test (restul
  suitei verifică aplicația completă); aici le oprim pe cele necesare.
*/

const simplu = () => seteazaFunctii({ costuri: false, tratamente: false })

describe('comutatoarele', () => {
  it('în teste pornesc amândouă (restul suitei verifică aplicația completă)', () => {
    expect(functii).toEqual({ costuri: true, tratamente: true })
  })

  it('seteazaFunctii schimbă doar ce i s-a cerut', () => {
    seteazaFunctii({ costuri: false })
    expect(functii).toEqual({ costuri: false, tratamente: true })
  })
})

describe('navigația', () => {
  const cai = (esteAdministrator: boolean) => navigarePentru(esteAdministrator).map((e) => e.cale)

  it('modul simplu: calendar, clienți, nomenclator — fără bani și fără abonamente', () => {
    simplu()
    expect(cai(false)).toEqual(['/programari', '/clienti', '/nomenclator'])
    // Conturile și jurnalul rămân ale administratorului, ca înainte.
    expect(cai(true)).toEqual(['/programari', '/clienti', '/nomenclator', '/utilizatori', '/jurnal'])
  })

  it('cu costuri: apar Statistici și „Ședințe pe persoane”, nu și Tratamente', () => {
    seteazaFunctii({ costuri: true, tratamente: false })
    expect(cai(false)).toContain('/statistici')
    expect(cai(false)).toContain('/sedinte-pe-persoane')
    expect(cai(false)).not.toContain('/tratamente')
  })

  it('cu tratamente: apare pagina lor, nu și Statisticile', () => {
    seteazaFunctii({ costuri: false, tratamente: true })
    expect(cai(false)).toContain('/tratamente')
    expect(cai(false)).not.toContain('/statistici')
  })

  it('pornite amândouă: toate ecranele', () => {
    expect(cai(true)).toEqual(
      expect.arrayContaining([
        '/programari',
        '/clienti',
        '/tratamente',
        '/statistici',
        '/sedinte-pe-persoane',
        '/nomenclator',
        '/utilizatori',
        '/jurnal',
      ]),
    )
  })
})

describe('nomenclatorul, în modul simplu', () => {
  beforeEach(async () => {
    simplu()
    await autentifica('admin@clinica.ro')
  })

  it('doar proceduri: fără file de produse, fără „Produs nou”, fără coloană de preț', async () => {
    randeaza(<PaginaNomenclator />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(1))

    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: /Produs nou/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Vinde produse/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Serviciu nou/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Preț/ })).toBeNull()
    expect(document.body).not.toHaveTextContent(/RON/)
  })

  it('o procedură nouă se adaugă fără preț, cu durată și culoare; prețul rămâne 0', async () => {
    randeaza(<PaginaNomenclator />)
    await screen.findByRole('heading', { name: 'Nomenclator' })

    fireEvent.click(screen.getByRole('button', { name: /Serviciu nou/ }))
    const dialog = document.querySelector('dialog') as HTMLElement

    // Nici preț, nici tip, nici număr de ședințe: doar ce are nevoie o procedură.
    expect(within(dialog).queryByLabelText(/Preț listă/)).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Produs' })).toBeNull()
    expect(within(dialog).queryByLabelText(/Număr de ședințe/)).toBeNull()
    expect(within(dialog).getByLabelText(/Durată/)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/Denumire/), { target: { value: 'Epilare simplă' } })
    fireEvent.change(within(dialog).getByLabelText(/Durată/), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adaugă' }))

    await waitFor(async () => {
      const [nou] = await api.articole.list({ q: 'Epilare simplă' })
      expect(nou?.tip).toBe('serviciu')
      expect(nou?.pret_lista).toBe(0)
      expect(nou?.numar_sedinte).toBe(1)
    })
  })

  it('la o procedură existentă, prețul din bază rămâne neatins când se schimbă altceva', async () => {
    const existent = await api.articole.create({
      tip: 'serviciu',
      denumire: 'Procedură cu preț vechi',
      pret_lista: 250,
      durata_minute: 45,
    })
    randeaza(<PaginaNomenclator />)
    await screen.findByRole('heading', { name: 'Nomenclator' })

    fireEvent.change(screen.getByRole('searchbox', { name: /Caută/ }), {
      target: { value: 'Procedură cu preț vechi' },
    })
    // Tabelul își randează și cardul de telefon (ascuns din CSS): două potriviri.
    fireEvent.click((await screen.findAllByText('Procedură cu preț vechi'))[0]!)
    const dialog = document.querySelector('dialog') as HTMLElement
    fireEvent.change(within(dialog).getByLabelText(/Durată/), { target: { value: '60' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Salvează/ }))

    await waitFor(async () => {
      const [dupa] = await api.articole.list({ q: existent.denumire })
      expect(dupa?.durata_minute).toBe(60)
      expect(dupa?.pret_lista).toBe(250)
    })
  })
})

describe('nomenclatorul, cu costuri pornite', () => {
  it('prețul, tipul și filele de produse sunt la locul lor', async () => {
    await autentifica('admin@clinica.ro')
    randeaza(<PaginaNomenclator />)
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(1))

    fireEvent.click(screen.getByRole('button', { name: /Serviciu nou/ }))
    const dialog = document.querySelector('dialog') as HTMLElement
    expect(within(dialog).getByLabelText(/Preț listă/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Produs' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Număr de ședințe/)).toBeInTheDocument()
  })
})

describe('lista de clienți', () => {
  it('modul simplu: fără „Vânzări” și fără „De plată”', async () => {
    simplu()
    await autentifica('admin@clinica.ro')
    randeaza(<PaginaClienti />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))

    const antete = screen.getAllByRole('columnheader').map((a) => a.textContent)
    expect(antete).toContain('Programări')
    expect(antete).not.toContain('Vânzări')
    expect(antete).not.toContain('De plată')
  })

  it('cu costuri: coloanele de bani sunt la loc', async () => {
    await autentifica('admin@clinica.ro')
    randeaza(<PaginaClienti />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr').length).toBeGreaterThan(0))

    const antete = screen.getAllByRole('columnheader').map((a) => a.textContent)
    expect(antete).toContain('Vânzări')
    expect(antete).toContain('De plată')
  })
})

describe('fișa clientului', () => {
  /** O clientă cu o ședință onorată și neachitată (150 RON) — restanță în aplicația completă. */
  async function clientaCuRestanta() {
    await autentifica('admin@clinica.ro')
    const client = await api.clienti.create({ nume: 'Clientă Cu Restanță' })
    const serviciu = (await api.articole.list({ tip: 'serviciu', activ: true }))[0]!
    const executant = (await api.utilizatori.list({ activ: true }))[0]!
    const incepe = new Date()
    incepe.setFullYear(incepe.getFullYear() + 1)
    incepe.setHours(9, 0, 0, 0)
    const programare = await api.programari.create({
      client_id: client.id,
      articol_id: serviciu.id,
      executant_id: executant.id,
      incepe_la: incepe.toISOString(),
      se_termina_la: new Date(incepe.getTime() + 60 * 60_000).toISOString(),
      pret: 150,
    })
    await api.programari.schimbaStarea(programare.id, 'onorat')
    return { client, serviciu }
  }

  const randeazaFisa = (clientId: string) =>
    randeaza(
      <Routes>
        <Route path="/clienti/:id" element={<PaginaFisaClient />} />
      </Routes>,
      `/clienti/${clientId}`,
    )

  it('modul simplu: ședința apare în istoric, dar fără preț, restanță sau „Vinde produse”', async () => {
    simplu()
    const { client, serviciu } = await clientaCuRestanta()
    randeazaFisa(client.id)

    expect((await screen.findAllByText(serviciu.denumire)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/De plată/)).toBeNull()
    expect(screen.queryByText(/neîncasate/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Vinde produse/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Încasează/ })).toBeNull()
    expect(document.body).not.toHaveTextContent(/RON/)
  })

  it('cu costuri pornite: restanța și „Vinde produse” sunt la loc', async () => {
    const { client } = await clientaCuRestanta()
    randeazaFisa(client.id)

    expect(await screen.findByText(/De plată:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vinde produse/ })).toBeInTheDocument()
  })
})
