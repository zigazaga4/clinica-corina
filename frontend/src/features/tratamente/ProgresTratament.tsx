import { UserRound } from 'lucide-react'
import type { ProgramareDetaliu, TratamentDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaBani } from '@/lib/money'
import { plural } from '@/lib/text'
import { Badge } from '@/ui'

/*
  Bucățile prin care un tratament se vede la fel peste tot.

  Aceeași bară de progres stă în lista de tratamente, pe fișa clientului și în
  fereastra de închidere a ședinței; aceeași etichetă „ședința 3 din 8” stă pe
  chipul din calendar, pe rândul din agendă și în detaliul programării. Scrise
  o singură dată, nu pot ajunge să numere diferit în două locuri.
*/

/** „Ședința 3 din 8” — sau null în afara unui tratament. */
export function etichetaSedinta(programare: ProgramareDetaliu): string | null {
  if (programare.tratament_id === null || programare.tratament_numar_sedinte === null) return null
  // O ședință anulată nu ocupă un loc, deci nu are număr; rămâne totuși „din tratament”.
  if (programare.sedinta_nr === null) return `Din tratament de ${programare.tratament_numar_sedinte} ședințe`
  return `Ședința ${programare.sedinta_nr} din ${programare.tratament_numar_sedinte}`
}

/** „3/8” — forma scurtă, pentru chipul din calendar. */
export function marcajSedinta(programare: ProgramareDetaliu): string | null {
  if (programare.sedinta_nr === null || programare.tratament_numar_sedinte === null) return null
  return `${programare.sedinta_nr}/${programare.tratament_numar_sedinte}`
}

/** Starea tratamentului, derivată: nu există coloană `stare`. */
export type StareTratament = 'in_curs' | 'complet' | 'incheiat'

export function stareaTratamentului(t: TratamentDetaliu): StareTratament {
  if (t.incheiat_la === null) return 'in_curs'
  return t.sedinte_onorate >= t.numar_sedinte ? 'complet' : 'incheiat'
}

const etichetaStare: Record<StareTratament, string> = {
  in_curs: 'În curs',
  complet: 'Complet',
  incheiat: 'Încheiat',
}

export function InsemnTratament({ tratament }: { tratament: TratamentDetaliu }) {
  const stare = stareaTratamentului(tratament)
  return (
    <Badge
      ton={stare === 'in_curs' ? 'info' : stare === 'complet' ? 'success' : 'neutral'}
      cuPunct={stare === 'in_curs'}
    >
      {etichetaStare[stare]}
    </Badge>
  )
}

/**
 * Bara de ședințe: câte s-au făcut (plin), câte sunt programate (hașurat
 * deschis), câte mai sunt de programat (gol). Se citește dintr-o privire în
 * lista de tratamente, unde textul „3 din 8” singur s-ar pierde între cifre.
 */
export function ProgresSedinte({
  tratament,
  className,
}: {
  tratament: TratamentDetaliu
  className?: string
}) {
  const { numar_sedinte, sedinte_onorate, sedinte_programate, sedinte_ramase } = tratament
  const segmente = Array.from({ length: numar_sedinte }, (_, i) =>
    i < sedinte_onorate ? 'onorata' : i < sedinte_onorate + sedinte_programate ? 'programata' : 'libera',
  )

  return (
    <div className={cn('min-w-0', className)}>
      <div
        className="flex gap-0.5"
        role="img"
        aria-label={`${sedinte_onorate} din ${numar_sedinte} ședințe făcute, ${sedinte_programate} programate`}
      >
        {segmente.map((fel, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 min-w-1 flex-1 rounded-full',
              fel === 'onorata' && 'bg-success',
              fel === 'programata' && 'bg-info/50',
              fel === 'libera' && 'bg-line',
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-[12px] text-ink-soft tabular-nums">
        <span className="font-medium text-ink">
          {sedinte_onorate}/{numar_sedinte}
        </span>{' '}
        {plural(sedinte_onorate, 'făcută', 'făcute')}
        {sedinte_programate > 0 && ` · ${sedinte_programate} ${plural(sedinte_programate, 'programată', 'programate')}`}
        {sedinte_ramase > 0 && ` · ${sedinte_ramase} de programat`}
      </p>
    </div>
  )
}

/**
 * Banii tratamentului, pe scurt: încasat din total, cu restanța dacă există.
 * `de_incasat` e ce trebuie să sară în ochi — clienta a plecat fără să achite.
 */
/**
 * Cine face tratamentul — persoanele de pe ședințele lui (cerința clinicii).
 * Fără nicio ședință încă, nu se știe: nu afișează nimic.
 */
export function ExecutantiTratament({
  tratament,
  className,
}: {
  tratament: TratamentDetaliu
  className?: string
}) {
  if (!tratament.executanti) return null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1 text-[12px] text-ink-soft', className)}>
      <UserRound className="size-3.5 shrink-0 text-primary-600" aria-hidden />
      <span className="truncate font-medium">{tratament.executanti}</span>
    </span>
  )
}

export function BaniTratament({ tratament, className }: { tratament: TratamentDetaliu; className?: string }) {
  return (
    <div className={cn('text-[13px] tabular-nums', className)}>
      <span className="font-medium text-ink">{formateazaBani(tratament.incasat)}</span>
      <span className="text-ink-faint"> din {formateazaBani(tratament.pret_total)}</span>
      {tratament.de_incasat > 0 && (
        <span className="block text-[12px] font-medium text-warning">
          De plată: {formateazaBani(tratament.de_incasat)}
        </span>
      )}
    </div>
  )
}
