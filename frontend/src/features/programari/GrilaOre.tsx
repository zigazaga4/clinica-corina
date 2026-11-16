import { useEffect, useRef } from 'react'
import type { NotitaDetaliu, ProgramareDetaliu, Uuid } from '@/domain/types'
import { cn } from '@/lib/cn'
import { isToday, laData } from '@/lib/dates'
import { ChipNotita } from './CardNotita'
import { ChipProgramare } from './CardProgramare'
import { useCuloarePersoana } from './culoriExecutanti'
import { type ElementCalendar, elementeCalendar, intervalul } from './elemente'
import { PersoaneZilei, STIL_ZI_LIBERA, type PersoanaZilei } from './programLucru'
import { StratSelectie } from './StratSelectie'
import {
  MINUTE_VIZIBILE,
  ORA_INCEPUT,
  ORE,
  PIXELI_PE_ORA,
  PIXELI_PE_ORA_MARE,
  inaltimeGrila,
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
  /** Persoana coloanei nu lucrează în ziua aceasta (programul de lucru): fundal dungat. */
  libera?: boolean
  /** Vederea pe săptămână: cine lucrează și cine e liber în ziua coloanei. */
  persoaneZilei?: PersoanaZilei[]
}

/** Cât din lățimea coloanei ocupă programările; restul e fâșia pentru una nouă. */
const LATIME_ELEMENTE = 80

/**
 * Lățimea minimă a unui bloc pe ziua mare, în pixeli: cât să încapă „10:45–”
 * și un nume pe rând. Cu șapte ședințe deodată, împărțite la 360px, blocurile
 * ar fi de 40px și textul s-ar rupe literă cu literă; sub această lățime grila
 * derulează pe orizontală, iar ora rămâne pe loc, în stânga.
 */
