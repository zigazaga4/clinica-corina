import { useEffect, useRef } from 'react'
import type { ProgramareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { isToday, laData } from '@/lib/dates'
import { ChipProgramare } from './CardProgramare'
import { useCuloarePersoana } from './culoriExecutanti'
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
}

export function GrilaOre({
  coloane,
  onAlegeProgramare,
  antetLipicios = true,
}: {
  coloane: ColoanaGrila[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
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
              'h-11 border-b border-line bg-surface',
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
              className="min-w-40 flex-1 border-l border-line"
            >
              <AntetColoana coloana={coloana} lipicios={antetLipicios} />

              <ColoanaProgramari
                programari={coloana.programari}
                zi={coloana.zi}
                onAlege={onAlegeProgramare}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ColoanaProgramari({
  programari,
  zi,
  onAlege,
}: {
  programari: ProgramareDetaliu[]
  zi?: Date
  onAlege: (programare: ProgramareDetaliu) => void
}) {
  const asezate = asazaFaraSuprapunere(programari)

  return (
    <div className="relative" style={{ height: INALTIME_GRILA }}>
      {/* Liniile orelor */}
      {ORE.map((ora) => (
        <div
          key={ora}
          className="absolute inset-x-0 border-t border-line/60"
          style={{ top: (ora - ORA_INCEPUT) * PIXELI_PE_ORA }}
          aria-hidden
        />
      ))}

      {zi && isToday(zi) && <LinieAcum />}

      {asezate.map(({ programare, coloana, total }) => {
        const inceput = laData(programare.incepe_la)
        const sfarsit = laData(programare.se_termina_la)
        const latime = 100 / total
        return (
          <ChipProgramare
            key={programare.id}
            programare={programare}
            onClick={onAlege}
            compact={inaltimeInterval(inceput, sfarsit) < 38}
            className="absolute"
            style={{
              top: pozitieVerticala(inceput),
              height: inaltimeInterval(inceput, sfarsit) - 2,
              left: `calc(${coloana * latime}% + 2px)`,
              width: `calc(${latime}% - 4px)`,
            }}
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
        'flex h-11 flex-col justify-center border-b border-line bg-surface px-2',
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
      <span className="size-2 shrink-0 rounded-full bg-danger" />
      <span className="h-px flex-1 bg-danger" />
    </div>
  )
}

interface Asezare {
  programare: ProgramareDetaliu
  coloana: number
  total: number
}

/**
 * Împarte pe coloane programările care se suprapun în timp.
 *
 * În mod normal nu se suprapun: constrângerea `programare_fara_suprapunere`
 * împiedică asta pentru aceeași persoană. Excepția o fac programările ANULATE,
 * care sunt scoase din constrângere — iar locul eliberat este de obicei
 * reocupat imediat. Fără această așezare, cele două s-ar desena una peste alta
 * și una ar deveni imposibil de apăsat.
 */
function asazaFaraSuprapunere(programari: ProgramareDetaliu[]): Asezare[] {
  const ordonate = [...programari].sort((a, b) => a.incepe_la.localeCompare(b.incepe_la))
  const rezultat: Asezare[] = []

  let grup: ProgramareDetaliu[] = []
  let sfarsitGrup = ''

  const inchideGrupul = () => {
    if (grup.length === 0) return
    // Fiecare programare din grup primește prima coloană liberă la ora ei.
    const capeteColoane: string[] = []
    const asezari = grup.map((programare) => {
      let coloana = capeteColoane.findIndex((capat) => capat <= programare.incepe_la)
      if (coloana === -1) {
        coloana = capeteColoane.length
        capeteColoane.push(programare.se_termina_la)
      } else {
        capeteColoane[coloana] = programare.se_termina_la
      }
      return { programare, coloana }
    })
    for (const asezare of asezari) {
      rezultat.push({ ...asezare, total: capeteColoane.length })
    }
    grup = []
    sfarsitGrup = ''
  }

  for (const programare of ordonate) {
    // Un grup se încheie când apare o programare care nu atinge niciuna
    // dintre cele dinainte.
    if (grup.length > 0 && programare.incepe_la >= sfarsitGrup) inchideGrupul()
    grup.push(programare)
    if (programare.se_termina_la > sfarsitGrup) sfarsitGrup = programare.se_termina_la
  }
  inchideGrupul()

  return rezultat
}
