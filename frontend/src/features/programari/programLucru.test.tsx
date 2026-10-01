import { describe, expect, it } from 'vitest'
import { api } from '@/api'
import { autentifica } from '@/test/render'
import { lucreaza, persoaneleZilei } from './programLucru'

/*
  Programul de lucru (cerința clinicii, 2026-10-01): pe o lună, o persoană
  lucrează în zilele pare sau impare — după numărul zilei din lună.
*/

describe('programul de lucru', () => {
  it('pune, înlocuiește și scoate programul unei luni; calendarul citește zilele corect', async () => {
    await autentifica()
    const [persoana] = await api.utilizatori.list({ activ: true })
    if (!persoana) throw new Error('Datele demo nu au niciun cont activ.')

    // Impare în octombrie 2026: 1, 3, 5… lucrează; 2, 4… liber.
    const pus = await api.programLucru.seteaza({ utilizator_id: persoana.id, luna: '2026-10', zile: 'impare' })
    expect(pus?.luna).toBe('2026-10-01')

    let programe = await api.programLucru.list({ de_la: '2026-09-28', pana_la: '2026-10-04' })
    expect(lucreaza(programe, persoana.id, new Date(2026, 9, 1))).toBe(true)
    expect(lucreaza(programe, persoana.id, new Date(2026, 9, 2))).toBe(false)
    expect(lucreaza(programe, persoana.id, new Date(2026, 9, 31))).toBe(true)
    // Septembrie nu are program: nimic de marcat, nici lucru, nici liber.
    expect(lucreaza(programe, persoana.id, new Date(2026, 8, 30))).toBeNull()
    expect(persoaneleZilei(programe, new Date(2026, 9, 2))).toEqual([
      { id: persoana.id, nume: persoana.nume, lucreaza: false },
    ])

    // A doua alegere înlocuiește prima — un singur program pe persoană și lună.
    await api.programLucru.seteaza({ utilizator_id: persoana.id, luna: '2026-10-01', zile: 'pare' })
    programe = await api.programLucru.list({ de_la: '2026-10-01', pana_la: '2026-10-31' })
    expect(programe.filter((p) => p.utilizator_id === persoana.id)).toHaveLength(1)
    expect(lucreaza(programe, persoana.id, new Date(2026, 9, 2))).toBe(true)

    // „Fără program” îl scoate de tot.
    expect(await api.programLucru.seteaza({ utilizator_id: persoana.id, luna: '2026-10', zile: null })).toBeNull()
    programe = await api.programLucru.list({ de_la: '2026-10-01', pana_la: '2026-10-31' })
    expect(lucreaza(programe, persoana.id, new Date(2026, 9, 2))).toBeNull()
  })
})
