import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Articol, ProgramareDetaliu, Uuid } from '@/domain/types'
import { cn } from '@/lib/cn'
import { PunctCuloare } from '@/ui'
import { culoarePlina, useCuloarePersoana, type CuloarePersoana } from './culoriExecutanti'

/**
 * Ce procedură este, citit din culoare (cerința clinicii, 9 nov. 2026).
 *
 * Fiecare serviciu din nomenclator poate primi o culoare — albastru, galben,
 * verde sau oricare alta. Programarea din calendar o poartă pe tot chipul, ca
 * „ce se face la 14:30” să se citească de la un metru, la fel cum „la cine” se
 * citea din culoarea persoanei.
 *
 * Regula dintre cele două: culoarea PROCEDURII bate culoarea persoanei, iar
 * un serviciu fără culoare lasă chipul pe culoarea persoanei, ca înainte.
 * Numele persoanei rămâne scris pe chip, deci nu se pierde nimic.
 */

const Context = createContext<Map<Uuid, CuloarePersoana>>(new Map())

/**
 * Împarte culorile serviciilor o singură dată, sus, ca fiecare chip din calendar
 * și fiecare rând din agendă să citească aceeași hartă.
 *
 * Primește TOATE serviciile, nu doar cele active: o procedură scoasă din
 * nomenclator rămâne pe programările vechi, iar ele își păstrează culoarea.
 */
export function FurnizorCuloriProceduri({
  articole,
  children,
}: {
  articole: Articol[] | undefined
  children: ReactNode
}) {
  const harta = useMemo(() => {
    const m = new Map<Uuid, CuloarePersoana>()
    for (const articol of articole ?? []) {
      if (articol.tip === 'serviciu' && articol.culoare) m.set(articol.id, culoarePlina(articol.culoare))
    }
    return m
  }, [articole])

  return <Context.Provider value={harta}>{children}</Context.Provider>
}

/** Culoarea unui serviciu, sau `null` dacă nu are una. */
export function useCuloareProcedurii(articolId: Uuid | null | undefined): CuloarePersoana | null {
  const harta = useContext(Context)
  if (!articolId) return null
  return harta.get(articolId) ?? null
}

/**
 * Punctul colorat al unei proceduri — nimic dacă n-are culoare.
 *
 * Stă lângă numele serviciului acolo unde culoarea nu acoperă tot rândul:
 * în agendă, și pe chipul unei programări cu mai multe proceduri (chipul are
 * o singură culoare, punctele le arată pe toate).
 */
export function PunctProcedura({
  articolId,
  className,
}: {
  articolId: Uuid
  className?: string
}) {
  const culoare = useCuloareProcedurii(articolId)
  if (!culoare) return null
  return <PunctCuloare hex={culoare.hex} className={cn('size-2', className)} />
}

/**
 * Culorile procedurilor unei programări, în ordinea serviciilor și fără
 * repetiții: două ședințe din aceeași procedură nu cer două puncte la fel.
 */
export function useCulorileProgramarii(servicii: ProgramareDetaliu[]): CuloarePersoana[] {
  const harta = useContext(Context)
  return useMemo(() => {
    const vazute = new Set<string>()
    const culori: CuloarePersoana[] = []
    for (const serviciu of servicii) {
      const culoare = harta.get(serviciu.articol_id)
      if (culoare && !vazute.has(culoare.hex)) {
        vazute.add(culoare.hex)
        culori.push(culoare)
      }
    }
    return culori
  }, [harta, servicii])
}

/**
 * Culoarea chipului unei programări: a primei proceduri colorate, altfel a
 * persoanei. `null` când nu se știe niciuna — chipul rămâne atunci în culoarea
 * stării.
 */
export function useCuloareProgramarii(
  programare: ProgramareDetaliu,
  servicii: ProgramareDetaliu[],
): CuloarePersoana | null {
  const culoriProceduri = useCulorileProgramarii(servicii)
  const culoarePersoana = useCuloarePersoana(programare.executant_id)
  return culoriProceduri[0] ?? culoarePersoana
}
