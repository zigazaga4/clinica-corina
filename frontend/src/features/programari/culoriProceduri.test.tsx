import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '@/api'
import type { Articol, ProgramareDetaliu, Utilizator } from '@/domain/types'
import { autentifica } from '@/test/render'
import { ChipProgramare, RandProgramare } from './CardProgramare'
import { FurnizorCulori } from './culoriExecutanti'
import { FurnizorCuloriProceduri } from './culoriProceduri'

/*
  Culoarea procedurii în calendar (cerința clinicii, 9 nov. 2026): albastru,
  galben, verde — ca să se deosebească dintr-o privire.

  Regula verificată: culoarea PROCEDURII bate culoarea persoanei, iar un
  serviciu fără culoare lasă programarea pe culoarea persoanei, ca înainte.
  O culoare greșită nu aruncă nicio eroare, doar induce recepția în eroare.
*/

const ALBASTRU = '#3b82f6'
const GALBEN = '#eab308'
const ROSU_PERSOANA = '#ff0000'

/** Zi departe de agenda generată, ca să nu se ciocnească de nimic. */
const INCEPUT = new Date(2032, 2, 9, 9, 0)

let numar = 0
const serviciuNou = (culoare: string | null): Promise<Articol> =>
  api.articole.create({
    tip: 'serviciu',
    denumire: `Procedură ${(numar += 1)}`,
    pret_lista: 100,
    durata_minute: 30,
    culoare,
  })

async function programare(servicii: Articol[]): Promise<{
  rand: ProgramareDetaliu[]
  persoana: Utilizator
}> {
  const admin = await autentifica()
  const clienta = await api.clienti.create({ nume: `Clientă culori ${numar}` })
  const prima = await api.programari.create({
    client_id: clienta.id,
    executant_id: admin.id,
    incepe_la: INCEPUT.toISOString(),
    se_termina_la: new Date(INCEPUT.getTime() + 30 * servicii.length * 60_000).toISOString(),
    servicii: servicii.map((s) => ({ articol_id: s.id, pret: 100 })),
  })
  const rand = await api.programari.list({ vizita_id: prima.vizita_id })
  // Persoana cu o culoare aleasă de ea — roșu — ca să se vadă cine câștigă.
  const persoana: Utilizator = { ...admin, culoare: ROSU_PERSOANA }
  return { rand, persoana }
}

function Cadru({
  persoana,
  nomenclator,
  children,
}: {
  persoana: Utilizator
  nomenclator: Articol[]
  children: React.ReactNode
}) {
  return (
    <FurnizorCulori utilizatori={[persoana]}>
      <FurnizorCuloriProceduri articole={nomenclator}>{children}</FurnizorCuloriProceduri>
    </FurnizorCulori>
  )
}

/** Culoarea pe care o poartă chipul, citită din variabila CSS a culorii alese. */
const culoareaChipului = (chip: HTMLElement) => chip.style.getPropertyValue('--persoana')

/** Punctele colorate din interior — fiecare cu culoarea lui ca fundal. */
const puncte = (parinte: HTMLElement) => parinte.querySelectorAll('span[aria-hidden][style*="background-color"]')

