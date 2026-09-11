import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import type { Client } from '@/domain/types'
import { autentifica, Furnizori } from '@/test/render'
import { ModalaAcordGdpr } from './ModalaAcordGdpr'
import { EroarePad, porneste, type OptiuniSesiune, type SesiunePad } from './pad'

/*
  Proba drumului întreg: clientul vine, semnează, documentul se naște.

  Se preface DOAR tableta — aparatul nu există în atelierul de probe. Tot
  restul este adevărat: textul acordului, tipărirea PDF-ului cu `pdf-lib` și
  fonturi reale, codificarea, verificările serverului și păstrarea în „bază”.
  Așa proba chiar dovedește ceva: dacă PDF-ul ar ieși stricat, dacă numele cu
  diacritice ar arunca la desenare sau dacă serverul ar respinge fișierul,
  se vede aici, nu la recepție cu clientul în față.
*/

vi.mock('./pad', async (importActual) => {
  const real = await importActual<typeof import('./pad')>()
  // `EroarePad` rămâne cea adevărată: ecranul o deosebește cu `instanceof`.
  return { ...real, porneste: vi.fn() }
})

vi.mock('./fonturi', () => ({
  // Fonturile adevărate, aduse ca adrese `data:` — `fetch` nu are ce sluji în
  // probe, dar `pdf-lib` trebuie să primească exact octeții din aplicație.
  incarcaFonturi: async () => {
    const octeti = (adresa: string) => {
      const binar = atob(adresa.slice(adresa.indexOf(',') + 1))
      const rezultat = new Uint8Array(binar.length)
      for (let i = 0; i < binar.length; i++) rezultat[i] = binar.charCodeAt(i)
      return rezultat
    }
    const [normal, gras] = await Promise.all([
      import('./fonturi/FiraSans-Regular.ttf?inline'),
      import('./fonturi/FiraSans-Bold.ttf?inline'),
    ])
    return { normal: octeti(normal.default), gras: octeti(gras.default) }
  },
}))

import semnaturaProba from './semnatura-proba.png?inline'

function pngProba(): Uint8Array {
  const binar = atob(semnaturaProba.slice(semnaturaProba.indexOf(',') + 1))
  const octeti = new Uint8Array(binar.length)
  for (let i = 0; i < binar.length; i++) octeti[i] = binar.charCodeAt(i)
  return octeti
}

/** Tableta prefăcută; întoarce și funcțiile pe care i le-a dat ecranul. */
function pregatesteTableta() {
  const sesiune: SesiunePad = {
    dispozitiv: 'signotec Sigma (S/N 1000444927, firmware 2.5)',
    latimeSenzor: 1000,
    inaltimeSenzor: 500,
    sterge: vi.fn(async () => undefined),
    confirma: vi.fn(async () => undefined),
    inchide: vi.fn(async () => undefined),
  }
  let primite: OptiuniSesiune | undefined
  vi.mocked(porneste).mockImplementation(async (optiuni) => {
    primite = optiuni
    return sesiune
  })
  return { sesiune, tableta: () => primite! }
}

let client: Client

beforeEach(async () => {
  vi.mocked(porneste).mockReset()
  await autentifica()
  const lista = await api.clienti.list({ pe_pagina: 1 })
  client = await api.clienti.get(lista.randuri[0]!.id)
})

function deseneaza(extra: Partial<Parameters<typeof ModalaAcordGdpr>[0]> = {}) {
  const props = {
    deschisa: true,
    onInchide: vi.fn(),
    client,
    programareId: null,
    onSemnat: vi.fn(),
    onSare: vi.fn(),
    ...extra,
  }
  render(
    <Furnizori>
      <ModalaAcordGdpr {...props} />
    </Furnizori>,
  )
  return props
}

describe('ecranul de semnare', () => {
  it('arată acordul întreg, cu numele clientului în el', async () => {
    pregatesteTableta()
    deseneaza()

    expect(
      await screen.findByText('ACORD PRIVIND PRELUCRAREA DATELOR CU CARACTER PERSONAL'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`Subsemnatul ${client.nume} sunt de acord`)),
    ).toBeInTheDocument()
  })

  it('spune ce aparat s-a găsit și cere semnătura pe el', async () => {
    pregatesteTableta()
    deseneaza()

    expect(await screen.findByText(/Rugați clientul să semneze pe tabletă/)).toBeInTheDocument()
    expect(screen.getByText(/signotec Sigma \(S\/N 1000444927/)).toBeInTheDocument()
  })

  it('ține „Confirmă” stins până când creionul chiar a scris', async () => {
    const { tableta } = pregatesteTableta()
    deseneaza()
    await screen.findByText(/Rugați clientul să semneze/)

    const confirma = screen.getByRole('button', { name: /Confirmă semnătura/ })
    expect(confirma).toBeDisabled()

    // Creionul atinge tableta.
    tableta().laPunct?.({ x: 10, y: 20, p: 0 })
    await waitFor(() => expect(confirma).toBeEnabled())
  })
})

