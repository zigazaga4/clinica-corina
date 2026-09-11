import { CalendarOff } from 'lucide-react'
import type { NotitaDetaliu, ProgramareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaZiLunga, isToday } from '@/lib/dates'
import { plural } from '@/lib/text'
import { StareGoala } from '@/ui'
import { RandNotita } from './CardNotita'
import { RandProgramare } from './CardProgramare'
import { dinZiua, elementeCalendar } from './elemente'

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
  notite = [],
  onAlegeProgramare,
  onAlegeNotita,
  cuExecutant = true,
  ascundeZileleGoale = false,
}: {
  zile: Date[]
  programari: ProgramareDetaliu[]
  notite?: NotitaDetaliu[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  cuExecutant?: boolean
  /** În vederea pe lună, treizeci de zile goale ar îneca cele câteva pline. */
  ascundeZileleGoale?: boolean
}) {
  const grupuri = zile
    .map((zi) => {
      const programariZilei = dinZiua(programari, zi)
      const notiteZilei = dinZiua(notite, zi)
      return {
        zi,
        programari: programariZilei.length,
        notite: notiteZilei.length,
        aleZilei: elementeCalendar(programariZilei, notiteZilei),
      }
    })
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
      {grupuri.map(({ zi, aleZilei, programari: nrProgramari, notite: nrNotite }) => (
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
              {rezumatZilei(nrProgramari, nrNotite)}
            </span>
          </h3>

          {aleZilei.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-ink-faint">Nicio programare.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {aleZilei.map((element) =>
                element.fel === 'programare' ? (
                  <RandProgramare
                    key={element.programare.id}
                    programare={element.programare}
                    onClick={onAlegeProgramare}
                    cuExecutant={cuExecutant}
                  />
                ) : (
                  <RandNotita
                    key={element.notita.id}
                    notita={element.notita}
                    onClick={onAlegeNotita ?? (() => undefined)}
                  />
                ),
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/** „3 programări · 1 notiță”, „liber”, „2 notițe”. */
function rezumatZilei(programari: number, notite: number): string {
  const parti: string[] = []
  if (programari > 0) parti.push(`${programari} ${plural(programari, 'programare', 'programări')}`)
  if (notite > 0) parti.push(`${notite} ${plural(notite, 'notiță', 'notițe')}`)
  return parti.length ? parti.join(' · ') : 'liber'
}
