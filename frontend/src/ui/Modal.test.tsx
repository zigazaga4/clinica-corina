import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Modala } from './Modal'

/*
  Unde se așază fereastra modală.

  Testul pare mărunt — se uită la niște nume de clase — dar păzește o greșeală
  care nu se vede nici în JSX, nici în jsdom: varianta `open:` a lui Tailwind se
  compilează cu un `:is([open], …)` pe lângă clasă, deci cântărește mai mult
  decât `sm:`. Scrisă ca `open:justify-end`, regula de telefon învingea regula
  de calculator la ORICE lățime, fiindcă media query-urile nu adaugă
  specificitate și nici ordinea din fișier nu mai conta. Fereastra stătea lipită
  de marginea de jos și pe un monitor de 27".

  jsdom nu calculează specificitate și nici nu încarcă CSS-ul compilat, deci
  singurul loc în care greșeala se poate prinde automat este chiar lista de
  clase. De aceea se verifică textul lor.
*/

function deschide() {
  render(
    <Modala deschisa onInchide={() => {}} titlu="Probă">
      <p>conținut</p>
    </Modala>,
  )
  // `showModal` nu există în jsdom; dialogul e totuși în document.
  return document.querySelector('dialog')!
}

describe('așezarea ferestrei modale', () => {
  it('nu folosește varianta `open:` pentru așezare', () => {
    const clase = deschide().className
    // `open:` e legitim doar pentru `display`, care chiar depinde de stare.
    const asezareCuOpen = clase.match(/open:(justify|items|place)-[a-z]+/g)
    expect(asezareCuOpen, `clase găsite: ${clase}`).toBeNull()
  })

  it('cere jos pe telefon și centrat de la `sm` în sus', () => {
    const clase = deschide().className
    expect(clase).toContain('justify-end')
    expect(clase).toContain('sm:justify-center')
  })

  it('păstrează `open:` pentru afișare — altfel dialogul închis s-ar vedea', () => {
    expect(deschide().className).toContain('open:flex')
  })

  it('afișează titlul primit', () => {
    deschide()
    expect(screen.getByText('Probă')).toBeInTheDocument()
  })
})
