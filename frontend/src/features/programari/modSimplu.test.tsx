import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { magazin } from '@/api/memory/store'
import { seteazaFunctii } from '@/config/functii'
import { EroarePad, porneste } from '@/features/consimtamant/pad'
import type { ProgramareDetaliu } from '@/domain/types'
import { autentifica, randeaza } from '@/test/render'
import { DetaliuProgramare } from './DetaliuProgramare'
import { FormularProgramare } from './FormularProgramare'
import { ListaAgenda } from './ListaAgenda'

/*
  Programarea în modul simplu (fork-ul pentru Corina Burcut, 9 nov. 2026):
  fără prețuri, fără plăți, fără „Total”. Recepția alege clientul, procedura și
  ora — atât. „Onorat” înseamnă că a venit, nu că a plătit.

  Serverul rămâne același: o programare nouă pleacă cu prețul 0 și nu cere
  plată, deci nici o restanță nu apare în date.
*/

vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

/** Zi departe de agenda generată, ca să nu se ciocnească de nimic. */
const ZI = new Date(2033, 4, 17, 10, 0)

// Implicit telefon / browser; probele cu tableta se mută pe calculatorul din recepție.
vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => false) }))
vi.mock('@/features/consimtamant/pad', async (importActual) => {
  const real = await importActual<typeof import('@/features/consimtamant/pad')>()
  return { ...real, porneste: vi.fn() }
})

beforeEach(() => {
  seteazaFunctii({ costuri: false, tratamente: false })
  vi.mocked(isTauri).mockReturnValue(false)
  vi.mocked(porneste).mockReset()
})

const serviciul = (denumire: string) => {
  const articol = [...magazin.articol.values()].find((a) => a.denumire === denumire)
  if (!articol) throw new Error(`Nomenclatorul demo nu are „${denumire}”.`)
  return articol
}

async function programare(): Promise<ProgramareDetaliu[]> {
  const admin = await autentifica('admin@clinica.ro')
  const clienta = await api.clienti.create({ nume: 'Clientă Mod Simplu' })
  const prima = await api.programari.create({
    client_id: clienta.id,
    executant_id: admin.id,
    incepe_la: ZI.toISOString(),
    se_termina_la: new Date(ZI.getTime() + 45 * 60_000).toISOString(),
    servicii: [{ articol_id: serviciul('Manichiură clasică').id, pret: 0 }],
  })
  return api.programari.list({ vizita_id: prima.vizita_id })
}

