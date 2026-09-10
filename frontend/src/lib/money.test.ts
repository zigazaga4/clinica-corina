import { describe, expect, it } from 'vitest'
import { formateazaBani, parseNumar, rotunjeste, sumaTotal, totalLinie } from './money'

describe('rotunjeste', () => {
  it('rotunjește la două zecimale', () => {
    expect(rotunjeste(1.234)).toBe(1.23)
    expect(rotunjeste(1.235)).toBe(1.24)
    expect(rotunjeste(1.2)).toBe(1.2)
  })

  it('corectează reprezentarea binară a valorilor de tip x.xx5', () => {
    // 1.005 se stochează ca 1.00499999999999989, deci Math.round(x*100)/100
    // ar da 1.00. Prețurile de listă din nomenclator au exact această formă.
    expect(rotunjeste(1.005)).toBe(1.01)
    expect(rotunjeste(8.475)).toBe(8.48)
  })

  it('rotunjește simetric față de zero, ca PostgreSQL', () => {
    // Math.round(-2.5) dă -2 („half up”); PostgreSQL dă -3 („half away from
    // zero”). Diferența apare la stornarea unei linii de vânzare.
    expect(rotunjeste(-2.5)).toBe(-2.5)
    expect(rotunjeste(-1.235)).toBe(-1.24)
    expect(rotunjeste(1.235)).toBe(1.24)
  })

  it('întoarce zero pentru valori nefinite', () => {
    expect(rotunjeste(Number.NaN)).toBe(0)
    expect(rotunjeste(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('totalLinie', () => {
  it('reproduce round(cantitate * pret_unitar, 2)', () => {
    expect(totalLinie(3, 19.99)).toBe(59.97)
    expect(totalLinie(1, 220)).toBe(220)
  })

  it('acceptă cantități cu trei zecimale, ca numeric(10,3)', () => {
    expect(totalLinie(0.333, 100)).toBe(33.3)
    expect(totalLinie(2.5, 79.9)).toBe(199.75)
  })
})

describe('sumaTotal', () => {
  it('nu acumulează eroarea de virgulă mobilă', () => {
    // 0.1 + 0.2 === 0.30000000000000004 în aritmetica binară.
    expect(sumaTotal([0.1, 0.2])).toBe(0.3)
    expect(sumaTotal([19.99, 19.99, 19.99])).toBe(59.97)
  })

  it('întoarce zero pentru o listă goală', () => {
    expect(sumaTotal([])).toBe(0)
  })
})

describe('parseNumar', () => {
  it('acceptă virgula ca separator zecimal', () => {
    // Tastatura numerică românească produce virgulă, nu punct.
    expect(parseNumar('12,50')).toBe(12.5)
    expect(parseNumar('12.50')).toBe(12.5)
  })

  it('distinge câmpul gol de zero', () => {
    expect(parseNumar('')).toBeNull()
    expect(parseNumar('   ')).toBeNull()
    expect(parseNumar('0')).toBe(0)
  })

  it('respinge textul care nu este număr', () => {
    expect(parseNumar('abc')).toBeNull()
    expect(parseNumar('12abc')).toBeNull()
  })
})

describe('formateazaBani', () => {
  it('formatează în lei, cu două zecimale', () => {
    const rezultat = formateazaBani(1234.5)
    expect(rezultat).toContain('1.234,50')
    expect(rezultat).toContain('RON')
  })
})
