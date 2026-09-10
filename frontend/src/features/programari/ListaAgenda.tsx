import { CalendarOff } from 'lucide-react'
import type { ProgramareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { esteInZiua, formateazaZiLunga, isToday } from '@/lib/dates'
import { StareGoala } from '@/ui'
import { RandProgramare } from './CardProgramare'

/**
 * Agenda, ca listă cronologică.
 *
 * Este forma folosită pe telefon pentru toate vederile, și pe desktop pentru
 * agenda unei singure persoane. Motivul nu este simplitatea, ci lățimea: o
 * grilă orară cu șapte coloane pe un ecran de 360px dă coloane de 44px, în
 * care nu încape nici ora, necum numele clientului.
 *
 * Zilele goale sunt afișate explicit, nu sărite: un gol în agendă este o
 * informație — acolo se poate programa cineva.
 */
export function ListaAgenda({
  zile,
  programari,
  onAlegeProgramare,
  cuExecutant = true,
  ascundeZileleGoale = false,
}: {
  zile: Date[]
  programari: ProgramareDetaliu[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  cuExecutant?: boolean
  /** În vederea pe lună, treizeci de zile goale ar îneca cele câteva pline. */
  ascundeZileleGoale?: boolean
}) {
  const grupuri = zile
    .map((zi) => ({
      zi,
      aleZilei: programari
        .filter((p) => esteInZiua(p.incepe_la, zi))
        .sort((a, b) => a.incepe_la.localeCompare(b.incepe_la)),
    }))
    .filter((grup) => !ascundeZileleGoale || grup.aleZilei.length > 0)

  if (grupuri.every((grup) => grup.aleZilei.length === 0)) {
    return (
      <StareGoala
        pictograma={<CalendarOff className="size-5" />}
        titlu="Nicio programare în acest interval"
        descriere="Schimbă intervalul sau filtrele, ori adaugă o programare nouă."
      />
    )
  }

  return (
    <div className="divide-y divide-line">
      {grupuri.map(({ zi, aleZilei }) => (
        <section key={zi.toISOString()}>
          <h3
            className={cn(
              'sticky top-0 z-10 flex items-baseline justify-between gap-3 px-4 py-2',
              'border-b border-line text-[13px] font-semibold backdrop-blur-sm',
              isToday(zi) ? 'bg-primary-50/90 text-primary-700' : 'bg-surface/90 text-ink',
            )}
          >
            <span className="capitalize">{formateazaZiLunga(zi)}</span>
            <span className="text-[12px] font-normal text-ink-faint">
              {aleZilei.length === 0
                ? 'liber'
                : `${aleZilei.length} ${aleZilei.length === 1 ? 'programare' : 'programări'}`}
            </span>
          </h3>

          {aleZilei.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-faint">Nicio programare.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {aleZilei.map((programare) => (
                <RandProgramare
                  key={programare.id}
                  programare={programare}
                  onClick={onAlegeProgramare}
                  cuExecutant={cuExecutant}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
