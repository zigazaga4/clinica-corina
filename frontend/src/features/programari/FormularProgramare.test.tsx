import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { magazin } from '@/api/memory/store'
import { autentifica, randeaza } from '@/test/render'
import { FormularProgramare } from './FormularProgramare'

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
