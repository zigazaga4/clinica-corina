import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api } from '@/api'
import { magazin } from '@/api/memory/store'
import { formateazaBani } from '@/lib/money'
import { autentifica, randeaza } from '@/test/render'
import { PaginaStatisticileMele } from './PaginaStatisticileMele'

/*
  „Statisticile mele” (3 nov. 2026): „o statistică și pentru Anda, în care să-i
  apară doar încasările ei și ce face ea în fiecare lună, doar pe contul ei”.
  Se deschide fără parola statisticilor și arată numai cifrele contului
  autentificat; ce e al clinicii rămâne în spatele parolei, la „Statistici”.
*/

vi.setConfig({ testTimeout: 30_000 })
const ASTEPTARE = { timeout: 10_000 }

const OPERATOR = 'andreea.popescu@clinica.ro'

/** Cardul de cifre cu eticheta dată, și valoarea din el. */
async function valoarea(eticheta: string): Promise<string> {
  const card = (await screen.findByText(eticheta, {}, ASTEPTARE)).closest('div') as HTMLElement
  return card.parentElement?.textContent ?? ''
}

describe('statisticile mele', () => {
  it('se deschid fără parola statisticilor, cu cifrele contului și graficele lor', async () => {
    await autentifica(OPERATOR)
    randeaza(<PaginaStatisticileMele />)

    expect(await screen.findByRole('heading', { name: 'Statisticile mele' }, ASTEPTARE)).toBeInTheDocument()
    // Nicio ușă: parola statisticilor nu se cere.
    expect(screen.queryByLabelText('Parola statisticilor')).toBeNull()

    for (const eticheta of [
      'Încasat din ședințele mele',
      'Programări onorate',
      'Rămas de încasat',
      'Clienți serviți',
    ]) {
      expect(await screen.findAllByText(eticheta, {}, ASTEPTARE)).not.toHaveLength(0)
    }
    // Ce ține de clinică nu apare: nici cheltuieli, nici profit, nici produse.
    expect(screen.queryByText('Cheltuieli')).toBeNull()
    expect(screen.queryByText('Profit')).toBeNull()
    expect(screen.queryByText('Produse')).toBeNull()
  })

  it('graficul „pe zile” are tabelul lui: încasat și programări, pe fiecare zi a lunii', async () => {
    await autentifica(OPERATOR)
    randeaza(<PaginaStatisticileMele />)

    const titlu = await screen.findByText('Încasat pe ședințele mele', {}, ASTEPTARE)
    const card = titlu.closest('.rounded-xl') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Tabel' }))
    const tabel = within(card).getByRole('table')
    expect(within(tabel).getByRole('columnheader', { name: 'Programări onorate' })).toBeInTheDocument()
    // Câte un rând pe fiecare zi a lunii, până azi.
    expect(within(tabel).getAllByRole('row').length).toBe(new Date().getDate() + 1)
  })

  it('arată numai ce a făcut contul: o ședință a altcuiva nu intră în cifrele lui', async () => {
    const operator = await autentifica(OPERATOR)
    const filtru = () => {
      const azi = new Date()
      const zi = (d: Date) => d.toLocaleDateString('sv-SE')
      return {
        de_la: zi(new Date(azi.getFullYear(), azi.getMonth(), 1)),
        pana_la: zi(azi),
        pas: 'zi' as const,
      }
    }
    const inainte = await api.statistici.mele(filtru())
    expect(inainte.utilizator_id).toBe(operator.id)

    // O programare de azi, onorată, a ALTEI persoane — oricare alt cont activ.
    const alta = [...magazin.utilizator.values()].find((u) => u.activ && u.id !== operator.id)!
    const client = [...magazin.client.values()][0]!
    const serviciu = [...magazin.articol.values()].find((a) => a.tip === 'serviciu' && a.activ && a.numar_sedinte === 1)!
    const inceput = new Date()
    inceput.setHours(7, 0, 0, 0)
    const p = await api.programari.create({
      client_id: client.id,
      executant_id: alta.id,
      incepe_la: inceput.toISOString(),
      se_termina_la: new Date(inceput.getTime() + 30 * 60_000).toISOString(),
      servicii: [{ articol_id: serviciu.id, pret: 123 }],
    })
    await api.programari.schimbaStarea(p.id, 'onorat', { achitat: true, metoda_plata: 'card' })

    const dupa = await api.statistici.mele(filtru())
    expect(dupa.total).toEqual(inainte.total)

    randeaza(<PaginaStatisticileMele />)
    const text = await valoarea('Încasat din ședințele mele')
    expect(text).toContain(formateazaBani(dupa.total.incasat))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), ASTEPTARE)
  })
})
