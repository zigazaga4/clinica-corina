import type { ProgramareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { esteInZiua, formateazaZiScurt, isToday } from '@/lib/dates'
import { ChipProgramare } from './CardProgramare'

/** Câte programări încap într-o celulă înainte de „+N”. */
const MAXIM_PE_ZI = 3

/**
 * Vederea pe lună.
 *
 * Nu încearcă să arate orele — la 42 de zile pe ecran nu ar încăpea. Rolul ei
 * este densitatea: unde sunt zilele pline și unde sunt goluri. Apăsarea unei
 * zile trece în vederea pe zi, acolo unde detaliile chiar au loc.
 */
export function GrilaLuna({
  zile,
  luna,
  programari,
  onAlegeZi,
  onAlegeProgramare,
}: {
  /** Cele 42 de zile ale grilei (6 săptămâni complete). */
  zile: Date[]
  /** Luna ancoră: zilele din alte luni se estompează. */
  luna: number
  programari: ProgramareDetaliu[]
  onAlegeZi: (zi: Date) => void
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
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
          const aleZilei = programari.filter((p) => esteInZiua(p.incepe_la, zi))
          const dinLunaCurenta = zi.getMonth() === luna
          const azi = isToday(zi)

          return (
            <div
              key={zi.toISOString()}
              className={cn(
                'flex min-h-24 flex-col gap-0.5 border-r-2 border-b-2 border-line p-1',
                // Zilele din lunile vecine rămân vizibile, dar estompate:
                // săptămâna de la marginea lunii trebuie să arate completă.
                !dinLunaCurenta && 'bg-muted/40',
              )}
            >
              <button
                type="button"
                onClick={() => onAlegeZi(zi)}
                className={cn(
                  'mb-0.5 flex size-6 shrink-0 items-center justify-center self-start rounded-full',
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

              {aleZilei.slice(0, MAXIM_PE_ZI).map((programare) => (
                <ChipProgramare
                  key={programare.id}
                  programare={programare}
                  onClick={onAlegeProgramare}
                  compact
                  className="shrink-0"
                />
              ))}

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