const LATIME_MINIMA_BLOC_MARE = 92

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
  mare = false,
}: {
  coloane: ColoanaGrila[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  /** Prezentă = spațiul liber al grilei se poate apăsa pentru o programare nouă. */
  onProgrameaza?: (loc: LocGrila) => void
  antetLipicios?: boolean
  /**
   * Ziua „mare” de pe telefon (cerința Corinei, 13 nov. 2026): ore înalte, text
   * mare, blocurile pe toată lățimea coloanei și o coloană care încape în
   * ecran, nu una de 160px cu derulare pe orizontală. Spațiul liber se apasă
   * pentru o programare nouă (cerința din 16 nov. 2026), ca pe calculator: o
   * atingere scurtă alege sfertul de oră, iar degetul care derulează nu
   * deschide nimic — browserul preia gestul și anulează apăsarea.
   */
  mare?: boolean
}) {
  const refDerulare = useRef<HTMLDivElement>(null)
  const pxOra = mare ? PIXELI_PE_ORA_MARE : PIXELI_PE_ORA

  // La deschidere, grila sare la ora curentă. Fără asta, o clinică ce începe la
  // 8:00 și e consultată la 15:00 arată o zonă goală, iar utilizatorul trebuie
  // să deruleze de fiecare dată.
  useEffect(() => {
    const container = refDerulare.current
    if (!container) return
    const acum = new Date()
    const pozitie = pozitieVerticala(acum, pxOra) - 120
    container.scrollTop = Math.max(0, pozitie)
  }, [pxOra])

  return (
    <div ref={refDerulare} className="relative overflow-auto">
      <div className={cn('flex', !mare && 'min-w-max')}>
        {/* Coloana orelor */}
        <div className={cn('sticky left-0 z-20 shrink-0 bg-surface', mare ? 'w-14' : 'w-13')}>
          <div
            className={cn(
              mare ? 'h-14' : 'h-11',
              'border-b-2 border-line bg-surface',
              antetLipicios && 'sticky top-0 z-10',
            )}
          />
          <div className="relative" style={{ height: inaltimeGrila(pxOra) }}>
            {ORE.map((ora) => (
              <span
                key={ora}
                className={cn(
                  'absolute right-1.5 -translate-y-1/2 tabular-nums',
                  mare ? 'text-[14px] font-semibold text-ink-soft' : 'text-[11px] text-ink-faint',
                )}
                style={{ top: (ora - ORA_INCEPUT) * pxOra }}
              >
                {String(ora).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>

        {/* Coloanele de conținut */}
        <div className="flex flex-1">
          {coloane.map((coloana) => (
            // Ziua mare: lățimea minimă o dă conținutul (v. `LATIME_MINIMA_BLOC_MARE`).
            <div key={coloana.id} className={cn('flex-1 border-l-2 border-line', !mare && 'min-w-40')}>
              <AntetColoana coloana={coloana} lipicios={antetLipicios} mare={mare} />

              <ColoanaElemente
                elemente={elementeCalendar(coloana.programari, coloana.notite ?? [])}
                zi={coloana.zi}
                libera={coloana.libera}
                mare={mare}
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
  libera = false,
  mare = false,
  onAlegeProgramare,
  onAlegeNotita,
  onAlegeLoc,
}: {
  elemente: ElementCalendar[]
  zi?: Date
  libera?: boolean
  mare?: boolean
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita?: (notita: NotitaDetaliu) => void
  onAlegeLoc?: (inceput: Date, sfarsit: Date | null) => void
}) {
  const asezate = asazaFaraSuprapunere(elemente)
  const pxOra = mare ? PIXELI_PE_ORA_MARE : PIXELI_PE_ORA
  /*
    Fâșia liberă din dreapta (cerința clinicii, 2026-10-01): programările ocupă
    doar 80% din lățime când coloana primește programări noi. Restul rămâne
    spațiu gol, deci apăsat — chiar lângă o programare existentă — deschide o
    programare nouă la ora aceea, pentru aceeași persoană, ca într-o zi goală.
  */
  // Ziua mare păstrează blocurile pe toată lățimea: se programează în golurile dintre ele.
  const latimeElemente = onAlegeLoc && !mare ? LATIME_ELEMENTE : 100
  // Câte ședințe stau cel mult una lângă alta: de ele depinde lățimea minimă.
  const suprapuneriMax = Math.max(1, ...asezate.map((a) => a.total))

  return (
    <div
      className="relative"
      // Zi liberă după programul de lucru: dungi discrete. Locul rămâne apăsabil
      // — o excepție („vine totuși azi”) nu are voie să fie imposibilă.
      style={{
        height: inaltimeGrila(pxOra),
        ...(mare ? { minWidth: suprapuneriMax * LATIME_MINIMA_BLOC_MARE } : {}),
        ...(libera ? STIL_ZI_LIBERA : {}),
      }}
    >
      {/* Primul, deci dedesubt: programările și notițele se apasă peste el. */}
      {zi && onAlegeLoc && <StratSelectie zi={zi} onAlege={onAlegeLoc} pixeliPeOra={pxOra} />}

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
          style={{ top: (ora - ORA_INCEPUT) * pxOra }}
          aria-hidden
        />
      ))}

      {/* Ziua mare: și jumătățile de oră, punctate — ora unei ședințe de 30 de
          minute se citește de pe ele fără să numeri sferturi. */}
      {mare &&
        ORE.slice(0, -1).map((ora) => (
          <div
            key={`jumatate-${ora}`}
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line/70"
            style={{ top: (ora - ORA_INCEPUT + 0.5) * pxOra }}
            aria-hidden
          />
        ))}

      {zi && isToday(zi) && <LinieAcum pixeliPeOra={pxOra} />}

      {asezate.map(({ element, coloana, total }) => {
        const { id, incepe_la, se_termina_la } = intervalul(element)
        const inceput = laData(incepe_la)
        const sfarsit = laData(se_termina_la)
        const latime = latimeElemente / total
        const inaltime = inaltimeInterval(inceput, sfarsit, pxOra)
        const asezare = {
          mare,
          // Pe ziua mare textul e mai înalt, deci și pragurile sunt mai sus:
          // un rând de 15px ia ~18px, trei rânduri ~62px.
          compact: inaltime < (mare ? 40 : 38),
          ampla: inaltime >= (mare ? 66 : 52),
          /*
            Programări suprapuse: fiecare primește o felie îngustă. Sub cursor,
            felia se lățește pe toată zona programărilor și vine deasupra
            celorlalte, ca să se citească întreagă înainte de apăsare. `!`
            trece peste stilul inline cu poziția feliei.
          */
          className: cn(
            'absolute',
            total > 1 && 'hover:left-0.5! hover:w-(--latime-plina)! hover:z-10',
          ),
          style: {
            top: pozitieVerticala(inceput, pxOra),
            height: inaltime - 2,
            left: `calc(${coloana * latime}% + 2px)`,
            width: `calc(${latime}% - 4px)`,
            '--latime-plina': `calc(${latimeElemente}% - 4px)`,
          } as React.CSSProperties,
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
function AntetColoana({
  coloana,
  lipicios,
  mare = false,
}: {
  coloana: ColoanaGrila
  lipicios: boolean
  mare?: boolean
}) {
  const culoare = useCuloarePersoana(coloana.id)

  return (
    <div
      className={cn(
        'flex flex-col justify-center border-b-2 border-line bg-surface px-2',
        mare ? 'h-14' : 'h-11',
        lipicios && 'sticky top-0 z-10',
        coloana.zi && isToday(coloana.zi) && 'bg-primary-50',
      )}
    >
      <span
        style={culoare?.stil}
        className={cn(
          'flex items-center gap-1.5 truncate font-medium',
          mare ? 'text-[16px] font-semibold' : 'text-[13px]',
          culoare ? culoare.text : 'text-ink',
        )}
      >
        {culoare && (
          <span className={cn('size-2 shrink-0 rounded-full', culoare.fundal)} aria-hidden />
        )}
        <span className="truncate">{coloana.eticheta}</span>
      </span>
      {(coloana.subeticheta || coloana.libera || coloana.persoaneZilei?.length) && (
        <span
          className={cn(
            'flex min-w-0 items-center gap-1.5 truncate text-ink-faint',
            mare ? 'text-[13px] text-ink-soft' : 'text-[11px]',
            culoare && 'pl-3.5',
          )}
        >
          {coloana.libera && <span className="shrink-0 font-semibold text-danger">Zi liberă</span>}
          {coloana.subeticheta && (
            <span className="shrink-0">
              {coloana.libera ? `· ${coloana.subeticheta}` : coloana.subeticheta}
            </span>
          )}
          {coloana.persoaneZilei && <PersoaneZilei persoane={coloana.persoaneZilei} />}
        </span>
      )}
    </div>
  )
}

function LinieAcum({ pixeliPeOra }: { pixeliPeOra: number }) {
  const acum = new Date()
  const minute = acum.getHours() * 60 + acum.getMinutes() - ORA_INCEPUT * 60
  // În afara programului nu are ce marca.
  if (minute < 0 || minute > MINUTE_VIZIBILE) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top: pozitieVerticala(acum, pixeliPeOra) }}
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
 * Din 2026-10-01 aceeași persoană poate avea mai multe programări la aceeași
 * oră (cerința clinicii), iar notițele se suprapun DINADINS cu orice:
 * „furnizor la 15:00” stă peste ședința de la 15:00. Fără această așezare,
 * ele s-ar desena una peste alta și doar ultima ar mai putea fi apăsată.
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
