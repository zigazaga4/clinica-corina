import { useEffect, useRef } from 'react'
import type { NotitaDetaliu, ProgramareDetaliu, Uuid } from '@/domain/types'
import { cn } from '@/lib/cn'
import { isToday, laData } from '@/lib/dates'
import { ChipNotita } from './CardNotita'
import { ChipProgramare } from './CardProgramare'
import { useCuloarePersoana } from './culoriExecutanti'
import { type ElementCalendar, elementeCalendar, intervalul } from './elemente'
import { StratSelectie } from './StratSelectie'
import {
  INALTIME_GRILA,
  MINUTE_VIZIBILE,
  ORA_INCEPUT,
  ORE,
  PIXELI_PE_ORA,
  inaltimeInterval,
  pozitieVerticala,
} from './constante'

/*
  Grila orară.

  Aceeași componentă servește și vederea pe zi, și pe cea pe săptămână — se
  schimbă doar ce înseamnă o coloană: o persoană în vederea pe zi, o zi în
  vederea pe săptămână. Ar fi fost mai simplu să scriu două grile; ar fi fost
  și două locuri în care să repar aceeași eroare de poziționare.
*/

export interface ColoanaGrila {
  id: string
  eticheta: string
  /** Al doilea rând din antet: rolul persoanei sau data zilei. */
  subeticheta?: string
  /** Ziua reprezentată de coloană; marchează „azi” în vederea pe săptămână. */
  zi?: Date
  programari: ProgramareDetaliu[]
  /** Notițele coloanei, așezate în aceeași grilă, alături de programări. */
  notite?: NotitaDetaliu[]
  /** Persoana coloanei, în vederea pe zi: o programare pusă aici este a ei. */
  executantId?: Uuid
  /** Coloana notițelor clinicii: nu primește programări. */
  doarNotite?: boolean
}

/** Locul apăsat pe grilă: ora (și sfârșitul, dacă s-a tras) și coloana lui. */
export interface LocGrila {
  inceput: Date
  sfarsit: Date | null
  coloana: ColoanaGrila
}

