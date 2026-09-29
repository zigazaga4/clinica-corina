import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { magazin } from '@/api/memory/store'
import { autentifica, randeaza } from '@/test/render'
import { FormularProgramare } from './FormularProgramare'
import type { LocAles } from './locAles'

/*
  Clientul și serviciul „pe loc”, din formularul de programare.

  Recepția are omul la telefon. Îi tastează numele în selector, nu îl găsește,
  și îl adaugă cu aceeași mișcare — fără să părăsească formularul, fără fișă
  completă. Testele de aici verifică exact acel drum: textul tastat devine
  rândul nou, rândul nou rămâne ales, iar în „bază” intră doar numele.
*/

// Praguri largi: în suita întreagă, fișierele rulează în paralel pe aceleași
// nuclee, iar cele implicite nu ajung pentru un formular cu trei selectoare.
vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

/** Randează formularul deschis și așteaptă fereastra — sesiunea se verifică asincron. */
async function deschide() {
  randeaza(<FormularProgramare deschisa onInchide={() => undefined} />)
  return within(await screen.findByRole('dialog', {}, ASTEPTARE))
}

/** Opțiunile listei deschise a selectorului, nu ale `<select>`-urilor native. */
const optiuniDeschise = (formular: ReturnType<typeof within>) =>
  within(formular.getByRole('listbox')).queryAllByRole('option')

/** Deschide un selector și scrie în căutarea lui. */
async function cautaIn(formular: ReturnType<typeof within>, eticheta: RegExp, text: string) {
  fireEvent.click(formular.getByRole('combobox', { name: eticheta }))
  const cautare = await formular.findByLabelText('Caută în listă', {}, ASTEPTARE)
  fireEvent.change(cautare, { target: { value: text } })
  return cautare
}

/** Formularul unei programări noi, pornit din locul dat. */
async function deschideLa(l: LocAles) {
  randeaza(<FormularProgramare deschisa onInchide={() => undefined} loc={l} />)
  const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))
  // Câmpurile se completează într-un efect, după prima pictare a ferestrei;
  // în suita întreagă, cu nucleele ocupate, fereastra se găsește înaintea lui.
  await waitFor(() => expect(formular.getByLabelText(/^Ziua/)).not.toHaveValue(''), ASTEPTARE)
  return formular
}

const durata = (formular: ReturnType<typeof within>) =>
  (formular.getByLabelText(/^Durata/) as HTMLSelectElement).value

describe('client nou din formularul de programare', () => {
  it('oferă crearea cu numele tastat și îl lasă ales', async () => {
    await autentifica()
    const formular = await deschide()
    const inainte = magazin.client.size

    await cautaIn(formular, /^Client/, 'Popescu Ana-Maria')
    fireEvent.click(await formular.findByRole('button', { name: /Client nou: „Popescu Ana-Maria”/ }, ASTEPTARE))

    // Fișa există, doar cu numele; restul se completează pe fișă, mai târziu.
    await waitFor(() => expect(magazin.client.size).toBe(inainte + 1), ASTEPTARE)
    const noua = [...magazin.client.values()].find((c) => c.nume === 'Popescu Ana-Maria')
    expect(noua).toBeDefined()
    expect(noua?.telefon).toBeNull()
    expect(noua?.email).toBeNull()

    // Și rămâne aleasă în câmp, nu doar creată undeva.
    await waitFor(() =>
      expect(formular.getByRole('combobox', { name: /^Client/ })).toHaveTextContent(
        'Popescu Ana-Maria',
      ),
    ASTEPTARE)
  })

  it('Enter fără nicio potrivire face același lucru ca butonul', async () => {
    await autentifica()
    const formular = await deschide()
    const inainte = magazin.client.size

    const cautare = await cautaIn(formular, /^Client/, 'Nume Inexistent Sigur')
    // Lista de pe server sosește goală pentru un nume care nu există. Se
    // numără doar în lista deschisă: `<select>`-urile de oră și durată din
    // același formular au și ele zeci de `option`.
    await waitFor(() => expect(optiuniDeschise(formular)).toHaveLength(0), ASTEPTARE)
    fireEvent.keyDown(cautare, { key: 'Enter' })

    await waitFor(() => expect(magazin.client.size).toBe(inainte + 1), ASTEPTARE)
  })

  it('nu creează nimic cât timp nu s-a tastat un nume', async () => {
    await autentifica()
    const formular = await deschide()
    fireEvent.click(formular.getByRole('combobox', { name: /^Client/ }))
    await formular.findByLabelText('Caută în listă')
    expect(formular.queryByRole('button', { name: /Client nou/ })).not.toBeInTheDocument()
  })
})

