import { describe, expect, it } from 'vitest'
import {
  formateazaProcent,
  parteaSedintei,
  pretListaPentru,
  procentReducere,
  reducereaTratamentului,
  totalCuReducere,
} from './reducere'

describe('reducerea la abonamente', () => {
  it('50% din AB EPI AXILE (900 RON / 8): 450 de plată, 56,25 pe ședință', () => {
    expect(totalCuReducere(900, 50)).toBe(450)
    expect(parteaSedintei(450, 8)).toBe(56.25)
  })

  it('totalul scris de mână dă procentul', () => {
    expect(procentReducere(900, 450)).toBe(50)
    expect(procentReducere(900, 400)).toBe(55.56)
    expect(procentReducere(900, 900)).toBe(0)
    expect(procentReducere(0, 100)).toBeNull()
  })

  it('nu coboară sub zero', () => {
    expect(totalCuReducere(900, 120)).toBe(0)
  })

  it('prețul de listă la alt număr de ședințe este partea lui', () => {
    expect(pretListaPentru({ pret_lista: 900, numar_sedinte: 8 }, 8)).toBe(900)
    expect(pretListaPentru({ pret_lista: 900, numar_sedinte: 8 }, 10)).toBe(1125)
  })

  it('reducerea unui tratament apare doar sub listă și doar cu listă cunoscută', () => {
    expect(reducereaTratamentului({ pret_lista: 900, pret_total: 450 })).toEqual({ procent: 50, lista: 900 })
    expect(reducereaTratamentului({ pret_lista: 900, pret_total: 900 })).toBeNull()
    expect(reducereaTratamentului({ pret_lista: null, pret_total: 450 })).toBeNull()
  })

  it('procentul se scrie românește', () => {
    expect(formateazaProcent(50)).toBe('50%')
    expect(formateazaProcent(55.56)).toBe('55,56%')
  })
})