describe('culoarea procedurii în calendar', () => {
  // Nomenclatorul îl scrie doar administratorul.
  beforeEach(async () => {
    await autentifica()
  })

  it('chipul ia culoarea serviciului, nu pe a persoanei', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const { rand, persoana } = await programare([albastru])

    render(
      <Cadru persoana={persoana} nomenclator={[albastru]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    const chip = screen.getByRole('button', { name: /Clientă culori/ })
    expect(culoareaChipului(chip)).toBe(ALBASTRU)
  })

  it('un serviciu fără culoare lasă chipul pe culoarea persoanei', async () => {
    const fara = await serviciuNou(null)
    const { rand, persoana } = await programare([fara])

    render(
      <Cadru persoana={persoana} nomenclator={[fara]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    expect(culoareaChipului(screen.getByRole('button', { name: /Clientă culori/ }))).toBe(ROSU_PERSOANA)
  })

  it('fără nomenclator încărcat, chipul rămâne al persoanei (ca înainte)', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const { rand, persoana } = await programare([albastru])

    render(
      <Cadru persoana={persoana} nomenclator={[]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    expect(culoareaChipului(screen.getByRole('button', { name: /Clientă culori/ }))).toBe(ROSU_PERSOANA)
  })

  it('un serviciu scos din nomenclator (inactiv) își păstrează culoarea pe programările vechi', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const { rand, persoana } = await programare([albastru])
    const inactiv = await api.articole.update(albastru.id, { activ: false })

    render(
      <Cadru persoana={persoana} nomenclator={[inactiv]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    expect(culoareaChipului(screen.getByRole('button', { name: /Clientă culori/ }))).toBe(ALBASTRU)
  })

  it('cu două proceduri colorate: chipul ia prima culoare, iar fiecare procedură își poartă punctul', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const galben = await serviciuNou(GALBEN)
    const { rand, persoana } = await programare([albastru, galben])

    render(
      <Cadru persoana={persoana} nomenclator={[albastru, galben]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    const chip = screen.getByRole('button', { name: /Clientă culori/ })
    expect(culoareaChipului(chip)).toBe(ALBASTRU)
    expect(puncte(chip)).toHaveLength(2)
  })

  it('o programare cu un singur serviciu nu are puncte pe chip: chipul întreg e culoarea', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const { rand, persoana } = await programare([albastru])

    render(
      <Cadru persoana={persoana} nomenclator={[albastru]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    expect(puncte(screen.getByRole('button', { name: /Clientă culori/ }))).toHaveLength(0)
  })

  it('în agendă, fiecare procedură colorată are punctul ei; persoana își păstrează punctul', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const fara = await serviciuNou(null)
    const { rand, persoana } = await programare([albastru, fara])

    render(
      <Cadru persoana={persoana} nomenclator={[albastru, fara]}>
        <RandProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    const randul = screen.getByRole('button', { name: /Clientă culori/ })
    // Un punct pentru procedura albastră; cealaltă n-are culoare.
    expect(puncte(randul)).toHaveLength(1)
    // Textul rămâne întreg, cu ambele denumiri: punctele sunt doar decor.
    expect(randul).toHaveTextContent(`${albastru.denumire} + ${fara.denumire}`)
  })

  it('chipul unei proceduri e plin, cu text citibil: alb pe albastru, cerneală pe galben', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const galben = await serviciuNou(GALBEN)
    const pe = async (serviciu: Articol) => {
      const { rand, persoana } = await programare([serviciu])
      const { unmount } = render(
        <Cadru persoana={persoana} nomenclator={[serviciu]}>
          <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
        </Cadru>,
      )
      const chip = screen.getByRole('button', { name: /Clientă culori/ })
      const rezultat = { clase: chip.className, text: chip.style.getPropertyValue('--text-pe-plin') }
      unmount()
      return rezultat
    }

    const peAlbastru = await pe(albastru)
    // Fundal plin (nu `/30`), ca blocurile din softul vechi.
    expect(peAlbastru.clase).toContain('bg-(--persoana)')
    expect(peAlbastru.clase).not.toContain('bg-(--persoana)/')
    expect(peAlbastru.text).toBe('#ffffff')
    expect((await pe(galben)).text).not.toBe('#ffffff')
  })

  it('chipul înalt arată intervalul întreg pe primul rând, ca softul vechi; cel scund, doar ora de început', async () => {
    const albastru = await serviciuNou(ALBASTRU)
    const { rand, persoana } = await programare([albastru])

    const { rerender } = render(
      <Cadru persoana={persoana} nomenclator={[albastru]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} ampla />
      </Cadru>,
    )
    const chip = screen.getByRole('button', { name: /Clientă culori/ })
    // Intervalul și clientul pe rânduri separate: într-o coloană îngustă, numele nu se taie.
    expect(chip).toHaveTextContent(/^09:00–09:30\s*Clientă culori/)
    expect(chip.children[0]).toHaveTextContent(/^09:00–09:30$/)

    rerender(
      <Cadru persoana={persoana} nomenclator={[albastru]}>
        <ChipProgramare programare={rand[0]!} servicii={rand} onClick={() => undefined} />
      </Cadru>,
    )
    expect(screen.getByRole('button', { name: /Clientă culori/ })).toHaveTextContent(/^09:00 Clientă culori/)
  })
})