describe('formularul de programare', () => {
  it('fără preț, fără total, fără plată — și programarea se salvează', async () => {
    await autentifica('admin@clinica.ro')
    const clienta = await api.clienti.create({ nume: 'Clientă Fără Preț' })
    randeaza(
      <FormularProgramare
        deschisa
        onInchide={() => undefined}
        loc={{ inceput: ZI, sfarsit: null, executantId: null, clientId: clienta.id }}
      />,
    )
    const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    await waitFor(() => expect(formular.getByLabelText(/^Ziua/)).not.toHaveValue(''), ASTEPTARE)

    fireEvent.click(formular.getByRole('combobox', { name: /^Serviciu/ }))
    fireEvent.change(await formular.findByLabelText('Caută în listă', {}, ASTEPTARE), {
      target: { value: 'Manichiură clasică' },
    })
    fireEvent.click(await formular.findByRole('option', { name: /Manichiură clasică/ }, ASTEPTARE))
    await waitFor(
      () => expect(formular.getByRole('combobox', { name: /^Serviciu/ })).toHaveTextContent('Manichiură clasică'),
      ASTEPTARE,
    )

    // Niciun semn de bani în toată fereastra.
    expect(formular.queryByLabelText(/^Preț/)).toBeNull()
    expect(formular.queryByText(/Total/)).toBeNull()
    expect(formular.queryByText(/RON/)).toBeNull()
    expect(formular.queryByRole('button', { name: /Achitat/ })).toBeNull()
    // Nici „încă un serviciu” cu sume pe fiecare, nici abonamente.
    expect(formular.queryByText(/Reducere/)).toBeNull()
    expect(formular.queryByText(/Ședința \d/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Adaugă programarea' }))
    await waitFor(() => {
      const ale = [...magazin.programare.values()].filter((p) => p.client_id === clienta.id)
      expect(ale).toHaveLength(1)
      expect(ale[0]?.pret).toBe(0)
      expect(ale[0]?.stare).toBe('programat')
    }, ASTEPTARE)
    // Nicio vânzare nu s-a născut din ea.
    const [creata] = [...magazin.programare.values()].filter((p) => p.client_id === clienta.id)
    expect([...magazin.vanzare_linie.values()].some((l) => l.programare_id === creata!.id)).toBe(false)
  })
})

describe('agenda', () => {
  it('rândul unei programări nu arată nicio sumă', async () => {
    const servicii = await programare()
    randeaza(<ListaAgenda zile={[ZI]} programari={servicii} onAlegeProgramare={() => undefined} />)

    const rand = await screen.findByRole('button', { name: /Clientă Mod Simplu/ }, ASTEPTARE)
    expect(rand).toHaveTextContent('Manichiură clasică')
    expect(rand).not.toHaveTextContent(/RON|\d,\d{2}/)
  })
})

describe('fereastra programării', () => {
  it('fără sumă, fără „Total”; „Onorat” se bifează direct, fără întrebarea de plată', async () => {
    const servicii = await programare()
    randeaza(
      <DetaliuProgramare programare={servicii[0]!} onInchide={() => undefined} onModifica={() => undefined} />,
    )
    const detaliu = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    expect((await detaliu.findAllByText('Manichiură clasică', {}, ASTEPTARE)).length).toBeGreaterThan(0)
    expect(detaliu.queryByText(/^Total/)).toBeNull()
    expect(detaliu.queryByText(/RON/)).toBeNull()
    expect(detaliu.queryByText(/Achitat|De plată|Neachitat/)).toBeNull()

    fireEvent.click(detaliu.getByRole('button', { name: /^Onorat$/ }))

    // Nicio a doua fereastră („Programare efectuată”, cu plata): starea se schimbă pe loc.
    await waitFor(() => expect(magazin.programare.get(servicii[0]!.id)?.stare).toBe('onorat'), ASTEPTARE)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByText('Programare efectuată')).toBeNull()
    expect([...magazin.vanzare_linie.values()].some((l) => l.programare_id === servicii[0]!.id)).toBe(false)
  })

  /*
    Pe calculatorul din recepție, „Onorat” cere întâi acordul GDPR pe tabletă,
    și fără bani: fereastra de încasare n-are ce întreba, dar semnătura da.
  */
  it('pe calculator, „Onorat” cere întâi acordul GDPR, apoi închide ședința fără plată', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(porneste).mockRejectedValue(
      new EroarePad('Nu s-a găsit nicio tabletă de semnat. Verificați cablul USB.'),
    )
    const servicii = await programare()
    randeaza(
      <DetaliuProgramare programare={servicii[0]!} onInchide={() => undefined} onModifica={() => undefined} />,
    )
    const detaliu = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    fireEvent.click(await detaliu.findByRole('button', { name: /^Onorat$/ }, ASTEPTARE))

    expect(await screen.findByText('Acord privind prelucrarea datelor', {}, ASTEPTARE)).toBeInTheDocument()
    expect(await screen.findByText(/Nu s-a găsit nicio tabletă/, {}, ASTEPTARE)).toBeInTheDocument()
    expect(magazin.programare.get(servicii[0]!.id)?.stare).toBe('programat')

    fireEvent.click(screen.getByRole('button', { name: 'Continuă fără acord' }))

    await waitFor(() => expect(magazin.programare.get(servicii[0]!.id)?.stare).toBe('onorat'), ASTEPTARE)
    // Fereastra cu plata nu s-a deschis deloc: deschis rămâne doar detaliul.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: 'Ședință efectuată' })).toBeNull()
    expect([...magazin.vanzare_linie.values()].some((l) => l.programare_id === servicii[0]!.id)).toBe(false)
  })

  it('pe calculator, „Renunță” la acord lasă ședința neatinsă', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(porneste).mockRejectedValue(new EroarePad('Serviciul tabletei de semnat nu răspunde.'))
    const servicii = await programare()
    randeaza(
      <DetaliuProgramare programare={servicii[0]!} onInchide={() => undefined} onModifica={() => undefined} />,
    )
    const detaliu = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    fireEvent.click(await detaliu.findByRole('button', { name: /^Onorat$/ }, ASTEPTARE))
    await screen.findByText(/Serviciul tabletei de semnat nu răspunde/, {}, ASTEPTARE)

    fireEvent.click(screen.getByRole('button', { name: 'Renunță' }))

    await waitFor(() => expect(screen.queryByText('Acord privind prelucrarea datelor')).toBeNull(), ASTEPTARE)
    expect(magazin.programare.get(servicii[0]!.id)?.stare).toBe('programat')
  })
})
