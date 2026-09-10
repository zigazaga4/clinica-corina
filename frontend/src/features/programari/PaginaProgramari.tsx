import { useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useProgramari, useUtilizatori } from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import { etichetaStareProgramare } from '@/domain/labels'
import {
  STARE_PROGRAMARE,
  type ProgramareDetaliu,
  type StareProgramare,
  type Uuid,
} from '@/domain/types'
import { cn } from '@/lib/cn'
import {
  deplaseazaAncora,
  formateazaLuna,
  formateazaZiLunga,
  formateazaZiScurta,
  intervalPentruVedere,
  isToday,
  laTimestamptz,
  type VedereCalendar,
} from '@/lib/dates'
import { useEcranMic } from '@/lib/hooks'
import {
  Buton,
  ButonGrup,
  Card,
  GrupButoane,
  IncarcarePagina,
  StareEroare,
} from '@/ui'
import { DetaliuProgramare } from './DetaliuProgramare'
import { FormularProgramare } from './FormularProgramare'
import { GrilaLuna } from './GrilaLuna'
import { GrilaOre, type ColoanaGrila } from './GrilaOre'
import { ListaAgenda } from './ListaAgenda'

/**
 * Calendarul (contract art. 3.1.B).
 *
 * Acoperă cele trei vederi cerute — zi, săptămână, lună — și agenda zilei
 * „pentru întreaga clinică sau pentru o singură persoană”: filtrul de executant
 * comută între cele două, fără un ecran separat.
 *
 * Pe telefon, toate vederile devin liste cronologice. O grilă cu șapte coloane
 * pe 360px ar da coloane de 44px, în care nu încape nici măcar ora.
 */
