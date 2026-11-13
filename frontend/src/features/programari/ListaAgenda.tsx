import { CalendarOff, ChevronRight, Plus } from 'lucide-react'
import type { NotitaDetaliu, ProgramLucru, ProgramareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaZiLunga, isToday } from '@/lib/dates'
import { plural } from '@/lib/text'
import { StareGoala } from '@/ui'
import { RandNotita } from './CardNotita'
import { RandProgramare } from './CardProgramare'
import { dinZiua, elementeCalendar } from './elemente'
import { PersoaneZilei, persoaneleZilei } from './programLucru'
import { numarProgramari } from './vizite'

/**
 * Agenda, ca listă cronologică.
 *
 * Este forma folosită pe telefon pentru săptămână și lună, și pe desktop pentru
 * agenda unei singure persoane. Motivul nu este simplitatea, ci lățimea: o
 * grilă orară cu șapte coloane pe un ecran de 360px dă coloane de 44px, în
 * care nu încape nici ora, necum numele clientului.
 *
 * Zilele goale sunt afișate explicit, nu sărite: un gol în agendă este o
 * informație — acolo se poate programa cineva. Cu `onProgrameaza`, chiar se
 * poate: ziua goală se apasă, iar fiecare zi are „+” în antet.
 */
export function ListaAgenda({
  zile,
  programari,
  notite = [],
  programe = [],
  onAlegeProgramare,
  onAlegeNotita,
  onProgrameaza,
  onDeschideZiua,
  cuExecutant = true,
  ascundeZileleGoale = false,
}: {
  zile: Date[]
  programari: ProgramareDetaliu[]
  notite?: NotitaDetaliu[]
  /** Programul de lucru: sub data zilei, cine lucrează și cine e liber. */
  programe?: ProgramLucru[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  /** Prezentă = fiecare zi deschide o programare nouă în ea. */
  onProgrameaza?: (zi: Date) => void
  /** Prezentă = antetul fiecărei zi se apasă și deschide ziua aceea, singură, pe ore. */
  onDeschideZiua?: (zi: Date) => void
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
        // Programări, nu servicii: trei servicii la aceeași venire sunt o programare.
        programari: numarProgramari(programariZilei),
        notite: notiteZilei.length,
        aleZilei: elementeCalendar(programariZilei, notiteZilei),
      }
    })
    .filter((grup) => !ascundeZileleGoale || grup.aleZilei.length > 0)

  // Cu `onProgrameaza`, o săptămână goală rămâne listată: fiecare zi liberă
  // este chiar locul pe care se apasă ca să programezi.
  if (
    grupuri.every((grup) => grup.aleZilei.length === 0) &&
    (!onProgrameaza || grupuri.length === 0)
  ) {
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
          <AntetZi
            zi={zi}
            rezumat={rezumatZilei(nrProgramari, nrNotite)}
            programe={programe}
            {...(onProgrameaza ? { onProgrameaza } : {})}
            {...(onDeschideZiua ? { onDeschideZiua } : {})}
          />

          {aleZilei.length === 0 ? (
            onProgrameaza ? (
              <button
                type="button"
                onClick={() => onProgrameaza(zi)}
                className="w-full px-4 py-3 text-left text-[13px] text-ink-faint transition-colors hover:bg-muted hover:text-primary-600"
              >
                Liber — apasă pentru o programare.
              </button>
            ) : (
              <p className="px-4 py-3 text-[13px] text-ink-faint">Nicio programare.</p>
            )
          ) : (
            <div className="divide-y divide-line/60">
              {aleZilei.map((element) =>
                element.fel === 'programare' ? (
                  <RandProgramare
                    key={element.programare.id}
                    programare={element.programare}
                    servicii={element.servicii}
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

/**
 * Antetul lipicios al unei zile din agendă: data, cine lucrează, câte sunt și
 * „+” pentru o programare nouă.
 *
 * Cu `onDeschideZiua` (cerința Corinei, 13 nov. 2026), data și rezumatul sunt
 * un singur buton: apăsat, deschide ziua aceea, singură, pe ore — fără restul
 * săptămânii sau al lunii. Chevronul arată că se apasă; „+” rămâne alături.
 */
function AntetZi({
  zi,
  rezumat,
  programe,
  onProgrameaza,
  onDeschideZiua,
}: {
  zi: Date
  rezumat: string
  programe: ProgramLucru[]
  onProgrameaza?: (zi: Date) => void
  onDeschideZiua?: (zi: Date) => void
}) {
  const titlu = (
    <span className="flex min-w-0 flex-col text-left">
      <span className="capitalize">{formateazaZiLunga(zi)}</span>
      <PersoaneZilei persoane={persoaneleZilei(programe, zi)} className="text-[12px]" />
    </span>
  )
  const plus = onProgrameaza && (
    <button
      type="button"
      onClick={() => onProgrameaza(zi)}
      aria-label={`Programare nouă pe ${formateazaZiLunga(zi)}`}
      className={cn(
        'tinta-atingere -my-1 flex size-7 items-center justify-center rounded-full text-primary-600 hover:bg-primary-100',
        // Lângă butonul zilei, ținta de 44px iese puțin în margine: data
        // încape pe un rând, pe 360px.
        onDeschideZiua && '-mr-2',
      )}
    >
      <Plus className="size-4" aria-hidden />
    </button>
  )

  return (
    <h3
      className={cn(
        'sticky top-0 z-10 flex items-baseline justify-between px-4 py-2',
        onDeschideZiua ? 'gap-1' : 'gap-3',
        'border-b border-line text-[13px] font-semibold backdrop-blur-sm',
        isToday(zi) ? 'bg-primary-50/90 text-primary-700' : 'bg-surface/90 text-ink',
      )}
    >
      {onDeschideZiua ? (
        <>
          <button
            type="button"
            onClick={() => onDeschideZiua(zi)}
            aria-label={`Deschide ziua ${formateazaZiLunga(zi)}`}
            className="tinta-atingere -my-2 flex min-w-0 flex-1 items-center justify-between gap-2 py-2"
          >
            {titlu}
            <span className="flex shrink-0 items-center gap-0.5 text-[12px] font-normal text-ink-faint">
              {rezumat}
              <ChevronRight className="size-4 text-primary-600" aria-hidden />
            </span>
          </button>
          {plus}
        </>
      ) : (
        <>
          {titlu}
          <span className="flex shrink-0 items-center gap-2 text-[12px] font-normal text-ink-faint">
            {rezumat}
            {plus}
          </span>
        </>
      )}
    </h3>
  )
}

/** „3 programări · 1 notiță”, „liber”, „2 notițe”. */
export function rezumatZilei(programari: number, notite: number): string {
  const parti: string[] = []
  if (programari > 0) parti.push(`${programari} ${plural(programari, 'programare', 'programări')}`)
  if (notite > 0) parti.push(`${notite} ${plural(notite, 'notiță', 'notițe')}`)
  return parti.length ? parti.join(' · ') : 'liber'
}
