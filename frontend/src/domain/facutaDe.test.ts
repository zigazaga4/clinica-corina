import { expect, it } from 'vitest'
import { facutaDe, persoanaLiniei } from './facutaDe'
import type { VanzareDetaliu, VanzareLinieDetaliu } from './types'

/*
  „Adriana e onorată în soft și făcută de Anda; vreau să-mi apară Anda ca să-i
  calculez salariul.” Plata a introdus-o Irina — lista nu are voie să spună Irina.
*/

const linie = (executant: { id: string; nume: string } | null): VanzareLinieDetaliu =>
  ({
    programare_id: executant ? 'p' : null,
    executant_id: executant?.id ?? null,
    executant_nume: executant?.nume ?? null,
  }) as VanzareLinieDetaliu

const vanzare = (linii: VanzareLinieDetaliu[]): VanzareDetaliu =>
  ({ operator_id: 'irina', operator_nume: 'Irina', linii }) as VanzareDetaliu

const anda = { id: 'anda', nume: 'Anda' }

it('ședința este a celui care a făcut-o, nu a celui care a introdus plata', () => {
  const v = vanzare([linie(anda)])
  expect(persoanaLiniei(v, v.linii[0]!)).toEqual(anda)
  expect(facutaDe(v)).toEqual(['Anda'])
})

it('produsul este al celui care l-a vândut', () => {
  const v = vanzare([linie(null)])
  expect(persoanaLiniei(v, v.linii[0]!)).toEqual({ id: 'irina', nume: 'Irina' })
})

it('o plată cu ședința Andei și o cremă vândută de Irina le arată pe amândouă, o dată', () => {
  expect(facutaDe(vanzare([linie(anda), linie(anda), linie(null)]))).toEqual(['Anda', 'Irina'])
})
