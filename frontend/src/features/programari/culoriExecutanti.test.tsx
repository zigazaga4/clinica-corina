import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Utilizator, Uuid } from '@/domain/types'
import { FurnizorCulori, useCuloarePersoana } from './culoriExecutanti'

/*
  Împărțirea culorilor pe conturi.

  Două reguli se verifică aici, fiindcă amândouă se strică tăcut: o culoare
  greșită nu aruncă nicio eroare, doar induce în eroare recepția.

  1. Irina are bej deschis — cerut anume de clinică.
  2. Restul conturilor nu-și schimbă culoarea când se adaugă cineva nou. Dacă
     s-ar schimba, banda de lângă programările de săptămâna trecută ar începe
     să arate altă persoană decât cea care le-a făcut.
*/

function utilizator(nume: string, creat_la: string, id: string): Utilizator {
  return {
    id: id as Uuid,
    nume,
    email: `${nume.toLowerCase()}@clinica.ro`,
    rol: 'administrator',
    activ: true,
    ultima_autentificare: null,
    creat_la,
    actualizat_la: creat_la,
  }
}

/** Scoate clasele atribuite unei persoane, ca text citibil într-o așteptare. */
function Proba({ id }: { id: Uuid }) {
  const culoare = useCuloarePersoana(id)
  return <span data-testid={id}>{culoare ? `${culoare.fundal} ${culoare.text}` : 'fara'}</span>
}

function claseleLui(utilizatori: Utilizator[], id: string): string {
  const { unmount } = render(
    <FurnizorCulori utilizatori={utilizatori}>
      <Proba id={id as Uuid} />
    </FurnizorCulori>,
  )
  const text = screen.getByTestId(id).textContent ?? ''
  unmount()
  return text
}

// Aceeași dată la microsecundă: exact cum au fost create conturile clinicii,
// într-o singură instrucțiune SQL.
const ACEEASI_DATA = '2026-09-11T12:59:47.087886Z'
const irina = utilizator('Irina', ACEEASI_DATA, 'u-irina')
const anda = utilizator('Anda', ACEEASI_DATA, 'u-anda')

describe('culorile persoanelor', () => {
  it('dă Irinei bejul cerut, indiferent de ordinea în care vine lista', () => {
    expect(claseleLui([anda, irina], 'u-irina')).toBe(
      'bg-persoana-bej text-persoana-bej-text',
    )
    expect(claseleLui([irina, anda], 'u-irina')).toBe(
      'bg-persoana-bej text-persoana-bej-text',
    )
  })

  it('nu dă bejul altcuiva', () => {
    expect(claseleLui([anda, irina], 'u-anda')).not.toContain('bej')
  })

  it('ține culoarea Andei neschimbată când lista vine în altă ordine', () => {
    // `creat_la` identic: numele departajează, deci rezultatul nu depinde de
    // ordinea în care serverul întâmplător le întoarce.
    expect(claseleLui([anda, irina], 'u-anda')).toBe(claseleLui([irina, anda], 'u-anda'))
  })

  it('ține culorile vechi când se adaugă un cont nou', () => {
    const nou = utilizator('Zoe', '2027-01-01T08:00:00Z', 'u-zoe')
    const inainte = claseleLui([anda, irina], 'u-anda')
    expect(claseleLui([anda, irina, nou], 'u-anda')).toBe(inainte)
    expect(claseleLui([anda, irina, nou], 'u-zoe')).not.toBe(inainte)
  })

  it('răspunde `null` când lista conturilor lipsește — ecranul merge mai departe', () => {
    expect(claseleLui([], 'u-irina')).toBe('fara')
  })
})
