import { Plus } from 'lucide-react'
import type { NotitaDetaliu, ProgramLucru, ProgramareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaZiLunga, formateazaZiScurt, isToday } from '@/lib/dates'
import { ChipNotita } from './CardNotita'
import { ChipProgramare } from './CardProgramare'
import { dinZiua, elementeCalendar, intervalul } from './elemente'
import { PersoaneZilei, persoaneleZilei } from './programLucru'

/** Câte elemente încap într-o celulă înainte de „+N”. */
const MAXIM_PE_ZI = 3

/**
 * Vederea pe lună.
 *
 * Nu încearcă să arate orele — la 42 de zile pe ecran nu ar încăpea. Rolul ei
 * este densitatea: unde sunt zilele pline și unde sunt goluri. Apăsarea
 * numărului zilei trece în vederea pe zi, acolo unde detaliile chiar au loc;
 * apăsarea spațiului liber din zi (sau a „+”) deschide o programare nouă în ea.
 */
export function GrilaLuna({
  zile,
  luna,
  programari,
  notite = [],
  programe = [],
  onAlegeZi,
  onAlegeProgramare,
  onAlegeNotita,
  onProgrameaza,
}: {
  /** Cele 42 de zile ale grilei (6 săptămâni complete). */
  zile: Date[]
  /** Luna ancoră: zilele din alte luni se estompează. */
  luna: number
  programari: ProgramareDetaliu[]
  notite?: NotitaDetaliu[]
  /** Programul de lucru: lângă numărul zilei, cine lucrează și cine e liber. */
  programe?: ProgramLucru[]
  onAlegeZi: (zi: Date) => void
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  /** Prezentă = spațiul liber al unei zile deschide o programare nouă în ea. */
  onProgrameaza?: (zi: Date) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b-2 border-line">
        {zile.slice(0, 7).map((zi) => (
          <div
            key={zi.toISOString()}
            className="px-2 py-1.5 text-center text-[11px] font-medium tracking-wide text-ink-faint uppercase"
          >
            {formateazaZiScurt(zi)}
          </div>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {zile.map((zi) => {
          const aleZilei = elementeCalendar(dinZiua(programari, zi), dinZiua(notite, zi))
          const dinLunaCurenta = zi.getMonth() === luna
          const azi = isToday(zi)

          return (
            <div
              key={zi.toISOString()}
              // Doar spațiul liber al zilei: programările, notițele și butoanele
              // din ea (toate sunt `button`) își păstrează apăsarea lor.
              onClick={
                onProgrameaza
                  ? (e) => {
                      if (!(e.target as Element).closest('button')) onProgrameaza(zi)
                    }
                  : undefined
              }
              className={cn(
                'group flex min-h-24 flex-col gap-0.5 border-r-2 border-b-2 border-line p-1',
                // Zilele din lunile vecine rămân vizibile, dar estompate:
                // săptămâna de la marginea lunii trebuie să arate completă.
                !dinLunaCurenta && 'bg-muted/40',
                onProgrameaza && 'cursor-pointer transition-colors hover:bg-primary-50/50',
              )}
            >
              <div className="mb-0.5 flex shrink-0 items-center justify-between">
                <button
                  type="button"
                  onClick={() => onAlegeZi(zi)}
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full',
                    'text-[12px] font-medium tabular-nums transition-colors',
                    azi
                      ? 'bg-primary-600 text-white'
                      : dinLunaCurenta
                        ? 'text-ink hover:bg-muted'
                        : 'text-ink-faint hover:bg-muted',
                  )}
                >
                  {zi.getDate()}
                </button>
                <PersoaneZilei
                  persoane={persoaneleZilei(programe, zi)}
                  className="flex-1 justify-end px-1 text-[11px]"
                />
                {/*
                  Același lucru ca apăsarea spațiului liber, dar vizibil și
                  atins de tastatură. Apare la trecerea mouse-ului, ca cele 42
                  de zile să nu fie 42 de plusuri.
                */}
                {onProgrameaza && (
                  <button
                    type="button"
                    onClick={() => onProgrameaza(zi)}
                    aria-label={`Programare nouă pe ${formateazaZiLunga(zi)}`}
                    title="Programare nouă"
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-primary-600',
                      'opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary-100',
                      'focus-visible:opacity-100',
                    )}
                  >
                    <Plus className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>

              {aleZilei.slice(0, MAXIM_PE_ZI).map((element) =>
                element.fel === 'programare' ? (
                  <ChipProgramare
                    key={element.programare.id}
                    programare={element.programare}
                    servicii={element.servicii}
                    onClick={onAlegeProgramare}
                    compact
                    className="shrink-0"
                  />
                ) : (
                  <ChipNotita
                    key={intervalul(element).id}
                    notita={element.notita}
                    onClick={onAlegeNotita ?? (() => undefined)}
                    compact
                    className="shrink-0"
                  />
                ),
              )}

              {aleZilei.length > MAXIM_PE_ZI && (
                <button
                  type="button"
                  onClick={() => onAlegeZi(zi)}
                  className="shrink-0 px-1 text-left text-[11px] font-medium text-ink-faint hover:text-primary-600"
                >
                  +{aleZilei.length - MAXIM_PE_ZI} altele
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
