import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/*
  Poarta de actualizare.

  Cerința nu este „să apară un mesaj”, ci ca aplicația să DEVINĂ DE NEFOLOSIT
  până la instalare. De aceea fiecare test de mai jos verifică și absența
  conținutului din spate, nu doar prezența ecranului: un strat pus deasupra ar
  trece un test care caută numai butonul, dar ar lăsa dedesubt un program viu,
  cu date care se salvează.

  Modulele native nu există în jsdom, deci sunt înlocuite aici. `check` este
  mincinosul folositor: întoarce ce vrea fiecare test.
*/

const check = vi.fn()
const downloadAndInstall = vi.fn()
const relaunch = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => check() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunch() }))

const { PoartaActualizare } = await import('./EcranActualizare')

/** O versiune nouă, așa cum o descrie modulul de actualizare. */
function pachet(extra: Record<string, unknown> = {}) {
  return {
    version: '0.9.0',
    currentVersion: '0.1.0',
    body: 'Bara de jos stă acum pe loc.',
    downloadAndInstall,
    ...extra,
  }
}

function randeaza() {
  return render(
    <PoartaActualizare>
      <p>Fișa clientului</p>
    </PoartaActualizare>,
  )
}

beforeEach(() => {
  check.mockReset()
  downloadAndInstall.mockReset()
  relaunch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('fără versiune nouă, aplicația merge neatinsă', async () => {
  check.mockResolvedValue(null)
  randeaza()

  expect(await screen.findByText('Fișa clientului')).toBeInTheDocument()
  await waitFor(() => expect(check).toHaveBeenCalled())
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('o verificare eșuată NU blochează programul', async () => {
  // Fără internet, sau cu serverul de versiuni căzut. O clinică nu poate
  // rămâne fără program de gestiune fiindcă n-a mers rețeaua o clipă.
  check.mockRejectedValue(new Error('Rețea indisponibilă'))
  randeaza()

  expect(await screen.findByText('Fișa clientului')).toBeInTheDocument()
  await waitFor(() => expect(check).toHaveBeenCalled())
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('la o versiune nouă, aplicația dispare și rămâne doar cererea de actualizare', async () => {
  check.mockResolvedValue(pachet())
  randeaza()

  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

  // Miezul cerinței: nu mai există nimic dedesubt.
  expect(screen.queryByText('Fișa clientului')).toBeNull()

  expect(screen.getByText('A apărut o versiune nouă')).toBeInTheDocument()
  expect(screen.getByText('0.9.0')).toBeInTheDocument()
  expect(screen.getByText('0.1.0')).toBeInTheDocument()
  expect(screen.getByText('Bara de jos stă acum pe loc.')).toBeInTheDocument()

  // Un singur lucru de apăsat, și nicio cale de ieșire.
  const butoane = screen.getAllByRole('button')
  expect(butoane).toHaveLength(1)
  expect(butoane[0]).toHaveTextContent('Actualizează acum')
})

it('butonul descarcă, arată cât s-a strâns, apoi instalează', async () => {
  check.mockResolvedValue(pachet())

  // Instalarea reală nu se termină niciodată din interfață — pe Windows
  // procesul este închis de instalator. Aici o ținem deschisă ca să putem
  // observa stările prin care trece.
  let raporteaza!: (e: unknown) => void
  downloadAndInstall.mockImplementation((laEveniment: (e: unknown) => void) => {
    raporteaza = laEveniment
    return new Promise(() => undefined)
  })

  randeaza()
  const buton = await screen.findByRole('button', { name: 'Actualizează acum' })

  await act(async () => {
    buton.click()
  })

  await act(async () => {
    raporteaza({ event: 'Started', data: { contentLength: 200 } })
  })
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

  await act(async () => {
    raporteaza({ event: 'Progress', data: { chunkLength: 50 } })
  })
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  expect(screen.getByText('Se descarcă… 25%')).toBeInTheDocument()

  await act(async () => {
    raporteaza({ event: 'Finished' })
  })
  expect(screen.getByText('Se instalează…')).toBeInTheDocument()

  // Și tot timpul acesta, nimic din aplicație nu a revenit.
  expect(screen.queryByText('Fișa clientului')).toBeNull()
})

it('dacă instalarea cade, se poate reîncerca — dar tot nu se intră în aplicație', async () => {
  check.mockResolvedValue(pachet())
  downloadAndInstall.mockRejectedValue(new Error('Conexiune întreruptă'))

  randeaza()
  const buton = await screen.findByRole('button', { name: 'Actualizează acum' })
  await act(async () => {
    buton.click()
  })

  expect(await screen.findByText('Actualizarea nu a reușit')).toBeInTheDocument()
  expect(screen.getByText('Conexiune întreruptă')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Încearcă din nou' })).toBeInTheDocument()
  expect(screen.queryByText('Fișa clientului')).toBeNull()

  // Reîncercarea pornește de la o verificare curată, fiindcă obiectul de
  // dinainte poate fi deja închis de partea nativă.
  check.mockClear()
  downloadAndInstall.mockImplementation(() => new Promise(() => undefined))
  await act(async () => {
    screen.getByRole('button', { name: 'Încearcă din nou' }).click()
  })
  await waitFor(() => expect(check).toHaveBeenCalled())
})
