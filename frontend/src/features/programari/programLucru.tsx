import type { DateOnly, ProgramLucru, Uuid, ZileLucru } from '@/domain/types'
import { cn } from '@/lib/cn'
import { laInputDate } from '@/lib/dates'
import { useCuloarePersoana } from './culoriExecutanti'

/*
  Programul de lucru (cerința clinicii, 2026-10-01): fiecare persoană lucrează,
  într-o lună, fie în zilele pare, fie în cele impare — după numărul zilei —
  fie în zilele alese una câte una (personalizat).
  Fără program ales pentru luna aceea, nu se marchează nimic: ziua nu e nici
  „lucrează”, nici „liber”, ci necunoscută, ca înainte să existe programul.
*/

/** Ziua 1 a lunii zilei, ca în `program_lucru.luna`. */
export function lunaZilei(zi: Date): DateOnly {
  return `${laInputDate(zi).slice(0, 7)}-01`
}

/** Ce fel de zi e: pară (2, 4, …) sau impară (1, 3, …). */
export function felulZilei(zi: Date): ZileLucru {
  return zi.getDate() % 2 === 0 ? 'pare' : 'impare'
}

/** Ziua cade în program? Pare / impare după numărul zilei, altfel lista aleasă. */
export function lucreazaDupaProgram(
  program: Pick<ProgramLucru, 'zile' | 'zile_alese'>,
  zi: Date,
): boolean {
  if (program.zile === 'personalizat') return (program.zile_alese ?? []).includes(zi.getDate())
  return program.zile === felulZilei(zi)
}

/**
 * Lucrează persoana în ziua aceasta? `null` = nu are program ales pe luna
 * zilei, deci nu se știe — calendarul nu marchează nimic.
 */
export function lucreaza(programe: ProgramLucru[], utilizatorId: Uuid, zi: Date): boolean | null {
  const luna = lunaZilei(zi)
  const program = programe.find((p) => p.utilizator_id === utilizatorId && p.luna === luna)
  return program ? lucreazaDupaProgram(program, zi) : null
}

export interface PersoanaZilei {
  id: Uuid
  nume: string
  lucreaza: boolean
}

/** Persoanele cu program ales pe luna zilei: cine lucrează și cine e liber. */
export function persoaneleZilei(programe: ProgramLucru[], zi: Date): PersoanaZilei[] {
  const luna = lunaZilei(zi)
  return programe
    .filter((p) => p.luna === luna)
    .map((p) => ({ id: p.utilizator_id, nume: p.utilizator_nume, lucreaza: lucreazaDupaProgram(p, zi) }))
}

/**
 * Cine lucrează în ziua aceasta — numele colorate — și cine e liber, tăiat.
 *
 * O singură componentă pentru toate vederile: antetul coloanei din săptămână,
 * celula din lună, antetul zilei din agenda de pe telefon.
 */
export function PersoaneZilei({
  persoane,
  className,
}: {
  persoane: PersoanaZilei[]
  className?: string
}) {
  if (persoane.length === 0) return null
  // Întâi cine lucrează: e întrebarea pusă când se caută un loc.
  const ordonate = [...persoane].sort((a, b) => Number(b.lucreaza) - Number(a.lucreaza))
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5 overflow-hidden', className)}>
      {ordonate.map((p) => (
        <NumePersoana key={p.id} persoana={p} />
      ))}
    </span>
  )
}

function NumePersoana({ persoana }: { persoana: PersoanaZilei }) {
  const culoare = useCuloarePersoana(persoana.id)
  const prenume = persoana.nume.trim().split(/\s+/)[0] ?? persoana.nume

  if (!persoana.lucreaza) {
    return (
      <span
        title={`${persoana.nume} — zi liberă`}
        className="shrink-0 truncate text-ink-faint line-through decoration-1"
      >
        {prenume}
      </span>
    )
  }
  return (
    <span
      title={`${persoana.nume} lucrează`}
      style={culoare?.stil}
      className={cn('inline-flex shrink-0 items-center gap-1 font-medium', culoare ? culoare.text : 'text-ink')}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', culoare ? culoare.fundal : 'bg-success')}
      />
      {prenume}
    </span>
  )
}

/**
 * Fundalul unei zile libere în grila orară: dungi oblice discrete. Se vede de
 * la distanță că persoana nu lucrează, dar programările rămân lizibile peste.
 */
export const STIL_ZI_LIBERA: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent 0 9px, color-mix(in oklab, var(--color-line-strong) 45%, transparent) 9px 11px)',
}