export function PaginaProgramari() {
  const ecranMic = useEcranMic()
  const { esteAdministrator } = useAutentificare()

  const [vedere, setVedere] = useState<VedereCalendar>('saptamana')
  const [ancora, setAncora] = useState(() => new Date())

  const [executantId, setExecutantId] = useState<Uuid | null>(null)
  const [clientId, setClientId] = useState<Uuid | null>(null)
  const [stariAscunse, setStariAscunse] = useState<Set<StareProgramare>>(new Set())

  const [formularDeschis, setFormularDeschis] = useState(false)
  const [deModificat, setDeModificat] = useState<ProgramareDetaliu | null>(null)
  const [deVazut, setDeVazut] = useState<ProgramareDetaliu | null>(null)

  const interval = useMemo(() => intervalPentruVedere(ancora, vedere), [ancora, vedere])

  const stariVizibile = STARE_PROGRAMARE.filter((s) => !stariAscunse.has(s))

  const { data, isPending, error, refetch } = useProgramari({
    de_la: laTimestamptz(interval.inceput),
    pana_la: laTimestamptz(interval.sfarsit),
    ...(executantId ? { executant_id: executantId } : {}),
    ...(clientId ? { client_id: clientId } : {}),
    stare: stariVizibile,
  })

  const programari = data ?? []

  // Coloanele pe persoană din vederea pe zi au nevoie de lista conturilor, care
  // este rută de administrator. Pentru ceilalți, ziua se afișează ca agendă —
  // exact forma cerută de contract pentru „o singură persoană”.
  const { data: utilizatori } = useUtilizatori({ activ: true }, esteAdministrator)

  const deschideFormular = (programare?: ProgramareDetaliu) => {
    setDeModificat(programare ?? null)
    setFormularDeschis(true)
  }

  const comutaStare = (stare: StareProgramare) => {
    setStariAscunse((precedente) => {
      const urmatoare = new Set(precedente)
      if (urmatoare.has(stare)) urmatoare.delete(stare)
      else urmatoare.add(stare)
      return urmatoare
    })
  }

  return (
    <Pagina className="flex h-full flex-col">
      <AntetPagina
        titlu="Programări"
        descriere={eticheteInterval(interval.zile, vedere, ancora)}
        actiuni={
          <Buton varianta="primar" onClick={() => deschideFormular()}>
            <CalendarPlus className="size-4" />
            <span className="hidden sm:inline">Programare nouă</span>
            <span className="sm:hidden">Adaugă</span>
          </Buton>
        }
      />

      {/* Navigarea în timp și comutarea vederii */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Buton
            dimensiune="icon-sm"
            onClick={() => setAncora((a) => deplaseazaAncora(a, vedere, -1))}
            aria-label="Interval anterior"
          >
            <ChevronLeft className="size-4" />
          </Buton>
          <Buton dimensiune="sm" onClick={() => setAncora(new Date())} disabled={esteAcum(interval.zile)}>
            Azi
          </Buton>
          <Buton
            dimensiune="icon-sm"
            onClick={() => setAncora((a) => deplaseazaAncora(a, vedere, 1))}
            aria-label="Interval următor"
          >
            <ChevronRight className="size-4" />
          </Buton>
        </div>

        <GrupButoane eticheta="Vedere calendar" className="ml-auto">
          {(['zi', 'saptamana', 'luna'] as VedereCalendar[]).map((v) => (
            <ButonGrup key={v} activ={vedere === v} onClick={() => setVedere(v)}>
              {v === 'zi' ? 'Zi' : v === 'saptamana' ? 'Săptămână' : 'Lună'}
            </ButonGrup>
          ))}
        </GrupButoane>
      </div>

      <BaraFiltre>
        <SelectorUtilizator
          valoare={executantId}
          onSchimba={setExecutantId}
          eticheta={null}
          placeholder="Toată clinica"
          cuGolire
          className="w-52"
        />
        {/*
          Filtrul de client răspunde la „când mai vine doamna X?”, întrebarea
          pusă cel mai des la telefon. Căutarea după nume se face pe server, în
          selector — lista de clienți nu încape în memorie și nici pe ecran.
        */}
        <SelectorClient
          valoare={clientId}
          onSchimba={setClientId}
          eticheta={null}
          placeholder="Toți clienții"
          cuGolire
          className="w-52"
        />

        {/*
          Filtrele de stare sunt „ascunde”, nu „arată”: implicit se vede tot,
          iar o programare nu poate dispărea din calendar fără ca cineva să fi
          apăsat explicit pe starea ei.
        */}
        <div className="flex items-center gap-1">
          {STARE_PROGRAMARE.map((stare) => (
            <button
              key={stare}
              type="button"
              onClick={() => comutaStare(stare)}
              aria-pressed={!stariAscunse.has(stare)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors',
                stariAscunse.has(stare)
                  ? 'text-ink-faint ring-line line-through'
                  : 'bg-muted text-ink ring-line',
              )}
            >
              {etichetaStareProgramare[stare]}
            </button>
          ))}
        </div>
      </BaraFiltre>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <StareEroare mesaj={error.message} onReincearca={() => void refetch()} />
        ) : isPending && programari.length === 0 ? (
          <IncarcarePagina />
        ) : (
          <Continut
            vedere={vedere}
            ecranMic={ecranMic}
            interval={interval}
            ancora={ancora}
            programari={programari}
            executantId={executantId}
            utilizatori={utilizatori ?? []}
            onAlegeProgramare={setDeVazut}
            onAlegeZi={(zi) => {
              setAncora(zi)
              setVedere('zi')
            }}
          />
        )}
      </Card>

      <FormularProgramare
        deschisa={formularDeschis}
        onInchide={() => setFormularDeschis(false)}
        programare={deModificat}
      />

      <DetaliuProgramare
        programare={deVazut}
        onInchide={() => setDeVazut(null)}
        onModifica={(programare) => {
          setDeVazut(null)
          deschideFormular(programare)
        }}
      />
    </Pagina>
  )
}

// ---------------------------------------------------------------------------
// Alegerea reprezentării
// ---------------------------------------------------------------------------