describe('serviciu nou din formularul de programare', () => {
  it('administratorul îl creează cu durata și prețul implicite', async () => {
    await autentifica('admin@clinica.ro')
    const formular = await deschide()
    const inainte = magazin.articol.size

    await cautaIn(formular, /^Serviciu/, 'Terapie Test Rapid')
    fireEvent.click(await formular.findByRole('button', { name: /Serviciu nou: „Terapie Test Rapid”/ }, ASTEPTARE))

    await waitFor(() => expect(magazin.articol.size).toBe(inainte + 1), ASTEPTARE)
    const nou = [...magazin.articol.values()].find((a) => a.denumire === 'Terapie Test Rapid')
    // Respectă `articol_durata_ck`: un serviciu trebuie să aibă durată > 0.
    expect(nou).toMatchObject({ tip: 'serviciu', durata_minute: 60, pret_lista: 0, activ: true })

    await waitFor(() =>
      expect(formular.getByRole('combobox', { name: /^Serviciu/ })).toHaveTextContent(
        'Terapie Test Rapid',
      ),
    ASTEPTARE)
  })

  it('operatorul obișnuit nu vede rândul de creare — POST /articole îi e interzis (§7)', async () => {
    await autentifica('andreea.popescu@clinica.ro')
    const formular = await deschide()

    const cautareServiciu = await cautaIn(formular, /^Serviciu/, 'Serviciu Nou Inexistent')
    await waitFor(() => expect(optiuniDeschise(formular)).toHaveLength(0), ASTEPTARE)
    expect(formular.queryByRole('button', { name: /Serviciu nou/ })).not.toBeInTheDocument()
    fireEvent.keyDown(cautareServiciu, { key: 'Escape' })

    // Dar clientul îl poate face oricine.
    await cautaIn(formular, /^Client/, 'Client Nou De Operator')
    expect(await formular.findByRole('button', { name: /Client nou/ }, ASTEPTARE)).toBeInTheDocument()
  })
})

/*
  Deschis din calendar: pornește din locul apăsat, nu de la „acum”.
*/
describe('programare nouă din locul apăsat în calendar', () => {
  /** Contul demo cu numele dat — id-urile se generează la fiecare populare. */
  const cont = (nume: string) => {
    const u = [...magazin.utilizator.values()].find((x) => x.nume === nume)
    if (!u) throw new Error(`Nu există contul demo „${nume}”.`)
    return u
  }

  const loc = (dinColoana: string | null, sfarsit: Date | null = null): LocAles => ({
    inceput: new Date(2026, 9, 6, 10, 30),
    sfarsit,
    executantId: dinColoana,
    clientId: null,
  })

  it('completează ziua, ora și persoana coloanei', async () => {
    await autentifica('admin@clinica.ro')
    const andreea = cont('Andreea Popescu')
    const formular = await deschideLa(loc(andreea.id))

    expect(formular.getByLabelText(/^Ziua/)).toHaveValue('2026-10-06')
    expect(formular.getByLabelText(/^Ora/)).toHaveValue('10:30')
    expect(durata(formular)).toBe('60')
    await waitFor(() =>
      expect(formular.getByRole('combobox', { name: /^Persoana care execută/ })).toHaveTextContent(
        'Andreea Popescu',
      ),
    ASTEPTARE)
  })

  it('un interval tras rămâne așa și după alegerea serviciului', async () => {
    await autentifica('admin@clinica.ro')
    const formular = await deschideLa(loc(null, new Date(2026, 9, 6, 12, 0)))
    expect(durata(formular)).toBe('90')

    await cautaIn(formular, /^Serviciu/, 'Manichiură clasică')
    fireEvent.click(await formular.findByRole('option', { name: /Manichiură clasică/ }, ASTEPTARE))
    await waitFor(() =>
      expect(formular.getByRole('combobox', { name: /^Serviciu/ })).toHaveTextContent('Manichiură clasică'),
    ASTEPTARE)
    // Serviciul durează 45 de minute, dar intervalul l-a ales recepția.
    expect(durata(formular)).toBe('90')
  })

  it('o simplă apăsare lasă durata serviciului', async () => {
    await autentifica('admin@clinica.ro')
    const formular = await deschideLa(loc(null))

    await cautaIn(formular, /^Serviciu/, 'Manichiură clasică')
    fireEvent.click(await formular.findByRole('option', { name: /Manichiură clasică/ }, ASTEPTARE))
    await waitFor(() => expect(durata(formular)).toBe('45'), ASTEPTARE)
  })

  it('operatorul obișnuit rămâne executant chiar în coloana altcuiva', async () => {
    await autentifica('andreea.popescu@clinica.ro')
    const formular = await deschideLa(loc(cont('Mihaela Stan').id))
    await waitFor(() =>
      expect(formular.getByRole('combobox', { name: /^Persoana care execută/ })).toHaveTextContent(
        'Andreea Popescu',
      ),
    ASTEPTARE)
  })
})

