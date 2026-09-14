import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GrilaFormular, PeToataLatimea } from './Pagina'

/*
  Câmpul „pe toată lățimea” și grila care îl conține trebuie să cadă de acord
  asupra numărului de coloane.

  Testul păzește o pățanie adevărată: `PeToataLatimea` cerea `lg:col-span-3`,
  deși grila implicită are două coloane. Cerând mai multe coloane decât există,
  browserul născocește una în plus — iar în fereastra „Serviciu nou” câmpurile
  Durată și Preț listă ajungeau înghesuite pe o fâșie, cu textele peste ele.
  Nimic nu semnala greșeala: amândouă fișierele erau, fiecare în parte, corecte.

  Nu se poate măsura aici o așezare adevărată — jsdom nu calculează layout —
  deci se verifică ce se poate: că lățimea totală se cere într-un fel care NU
  depinde de câte coloane are grila.
*/
describe('PeToataLatimea', () => {
  it('cere toate coloanele, nu un număr fix', () => {
    render(
      <GrilaFormular>
        <PeToataLatimea>
          <span>câmp lat</span>
        </PeToataLatimea>
      </GrilaFormular>,
    )

    const invelis = screen.getByText('câmp lat').parentElement
    expect(invelis).toHaveClass('col-span-full')
  })

  it('nu se leagă de un număr anume de coloane', () => {
    render(
      <GrilaFormular>
        <PeToataLatimea>
          <span>câmp lat</span>
        </PeToataLatimea>
      </GrilaFormular>,
    )

    const clase = screen.getByText('câmp lat').parentElement?.className ?? ''
    // `col-span-2`, `lg:col-span-3` și rudele lor se strică de îndată ce grila
    // își schimbă numărul de coloane. `col-span-full` nu are cum.
    expect(clase).not.toMatch(/col-span-\d/)
  })

  it('grila implicită are două coloane pe ecran mare', () => {
    const { container } = render(
      <GrilaFormular>
        <span>ceva</span>
      </GrilaFormular>,
    )

    // Dacă acest număr se schimbă vreodată, `col-span-full` rămâne corect —
    // exact motivul pentru care este folosit.
    expect(container.firstElementChild).toHaveClass('sm:grid-cols-2')
  })
})
