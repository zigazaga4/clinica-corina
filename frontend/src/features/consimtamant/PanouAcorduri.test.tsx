import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import type { Client } from '@/domain/types'
import { autentifica, Furnizori } from '@/test/render'
import { PanouAcorduri } from './PanouAcorduri'
import { salveazaAcord, deschideAcord } from './descarca'

/*
  Banda de acorduri din fișa clientului.

  Se preface DOAR scrierea pe disc — în atelierul de probe nu există nici
  Windows, nici dosarul Documente. Restul este adevărat: acordul se pune în
  „bază” prin API-ul din memorie, se citește înapoi prin ruta lui și se verifică
  faptul că butonul chiar cere PDF-ul, nu doar arată un rând.
*/

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))

vi.mock('./descarca', async (importActual) => {
  const real = await importActual<typeof import('./descarca')>()
  return {
    ...real,
    salveazaAcord: vi.fn(async () => ({ nume: 'Acord.pdf', cale: 'C:/Documente/Acord.pdf' })),
    deschideAcord: vi.fn(async () => undefined),
  }
})

/**
 * Un PDF mic, dar cu semnătura de fișier adevărată — serverul o verifică.
 *
 * Fără diacritice dinadins: `btoa` primește octeți, nu litere, și se împiedică
 * de orice caracter peste 255.
 */
function pdfProba(): string {
  return btoa('%PDF-1.7\n% proba\ntrailer\n%%EOF\n')
}

let client: Client

beforeEach(async () => {
  vi.mocked(salveazaAcord).mockClear()
  vi.mocked(deschideAcord).mockClear()
  await autentifica()
  const lista = await api.clienti.list({ pe_pagina: 1 })
  client = await api.clienti.get(lista.randuri[0]!.id)
})

async function semneazaUnAcord() {
  return api.consimtaminte.create({
    client_id: client.id,
    programare_id: null,
    versiune: 'gdpr-2026-09',
    document: pdfProba(),
    date_semnatar: { nume: client.nume, telefon: null, email: null, adresa: null },
    dispozitiv: 'signotec Sigma (S/N 1000444927)',
  })
}

function deseneaza() {
  render(
    <Furnizori>
      <PanouAcorduri clientId={client.id} />
    </Furnizori>,
  )
}

describe('banda de acorduri', () => {
  it('spune limpede când nu s-a semnat nimic', async () => {
    deseneaza()
    expect(await screen.findByText('Niciun acord semnat')).toBeInTheDocument()
  })

  it('arată acordul semnat, cu aparatul și cine a asistat', async () => {
    await semneazaUnAcord()
    deseneaza()

    expect(await screen.findByText(/signotec Sigma/)).toBeInTheDocument()
    expect(screen.getByText(/Text gdpr-2026-09/)).toBeInTheDocument()
  })

  it('descarcă PDF-ul adevărat, nu doar rândul din listă', async () => {
    /*
      Aici se prinde greșeala care contează: o bandă care afișează acorduri dar
      nu poate scoate fișierul nu rezolvă nimic — exact starea de dinainte.
    */
    await semneazaUnAcord()
    const cerut = vi.spyOn(api.consimtaminte, 'document')
    deseneaza()

    fireEvent.click(await screen.findByRole('button', { name: /Descarcă/ }))

    await waitFor(() => expect(salveazaAcord).toHaveBeenCalled())
    expect(cerut).toHaveBeenCalledTimes(1)

    // Ce s-a trimis la scriere este chiar un PDF, cu numele clientului.
    const [pdf, nume] = vi.mocked(salveazaAcord).mock.calls[0]!
    expect(nume).toBe(client.nume)
    const octeti = new Uint8Array(await pdf.arrayBuffer())
    expect(String.fromCharCode(...octeti.subarray(0, 5))).toBe('%PDF-')
    cerut.mockRestore()
  })

  it('„Deschide” salvează întâi și abia apoi deschide', async () => {
    // Un cititor de PDF are nevoie de un fișier pe disc; deschiderea fără
    // salvare nu ar fi avut ce arăta.
    await semneazaUnAcord()
    deseneaza()

    fireEvent.click(await screen.findByRole('button', { name: /Deschide/ }))

    await waitFor(() => expect(deschideAcord).toHaveBeenCalledWith('C:/Documente/Acord.pdf'))
    expect(salveazaAcord).toHaveBeenCalled()
  })

  it('nu pierde acordul din listă dacă scrierea pe disc pică', async () => {
    await semneazaUnAcord()
    vi.mocked(salveazaAcord).mockRejectedValueOnce(new Error('Disc plin.'))
    deseneaza()

    fireEvent.click(await screen.findByRole('button', { name: /Descarcă/ }))

    expect(await screen.findByText(/nu a putut fi descărcat/)).toBeInTheDocument()
    // Rândul rămâne pe ecran, se poate încerca din nou.
    expect(screen.getByRole('button', { name: /Descarcă/ })).toBeEnabled()
  })
})