/*
  Mai multe servicii în aceeași programare: o manichiură și o pedichiură la
  aceeași venire, fiecare cu prețul ei, într-un singur bloc din calendar.
*/
describe('mai multe servicii într-o programare', () => {
  /** Zi departe de agenda generată, ca să nu se ciocnească de nimic. */
  const ZI = new Date(2031, 2, 4, 10, 0)

  /** Alege un serviciu în selectorul dat și așteaptă să rămână ales. */
  async function alege(formular: ReturnType<typeof within>, eticheta: RegExp, denumire: string) {
    await cautaIn(formular, eticheta, denumire)
    fireEvent.click(await formular.findByRole('option', { name: new RegExp(denumire) }, ASTEPTARE))
    await waitFor(() =>
      expect(formular.getByRole('combobox', { name: eticheta })).toHaveTextContent(denumire),
    ASTEPTARE)
  }

  it('al doilea serviciu intră în aceeași programare, iar durata lor se adună', async () => {
    await autentifica('admin@clinica.ro')
    // Fișă fără istoric: prețurile pornesc de la listă.
    const clienta = await api.clienti.create({ nume: 'Clientă Cu Două Servicii' })
    const formular = await deschideLa({ inceput: ZI, sfarsit: null, executantId: null, clientId: clienta.id })

    await alege(formular, /^Serviciu/, 'Manichiură clasică')
    await waitFor(() => expect(durata(formular)).toBe('45'), ASTEPTARE)

    fireEvent.click(formular.getByRole('button', { name: 'Adaugă încă un serviciu' }))
    await alege(formular, /^Serviciul 2/, 'Pedichiură clasică')
    // 45 + 60 de minute: ora de sfârșit merge după toate serviciile.
    await waitFor(() => expect(durata(formular)).toBe('105'), ASTEPTARE)
    expect(formular.getByText(/Total/)).toHaveTextContent('190')

    fireEvent.click(screen.getByRole('button', { name: 'Adaugă programarea' }))

    await waitFor(() => {
      const ale = [...magazin.programare.values()].filter((p) => p.client_id === clienta.id)
      expect(ale).toHaveLength(2)
    }, ASTEPTARE)
    const ale = [...magazin.programare.values()].filter((p) => p.client_id === clienta.id)
    expect(new Set(ale.map((p) => p.vizita_id)).size).toBe(1)
    expect(ale.map((p) => p.pret)).toEqual([80, 110])
    expect(new Set(ale.map((p) => p.se_termina_la)).size).toBe(1)
  })

  it('la modificare arată toate serviciile, iar cel scos rămâne în istoric, anulat', async () => {
    const admin = await autentifica('admin@clinica.ro')
    const clienta = await api.clienti.create({ nume: 'Clientă De Modificat' })
    const [manichiura, pedichiura] = ['Manichiură clasică', 'Pedichiură clasică'].map(
      (d) => [...magazin.articol.values()].find((a) => a.denumire === d)!,
    )
    const prima = await api.programari.create({
      client_id: clienta.id,
      executant_id: admin.id,
      incepe_la: ZI.toISOString(),
      se_termina_la: new Date(ZI.getTime() + 105 * 60_000).toISOString(),
      servicii: [{ articol_id: manichiura!.id }, { articol_id: pedichiura!.id }],
    })
    const servicii = await api.programari.list({ vizita_id: prima.vizita_id })

    randeaza(
      <FormularProgramare deschisa onInchide={() => undefined} programare={servicii[0]} servicii={servicii} />,
    )
    const formular = within(await screen.findByRole('dialog', {}, ASTEPTARE))
    await waitFor(() => {
      expect(formular.getByRole('combobox', { name: /^Serviciul 1/ })).toHaveTextContent('Manichiură clasică')
      expect(formular.getByRole('combobox', { name: /^Serviciul 2/ })).toHaveTextContent('Pedichiură clasică')
    }, ASTEPTARE)

    fireEvent.click(formular.getByRole('button', { name: 'Scoate serviciul 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvează' }))

    await waitFor(() => expect(magazin.programare.get(servicii[1]!.id)?.stare).toBe('anulat'), ASTEPTARE)
    expect(magazin.programare.get(servicii[0]!.id)?.stare).toBe('programat')
  })
})