function Continut({
  vedere,
  ecranMic,
  interval,
  ancora,
  programari,
  executantId,
  utilizatori,
  onAlegeProgramare,
  onAlegeZi,
}: {
  vedere: VedereCalendar
  ecranMic: boolean
  interval: { inceput: Date; sfarsit: Date; zile: Date[] }
  ancora: Date
  programari: ProgramareDetaliu[]
  executantId: Uuid | null
  utilizatori: { id: Uuid; nume: string; rol: string }[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeZi: (zi: Date) => void
}) {
  // Pe telefon, orice vedere devine listă.
  if (ecranMic) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ListaAgenda
          zile={interval.zile}
          programari={programari}
          onAlegeProgramare={onAlegeProgramare}
          cuExecutant={executantId === null}
          ascundeZileleGoale={vedere === 'luna'}
        />
      </div>
    )
  }

  if (vedere === 'luna') {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <GrilaLuna
          zile={interval.zile}
          luna={ancora.getMonth()}
          programari={programari}
          onAlegeZi={onAlegeZi}
          onAlegeProgramare={onAlegeProgramare}
        />
      </div>
    )
  }

  if (vedere === 'saptamana') {
    const coloane: ColoanaGrila[] = interval.zile.map((zi) => ({
      id: zi.toISOString(),
      eticheta: capitalizeaza(formateazaZiLunga(zi).split(',')[0] ?? ''),
      subeticheta: formateazaZiScurta(zi),
      zi,
      programari: programari.filter((p) => aceeasiZi(p.incepe_la, zi)),
    }))
    return <GrilaOre coloane={coloane} onAlegeProgramare={onAlegeProgramare} />
  }

  // Vederea pe zi: o coloană per persoană — agenda întregii clinici. Filtrată
  // pe un executant, rămâne o singură coloană: agenda acelei persoane.
  const zi = interval.zile[0]
  if (!zi) return null

  const aleZilei = programari.filter((p) => aceeasiZi(p.incepe_la, zi))

  // Fără lista conturilor (operator obișnuit), coloanele se deduc din
  // programările zilei — suficient pentru a vedea cine lucrează.
  const persoane =
    utilizatori.length > 0
      ? utilizatori
      : [...new Map(aleZilei.map((p) => [p.executant_id, { id: p.executant_id, nume: p.executant_nume, rol: '' }])).values()]

  const relevante = executantId ? persoane.filter((u) => u.id === executantId) : persoane
  const coloane: ColoanaGrila[] = relevante.map((persoana) => ({
    id: persoana.id,
    eticheta: persoana.nume,
    subeticheta: `${aleZilei.filter((p) => p.executant_id === persoana.id).length} programări`,
    zi,
    programari: aleZilei.filter((p) => p.executant_id === persoana.id),
  }))

  if (coloane.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ListaAgenda
          zile={[zi]}
          programari={aleZilei}
          onAlegeProgramare={onAlegeProgramare}
        />
      </div>
    )
  }

  return <GrilaOre coloane={coloane} onAlegeProgramare={onAlegeProgramare} />
}

// ---------------------------------------------------------------------------
// Ajutătoare
// ---------------------------------------------------------------------------

function aceeasiZi(momentIso: string, zi: Date): boolean {
  const d = new Date(momentIso)
  return (
    d.getFullYear() === zi.getFullYear() &&
    d.getMonth() === zi.getMonth() &&
    d.getDate() === zi.getDate()
  )
}

function capitalizeaza(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function esteAcum(zile: Date[]): boolean {
  return zile.some((zi) => isToday(zi))
}

/** Eticheta intervalului afișat, potrivită vederii. */
function eticheteInterval(zile: Date[], vedere: VedereCalendar, ancora: Date): string {
  if (vedere === 'zi') return capitalizeaza(formateazaZiLunga(zile[0] ?? ancora))
  if (vedere === 'luna') return capitalizeaza(formateazaLuna(ancora))
  const prima = zile[0]
  const ultima = zile[zile.length - 1]
  if (!prima || !ultima) return ''
  return `${formateazaZiScurta(prima)} – ${formateazaZiScurta(ultima)}`
}