export function GrilaOre({
  coloane,
  onAlegeProgramare,
  onAlegeNotita,
  onProgrameaza,
  antetLipicios = true,
}: {
  coloane: ColoanaGrila[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  /** Prezentă = spațiul liber al grilei se poate apăsa pentru o programare nouă. */
  onProgrameaza?: (loc: LocGrila) => void
  antetLipicios?: boolean
}) {
  const refDerulare = useRef<HTMLDivElement>(null)

  // La deschidere, grila sare la ora curentă. Fără asta, o clinică ce începe la
  // 8:00 și e consultată la 15:00 arată o zonă goală, iar utilizatorul trebuie
  // să deruleze de fiecare dată.
  useEffect(() => {
    const container = refDerulare.current
    if (!container) return
    const acum = new Date()
    const pozitie = pozitieVerticala(acum) - 120
    container.scrollTop = Math.max(0, pozitie)
  }, [])

  return (
    <div ref={refDerulare} className="relative overflow-auto">
      <div className="flex min-w-max">
        {/* Coloana orelor */}
        <div className="sticky left-0 z-20 w-13 shrink-0 bg-surface">
          <div
            className={cn(
              'h-11 border-b-2 border-line bg-surface',
              antetLipicios && 'sticky top-0 z-10',
            )}
          />
          <div className="relative" style={{ height: INALTIME_GRILA }}>
            {ORE.map((ora) => (
              <span
                key={ora}
                className="absolute right-1.5 -translate-y-1/2 text-[11px] text-ink-faint tabular-nums"
                style={{ top: (ora - ORA_INCEPUT) * PIXELI_PE_ORA }}
              >
                {String(ora).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>

        {/* Coloanele de conținut */}
        <div className="flex flex-1">
          {coloane.map((coloana) => (
            <div
              key={coloana.id}
              className="min-w-40 flex-1 border-l-2 border-line"
            >
              <AntetColoana coloana={coloana} lipicios={antetLipicios} />

              <ColoanaElemente
                elemente={elementeCalendar(coloana.programari, coloana.notite ?? [])}
                zi={coloana.zi}
                onAlegeProgramare={onAlegeProgramare}
                onAlegeNotita={onAlegeNotita}
                onAlegeLoc={
                  onProgrameaza && !coloana.doarNotite
                    ? (inceput, sfarsit) => onProgrameaza({ inceput, sfarsit, coloana })
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ColoanaElemente({
  elemente,
  zi,
  onAlegeProgramare,
  onAlegeNotita,
  onAlegeLoc,
}: {
  elemente: ElementCalendar[]
  zi?: Date
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  onAlegeLoc?: (inceput: Date, sfarsit: Date | null) => void
}) {
  const asezate = asazaFaraSuprapunere(elemente)

  return (
    <div className="relative" style={{ height: INALTIME_GRILA }}>
      {/* Primul, deci dedesubt: programările și notițele se apasă peste el. */}
      {zi && onAlegeLoc && <StratSelectie zi={zi} onAlege={onAlegeLoc} />}

      {/* Liniile orelor */}
      {ORE.map((ora) => (
        <div
          key={ora}
          // Linia orei este reperul după care se citește la ce oră stă o
          // programare. Subțire și spălăcită, se pierdea pe ecranul de la
          // recepție; acum are grosime întreagă și culoarea neatenuată.
          // Apăsarea trece prin ea, la stratul de dedesubt: altfel ora fixă —
          // exact locul pe care îl nimerește cine vrea „la 10” — n-ar răspunde.
          className="pointer-events-none absolute inset-x-0 border-t-2 border-line"
          style={{ top: (ora - ORA_INCEPUT) * PIXELI_PE_ORA }}
          aria-hidden
        />
      ))}

      {zi && isToday(zi) && <LinieAcum />}

      {asezate.map(({ element, coloana, total }) => {
        const { id, incepe_la, se_termina_la } = intervalul(element)
        const inceput = laData(incepe_la)
        const sfarsit = laData(se_termina_la)
        const latime = 100 / total
        const asezare = {
          compact: inaltimeInterval(inceput, sfarsit) < 38,
          className: 'absolute',
          style: {
            top: pozitieVerticala(inceput),
            height: inaltimeInterval(inceput, sfarsit) - 2,
            left: `calc(${coloana * latime}% + 2px)`,
            width: `calc(${latime}% - 4px)`,
          },
        }
        return element.fel === 'programare' ? (
          <ChipProgramare
            key={id}
            programare={element.programare}
            servicii={element.servicii}
            onClick={onAlegeProgramare}
            {...asezare}
          />
        ) : (
          <ChipNotita
            key={id}
            notita={element.notita}
            onClick={onAlegeNotita ?? (() => undefined)}
            {...asezare}
          />
        )
      })}
    </div>
  )
}

/** Linia roșie a momentului curent. */
/**
 * Antetul unei coloane.
 *
 * Trăiește separat fiindcă are nevoie de un hook, iar hook-urile nu se pot
 * chema dintr-un `.map()`.
 *
 * `coloana.id` este ori un cont (vederea pe zi, o coloană per persoană), ori o
 * dată calendaristică (vederea pe săptămână). Căutarea culorii merge pe același
 * drum în ambele cazuri: pentru o dată nu găsește nimic, întoarce `null`, iar
 * antetul rămâne exact cum era. Nu este nevoie de nicio ramificație.
 */
function AntetColoana({ coloana, lipicios }: { coloana: ColoanaGrila; lipicios: boolean }) {
  const culoare = useCuloarePersoana(coloana.id)

  return (
    <div
      className={cn(
        'flex h-11 flex-col justify-center border-b-2 border-line bg-surface px-2',
        lipicios && 'sticky top-0 z-10',
        coloana.zi && isToday(coloana.zi) && 'bg-primary-50',
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 truncate text-[13px] font-medium',
          culoare ? culoare.text : 'text-ink',
        )}
      >
        {culoare && (
          <span className={cn('size-2 shrink-0 rounded-full', culoare.fundal)} aria-hidden />
        )}
        <span className="truncate">{coloana.eticheta}</span>
      </span>
      {coloana.subeticheta && (
        <span className="truncate pl-3.5 text-[11px] text-ink-faint">{coloana.subeticheta}</span>
      )}
    </div>
  )
}

function LinieAcum() {
  const acum = new Date()
  const minute = acum.getHours() * 60 + acum.getMinutes() - ORA_INCEPUT * 60
  // În afara programului nu are ce marca.
  if (minute < 0 || minute > MINUTE_VIZIBILE) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top: pozitieVerticala(acum) }}
      aria-hidden
    >
      <span className="size-2.5 shrink-0 rounded-full bg-danger" />
      <span className="h-0.5 flex-1 bg-danger" />
    </div>
  )
}

interface Asezare {
  element: ElementCalendar
  coloana: number
  total: number
}

/**
 * Împarte pe coloane elementele care se suprapun în timp.
 *
 * Programările nu se suprapun în mod normal: constrângerea
 * `programare_fara_suprapunere` împiedică asta pentru aceeași persoană.
 * Excepția o fac programările ANULATE, care sunt scoase din constrângere — iar
 * locul eliberat este de obicei reocupat imediat. Notițele, în schimb, se
 * suprapun DINADINS cu orice: „furnizor la 15:00” stă peste ședința de la
 * 15:00. Fără această așezare, cele două s-ar desena una peste alta și una ar
 * deveni imposibil de apăsat.
 */
function asazaFaraSuprapunere(elemente: ElementCalendar[]): Asezare[] {
  const ordonate = [...elemente].sort((a, b) =>
    intervalul(a).incepe_la.localeCompare(intervalul(b).incepe_la),
  )
  const rezultat: Asezare[] = []

  let grup: ElementCalendar[] = []
  let sfarsitGrup = ''

  const inchideGrupul = () => {
    if (grup.length === 0) return
    // Fiecare element din grup primește prima coloană liberă la ora lui.
    const capeteColoane: string[] = []
    const asezari = grup.map((element) => {
      const { incepe_la, se_termina_la } = intervalul(element)
      let coloana = capeteColoane.findIndex((capat) => capat <= incepe_la)
      if (coloana === -1) {
        coloana = capeteColoane.length
        capeteColoane.push(se_termina_la)
      } else {
        capeteColoane[coloana] = se_termina_la
      }
      return { element, coloana }
    })
    for (const asezare of asezari) {
      rezultat.push({ ...asezare, total: capeteColoane.length })
    }
    grup = []
    sfarsitGrup = ''
  }

  for (const element of ordonate) {
    const { incepe_la, se_termina_la } = intervalul(element)
    // Un grup se încheie când apare un element care nu atinge niciunul dintre
    // cele dinainte.
    if (grup.length > 0 && incepe_la >= sfarsitGrup) inchideGrupul()
    grup.push(element)
    if (se_termina_la > sfarsitGrup) sfarsitGrup = se_termina_la
  }
  inchideGrupul()

  return rezultat
}