describe('semnătura culeasă', () => {
  it('tipărește un PDF adevărat și îl păstrează pe fișa clientului', async () => {
    const { tableta } = pregatesteTableta()
    const props = deseneaza()
    await screen.findByText(/Rugați clientul să semneze/)

    // Tableta anunță semnătura, exact cum o face modulul adevărat.
    tableta().laSemnatura({ png: pngProba(), puncte: 240 })

    // Tipărirea chiar durează: două fonturi se încorporează subsetate, iar
    // `waitFor` aşteaptă implicit doar o secundă.
    await waitFor(() => expect(props.onSemnat).toHaveBeenCalled(), { timeout: 15_000 })

    const acorduri = await api.consimtaminte.list({ client_id: client.id })
    expect(acorduri.total).toBe(1)

    const acord = acorduri.randuri[0]!
    expect(acord.versiune).toBe('gdpr-2026-09')
    expect(acord.dispozitiv).toBe('signotec Sigma (S/N 1000444927, firmware 2.5)')
    // Instantaneul fișei, așa cum arăta pe ecran în clipa semnării.
    expect(acord.date_semnatar.nume).toBe(client.nume)
    expect(acord.amprenta).toMatch(/^[0-9a-f]{64}$/)
    expect(acord.marime).toBeGreaterThan(1000)

    // Fișierul păstrat este chiar un PDF, nu un șir oarecare.
    const fisier = await api.consimtaminte.document(acord.id)
    const octeti = new Uint8Array(await fisier.arrayBuffer())
    expect(String.fromCharCode(...octeti.subarray(0, 5))).toBe('%PDF-')
    expect(octeti.length).toBe(acord.marime)
  })

  it('leagă acordul de ședința la care s-a semnat', async () => {
    const programari = await api.programari.list()
    const programare = programari[0]!
    const { tableta } = pregatesteTableta()
    const props = deseneaza({ client, programareId: programare.id })
    await screen.findByText(/Rugați clientul să semneze/)

    tableta().laSemnatura({ png: pngProba(), puncte: 240 })
    // Tipărirea chiar durează: două fonturi se încorporează subsetate, iar
    // `waitFor` aşteaptă implicit doar o secundă.
    await waitFor(() => expect(props.onSemnat).toHaveBeenCalled(), { timeout: 15_000 })

    const acorduri = await api.consimtaminte.list({ programare_id: programare.id })
    expect(acorduri.total).toBe(1)
    expect(acorduri.randuri[0]?.programare_id).toBe(programare.id)
  })

  it('respinge o zgârietură, fără să păstreze nimic', async () => {
    // O atingere din greșeală nu este o semnătură; păstrată, ar fi arătat ca
    // un acord dat, iar nimeni nu ar fi cerut unul adevărat mai târziu.
    const { tableta } = pregatesteTableta()
    const props = deseneaza()
    await screen.findByText(/Rugați clientul să semneze/)

    tableta().laSemnatura({ png: pngProba(), puncte: 3 })

    expect(await screen.findByText(/Semnătura este prea scurtă/)).toBeInTheDocument()
    expect(props.onSemnat).not.toHaveBeenCalled()
    expect((await api.consimtaminte.list({ client_id: client.id })).total).toBe(0)
  })
})

describe('când tableta nu merge', () => {
  it('spune ce trebuie pornit și lasă recepția să meargă mai departe', async () => {
    vi.mocked(porneste).mockRejectedValue(
      new EroarePad('Serviciul tabletei de semnat nu răspunde. Verificați că programul…'),
    )
    const props = deseneaza()

    expect(await screen.findByText(/Serviciul tabletei de semnat nu răspunde/)).toBeInTheDocument()

    /*
      Portiță, nu poartă: o tabletă stricată nu are voie să oprească clinica
      din lucru. Butonul apare NUMAI în starea de eșec, deci nimeni nu-l poate
      apăsa din comoditate cât timp aparatul funcționează.
    */
    fireEvent.click(screen.getByRole('button', { name: 'Continuă fără acord' }))
    expect(props.onSare).toHaveBeenCalled()
    expect((await api.consimtaminte.list({ client_id: client.id })).total).toBe(0)
  })

  it('nu arată portița cât timp tableta este pregătită', async () => {
    pregatesteTableta()
    deseneaza()
    await screen.findByText(/Rugați clientul să semneze/)

    expect(screen.queryByRole('button', { name: 'Continuă fără acord' })).toBeNull()
  })
})
