import { useMemo, useState } from 'react'
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Palette,
  SlidersHorizontal,
  StickyNote,
} from 'lucide-react'
import {
  useArticole,
  useNotite,
  useProgramLucru,
  useProgramari,
  useUtilizatori,
} from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import { etichetaStareProgramare } from '@/domain/labels'
import {
  STARE_PROGRAMARE,
  type NotitaDetaliu,
  type ProgramLucru,
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
  laInputDate,
  laTimestamptz,
  type VedereCalendar,
} from '@/lib/dates'
import { useEcranMic } from '@/lib/hooks'
import {
  Buton,
  ButonGrup,
  Card,
  Contor,
  ElementMeniu,
  GrupButoane,
  IncarcarePagina,
  Meniu,
  StareEroare,
} from '@/ui'
import { ModalaCuloriProceduri } from '../nomenclator/ModalaCuloriProceduri'
import { ButonCalendar, PanouCalendar } from './CalendarMic'
import { FurnizorCulori, LegendaCulori } from './culoriExecutanti'
import { FurnizorCuloriProceduri } from './culoriProceduri'
import { DetaliuNotita } from './DetaliuNotita'
import { DetaliuProgramare } from './DetaliuProgramare'
import { dinZiua } from './elemente'
import { FormularNotita } from './FormularNotita'
import { FormularProgramare } from './FormularProgramare'
import { GrilaLuna } from './GrilaLuna'
import { GrilaOre, type ColoanaGrila, type LocGrila } from './GrilaOre'
import { ListaAgenda, rezumatZilei } from './ListaAgenda'
import { inceputPeZi, type LocAles } from './locAles'
import { ModalaProgramLucru } from './ModalaProgramLucru'
import { lucreaza, persoaneleZilei } from './programLucru'
import { numarProgramari } from './vizite'

/**
 * Calendarul (contract art. 3.1.B).
 *
 * Acoperă cele trei vederi cerute — zi, săptămână, lună — și agenda zilei
 * „pentru întreaga clinică sau pentru o singură persoană”: filtrul de executant
 * comută între cele două, fără un ecran separat.
 *
 * Pe telefon, săptămâna și luna devin liste cronologice. O grilă cu șapte
 * coloane pe 360px ar da coloane de 44px, în care nu încape nici măcar ora.
 * Ziua are grila ei „mare”: o coloană, blocuri colorate, text mare.
 */
export function PaginaProgramari() {
  const ecranMic = useEcranMic()
  const { esteAdministrator } = useAutentificare()

  const [vedere, setVedere] = useState<VedereCalendar>('saptamana')
  const [ancora, setAncora] = useState(() => new Date())
  const [calendarDeschis, setCalendarDeschis] = useState(false)

  const [executantId, setExecutantId] = useState<Uuid | null>(null)
  const [clientId, setClientId] = useState<Uuid | null>(null)
  /*
    Ședințele anulate nu se arată în calendar.

    O anulare înseamnă că ora aceea este liberă; lăsată pe ecran, ar arăta ca
    un interval ocupat și ar încurca tocmai când se caută un loc liber. Nu se
    șterge nimic: rândul rămâne în bază, se vede pe fișa clientului, iar aici
    se poate readuce oricând de pe butonul „Anulate”.
  */
  const [stariAscunse, setStariAscunse] = useState<Set<StareProgramare>>(
    () => new Set<StareProgramare>(['anulat']),
  )

  const [formularDeschis, setFormularDeschis] = useState(false)
  // Toate serviciile programării de modificat — formularul le arată pe toate.
  const [deModificat, setDeModificat] = useState<ProgramareDetaliu[] | null>(null)
  // Locul apăsat în calendar, cu care pornește o programare nouă.
  const [locAles, setLocAles] = useState<LocAles | null>(null)
  const [deVazut, setDeVazut] = useState<ProgramareDetaliu | null>(null)

  const [formularNotitaDeschis, setFormularNotitaDeschis] = useState(false)
  const [notitaDeModificat, setNotitaDeModificat] = useState<NotitaDetaliu | null>(null)
  const [notitaDeVazuta, setNotitaDeVazuta] = useState<NotitaDetaliu | null>(null)
  const [programLucruDeschis, setProgramLucruDeschis] = useState(false)
  const [culoriDeschise, setCuloriDeschise] = useState(false)
  // Pe telefon filtrele stau strânse: bara lor ocupa jumătate din ecran.
  const [filtreDeschise, setFiltreDeschise] = useState(false)

  const interval = useMemo(() => intervalPentruVedere(ancora, vedere), [ancora, vedere])

  // Programul de lucru al lunilor atinse de interval: ce zile sunt libere.
  const { data: programe } = useProgramLucru({
    de_la: laInputDate(interval.zile[0] ?? interval.inceput),
    pana_la: laInputDate(interval.zile[interval.zile.length - 1] ?? interval.sfarsit),
  })

  const stariVizibile = STARE_PROGRAMARE.filter((s) => !stariAscunse.has(s))

  const { data, isPending, error, refetch } = useProgramari({
    de_la: laTimestamptz(interval.inceput),
    pana_la: laTimestamptz(interval.sfarsit),
    ...(executantId ? { executant_id: executantId } : {}),
    ...(clientId ? { client_id: clientId } : {}),
    stare: stariVizibile,
  })

  /*
    Notițele vin pe același interval, în paralel cu programările.

    Filtrul de persoană le aduce pe ale ei ȘI pe cele ale clinicii — serverul
    știe regula. Filtrul de client le oprește de tot: „când mai vine doamna X?”
    nu are nevoie de „vine furnizorul”, iar starea programărilor nu le privește.
  */
  const { data: dateNotite } = useNotite(
    {
      de_la: laTimestamptz(interval.inceput),
      pana_la: laTimestamptz(interval.sfarsit),
      ...(executantId ? { executant_id: executantId } : {}),
    },
    clientId === null,
  )

  const programari = data ?? []
  const notite = clientId === null ? (dateNotite ?? []) : []

  // Serviciile programării deschise, din ce are deja calendarul: fereastra le
  // arată pe loc, fără să aștepte să le ceară din nou.
  const serviciiVazute = useMemo(
    () => (deVazut && data ? data.filter((p) => p.vizita_id === deVazut.vizita_id) : undefined),
    [deVazut, data],
  )

  // Coloanele pe persoană din vederea pe zi au nevoie de lista conturilor, care
  // este rută de administrator. Pentru ceilalți, ziua se afișează ca agendă —
  // exact forma cerută de contract pentru „o singură persoană”.
  const { data: utilizatori } = useUtilizatori({ activ: true }, esteAdministrator)

  // Culorile procedurilor: TOATE serviciile, active sau nu — programările vechi
  // ale unei proceduri scoase din nomenclator își păstrează culoarea.
  const { data: serviciiNomenclator } = useArticole({ tip: 'serviciu' })

  const deschideFormular = (servicii?: ProgramareDetaliu[]) => {
    setDeModificat(servicii ?? null)
    setLocAles(null)
    setFormularDeschis(true)
  }

  /*
    Programare nouă chiar din locul apăsat în calendar.

    Persoana vine din coloană (vederea pe zi), altfel din filtrul de persoană;
    clientul, din filtrul de client — cine caută „când mai vine doamna X?” și
    apasă pe un gol vrea să o programeze pe ea.
  */
  const programeazaLa = (inceput: Date, sfarsit: Date | null, executantColoana?: Uuid) => {
    setDeModificat(null)
    setLocAles({
      inceput,
      sfarsit,
      executantId: executantColoana ?? executantId,
      clientId,
    })
    setFormularDeschis(true)
  }

  const deschideFormularNotita = (notita?: NotitaDetaliu) => {
    setNotitaDeModificat(notita ?? null)
    setFormularNotitaDeschis(true)
  }

  const comutaStare = (stare: StareProgramare) => {
    setStariAscunse((precedente) => {
      const urmatoare = new Set(precedente)
      if (urmatoare.has(stare)) urmatoare.delete(stare)
      else urmatoare.add(stare)
      return urmatoare
    })
  }

  // Câte filtre sunt puse, pentru semnul de pe butonul „Filtre” al telefonului:
  // un filtru ascuns în panou și uitat pus ar face programările să pară dispărute.
  const stariSchimbate = stariAscunse.size !== 1 || !stariAscunse.has('anulat')
  const filtrePuse = Number(executantId !== null) + Number(clientId !== null) + Number(stariSchimbate)

  /*
    Filtrele, într-un singur loc: pe calculator stau în bara de sub navigare,
    pe telefon în panoul desfăcut de butonul „Filtre”. Același conținut, fără
    să fie scris de două ori.
  */
  const filtre = (
    <>
      {/*
        Legenda culorilor este și filtrul rapid pe persoană: o apăsare arată
        doar ședințele ei, încă una le aduce pe toate înapoi. Selectorul de
        mai jos rămâne — el caută și printre conturile fără culoare.
      */}
      <LegendaCulori valoare={executantId} onSchimba={setExecutantId} />
      <SelectorUtilizator
        valoare={executantId}
        onSchimba={setExecutantId}
        eticheta={null}
        placeholder="Toată clinica"
        cuGolire
        className="w-full sm:w-52"
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
        className="w-full sm:w-52"
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
    </>
  )

  return (
    // Culorile persoanelor se împart o singură dată, sus, ca fiecare chip din
    // calendar și fiecare rând din agendă să citească aceeași hartă.
    <FurnizorCulori utilizatori={utilizatori}>
    <FurnizorCuloriProceduri articole={serviciiNomenclator}>
    <Pagina className="flex h-full flex-col p-2 sm:p-4 lg:p-6">
      {/*
        Pe telefon marginile sunt mai mici (`p-2`) și antetul are două rânduri în
        loc de titlu + descriere + butoane + navigare + filtre: programările
        trebuie să ocupe ecranul, nu butoanele.
      */}
      {!ecranMic && (
        <AntetPagina
          titlu="Programări"
          descriere={eticheteInterval(interval.zile, vedere, ancora)}
          actiuni={
            <>
              {/*
                Culorile procedurilor: buton cu nume, la vedere, nu o pictogramă
                de ghicit. Pentru toate conturile — serverul lasă orice cont să
                schimbe culoarea unui serviciu (și numai ea).
              */}
              <Buton onClick={() => setCuloriDeschise(true)}>
                <Palette className="size-4" />
                Culori
              </Buton>
              {/*
                Notița stă lângă programare, dar în plan secund: se face de câteva
                ori pe săptămână, programarea de câteva ori pe oră.
              */}
              {/* Zilele pare / impare ale fiecăreia, pe lună. */}
              <Buton onClick={() => setProgramLucruDeschis(true)} aria-label="Program de lucru">
                <CalendarDays className="size-4" />
                <span className="hidden sm:inline">Program de lucru</span>
              </Buton>
              <Buton onClick={() => deschideFormularNotita()} aria-label="Notiță nouă">
                <StickyNote className="size-4" />
                <span className="hidden sm:inline">Notiță</span>
              </Buton>
              <Buton varianta="primar" onClick={() => deschideFormular()}>
                <CalendarPlus className="size-4" />
                Programare nouă
              </Buton>
            </>
          }
        />
      )}

      {/* Navigarea în timp; pe telefon, aici stă și „Adaugă”, ca să încapă pe un rând. */}
      <div className={cn('flex items-center gap-2', ecranMic ? 'mb-1.5' : 'mb-3 flex-wrap')}>
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

        {/*
          Saltul direct într-o zi. Săgețile mută cu un pas — o zi, o săptămână,
          o lună; pentru „15 octombrie” ar fi însemnat zeci de apăsări.
          Alegerea unei zile comută și pe vederea pe zi, la fel ca apăsarea unei
          zile din grila lunii: cine caută o dată anume vrea să o vadă întreagă.

          Pe telefon butonul poartă și intervalul („9 nov – 15 nov”): titlul și
          descrierea de sub el nu mai există, ca să nu mănânce un rând.
        */}
        <ButonCalendar
          valoare={ancora}
          eticheta={
            ecranMic ? eticheteInterval(interval.zile, vedere, ancora, true) : formateazaZiScurta(ancora)
          }
          deschis={calendarDeschis}
          onComuta={() => setCalendarDeschis((d) => !d)}
          {...(ecranMic ? { className: 'min-w-0 flex-1' } : {})}
        />

        {ecranMic ? (
          <Buton varianta="primar" dimensiune="sm" onClick={() => deschideFormular()}>
            <CalendarPlus className="size-4" />
            Adaugă
          </Buton>
        ) : (
          <ComutatorVedere vedere={vedere} onSchimba={setVedere} className="ml-auto" />
        )}
      </div>

      {ecranMic && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <ComutatorVedere vedere={vedere} onSchimba={setVedere} scurt />

          <div className="ml-auto flex items-center gap-1.5">
            <Buton dimensiune="sm" onClick={() => setCuloriDeschise(true)}>
              <Palette className="size-4" />
              Culori
            </Buton>
            <Buton
              dimensiune="sm"
              onClick={() => setFiltreDeschise((d) => !d)}
              aria-expanded={filtreDeschise}
              aria-controls="filtre-calendar"
              className={cn(filtreDeschise && 'bg-muted ring-line-strong')}
            >
              <SlidersHorizontal className="size-4" />
              Filtre
              {filtrePuse > 0 && <Contor valoare={filtrePuse} className="min-w-4 px-1" />}
            </Buton>
            {/* Acțiunile din plan secund, strânse sub un singur buton. */}
            <Meniu
              declansator={({ deschis, comuta }) => (
                <Buton
                  dimensiune="icon-sm"
                  onClick={comuta}
                  aria-label="Mai multe"
                  aria-haspopup="menu"
                  aria-expanded={deschis}
                >
                  <Ellipsis className="size-4" />
                </Buton>
              )}
            >
              <ElementMeniu
                pictograma={<StickyNote className="size-4" />}
                onClick={() => deschideFormularNotita()}
              >
                Notiță nouă
              </ElementMeniu>
              <ElementMeniu
                pictograma={<CalendarDays className="size-4" />}
                onClick={() => setProgramLucruDeschis(true)}
              >
                Program de lucru
              </ElementMeniu>
            </Meniu>
          </div>
        </div>
      )}

      {calendarDeschis && (
        <PanouCalendar
          valoare={ancora}
          onAlege={(zi) => {
            setAncora(zi)
            setVedere('zi')
            setCalendarDeschis(false)
          }}
        />
      )}

      {(!ecranMic || filtreDeschise) && (
        <BaraFiltre
          id="filtre-calendar"
          className={cn(ecranMic && 'mb-1.5 rounded-xl bg-surface p-2 ring-1 ring-line ring-inset')}
        >
          {filtre}
        </BaraFiltre>
      )}

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
            notite={notite}
            programe={programe ?? []}
            executantId={executantId}
            utilizatori={utilizatori ?? []}
            onAlegeProgramare={setDeVazut}
            onAlegeNotita={setNotitaDeVazuta}
            onAlegeZi={(zi) => {
              setAncora(zi)
              setVedere('zi')
            }}
            onProgrameaza={({ inceput, sfarsit, coloana }) =>
              programeazaLa(inceput, sfarsit, coloana.executantId)
            }
            onProgrameazaZi={(zi) => programeazaLa(inceputPeZi(zi), null)}
          />
        )}
      </Card>

      <FormularProgramare
        deschisa={formularDeschis}
        onInchide={() => setFormularDeschis(false)}
        programare={deModificat?.[0] ?? null}
        servicii={deModificat ?? undefined}
        loc={locAles}
      />

      <DetaliuProgramare
        programare={deVazut}
        cunoscute={serviciiVazute}
        onInchide={() => setDeVazut(null)}
        onModifica={(_programare, servicii) => {
          setDeVazut(null)
          deschideFormular(servicii)
        }}
      />

      <FormularNotita
        deschisa={formularNotitaDeschis}
        onInchide={() => setFormularNotitaDeschis(false)}
        notita={notitaDeModificat}
      />

      <DetaliuNotita
        notita={notitaDeVazuta}
        onInchide={() => setNotitaDeVazuta(null)}
        onModifica={(notita) => {
          setNotitaDeVazuta(null)
          deschideFormularNotita(notita)
        }}
      />

      <ModalaProgramLucru
        deschisa={programLucruDeschis}
        onInchide={() => setProgramLucruDeschis(false)}
        lunaInitiala={ancora}
        utilizatorInitial={executantId}
      />

      {culoriDeschise && (
        <ModalaCuloriProceduri onInchide={() => setCuloriDeschise(false)} />
      )}
    </Pagina>
    </FurnizorCuloriProceduri>
    </FurnizorCulori>
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
  notite,
  programe,
  executantId,
  utilizatori,
  onAlegeProgramare,
  onAlegeNotita,
  onAlegeZi,
  onProgrameaza,
  onProgrameazaZi,
}: {
  vedere: VedereCalendar
  ecranMic: boolean
  interval: { inceput: Date; sfarsit: Date; zile: Date[] }
  ancora: Date
  programari: ProgramareDetaliu[]
  notite: NotitaDetaliu[]
  /** Programul de lucru al lunilor afișate. */
  programe: ProgramLucru[]
  executantId: Uuid | null
  utilizatori: { id: Uuid; nume: string; rol: string }[]
  onAlegeProgramare: (programare: ProgramareDetaliu) => void
  onAlegeNotita: (notita: NotitaDetaliu) => void
  onAlegeZi: (zi: Date) => void
  /** Un loc liber apăsat pe grila orară: ora știută. */
  onProgrameaza: (loc: LocGrila) => void
  /** O zi apăsată fără oră (luna, agenda): ora o propune `inceputPeZi`. */
  onProgrameazaZi: (zi: Date) => void
}) {
  // Pe telefon, săptămâna și luna sunt liste; ziua are grila ei mare, mai jos.
  if (ecranMic && vedere !== 'zi') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ListaAgenda
          zile={interval.zile}
          programari={programari}
          notite={notite}
          programe={programe}
          onAlegeProgramare={onAlegeProgramare}
          onAlegeNotita={onAlegeNotita}
          onProgrameaza={onProgrameazaZi}
          // Antetul fiecărei zile deschide ziua aceea, singură, pe ore.
          onDeschideZiua={onAlegeZi}
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
          notite={notite}
          programe={programe}
          onAlegeZi={onAlegeZi}
          onAlegeProgramare={onAlegeProgramare}
          onAlegeNotita={onAlegeNotita}
          onProgrameaza={onProgrameazaZi}
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
      programari: dinZiua(programari, zi),
      notite: dinZiua(notite, zi),
      // Toată clinica: sub dată, cine lucrează și cine e liber. Filtrată pe o
      // persoană: ziua ei liberă se dungează.
      ...(executantId
        ? { libera: lucreaza(programe, executantId, zi) === false }
        : { persoaneZilei: persoaneleZilei(programe, zi) }),
    }))
    return (
      <GrilaOre
        coloane={coloane}
        onAlegeProgramare={onAlegeProgramare}
        onAlegeNotita={onAlegeNotita}
        onProgrameaza={onProgrameaza}
      />
    )
  }

  // Vederea pe zi: o coloană per persoană — agenda întregii clinici. Filtrată
  // pe un executant, rămâne o singură coloană: agenda acelei persoane.
  const zi = interval.zile[0]
  if (!zi) return null

  const aleZilei = dinZiua(programari, zi)
  const notiteZilei = dinZiua(notite, zi)

  /*
    Telefonul: ziua „mare” (cerința Corinei, 13 nov. 2026) — o singură coloană,
    toată ziua, pe ore, cu fiecare programare ca un bloc colorat cu text mare,
    ca în softul vechi. Coloanele pe persoane nu încap pe 360px; cine lucrează
    se vede sub dată, iar legenda și filtrul de persoană rămân în „Filtre”.
  */
  if (ecranMic) {
    return (
      <GrilaOre
        mare
        coloane={[
          {
            id: 'ziua',
            eticheta: capitalizeaza(formateazaZiLunga(zi)),
            subeticheta: rezumatZilei(numarProgramari(aleZilei), notiteZilei.length),
            zi,
            programari: aleZilei,
            notite: notiteZilei,
            ...(executantId
              ? { libera: lucreaza(programe, executantId, zi) === false }
              : { persoaneZilei: persoaneleZilei(programe, zi) }),
          },
        ]}
        onAlegeProgramare={onAlegeProgramare}
        onAlegeNotita={onAlegeNotita}
      />
    )
  }

  const notiteClinicii = notiteZilei.filter((n) => n.executant_id === null)

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
    subeticheta: `${numarProgramari(aleZilei.filter((p) => p.executant_id === persoana.id))} programări`,
    zi,
    // Programul de lucru: ziua ei liberă se dungează și scrie „Zi liberă”.
    libera: lucreaza(programe, persoana.id, zi) === false,
    executantId: persoana.id,
    programari: aleZilei.filter((p) => p.executant_id === persoana.id),
    // Filtrată pe o persoană, coloana ei primește și notițele clinicii — nu
    // mai există altă coloană care să le arate.
    notite: notiteZilei.filter(
      (n) => n.executant_id === persoana.id || (executantId !== null && n.executant_id === null),
    ),
  }))

  /*
    Notițele întregii clinici au coloana lor, prima, și numai când există.

    Puse în fiecare coloană de persoană, „vine furnizorul la 15” ar fi apărut
    de șase ori pe același rând. Într-o coloană permanentă, ar fi ocupat loc în
    zilele în care nu e nimic de spus — adică în cele mai multe.
  */
  if (executantId === null && notiteClinicii.length > 0) {
    coloane.unshift({
      id: 'clinica',
      eticheta: 'Toată clinica',
      subeticheta: `${notiteClinicii.length} ${notiteClinicii.length === 1 ? 'notiță' : 'notițe'}`,
      zi,
      programari: [],
      notite: notiteClinicii,
      doarNotite: true,
    })
  }

  if (coloane.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ListaAgenda
          zile={[zi]}
          programari={aleZilei}
          notite={notiteZilei}
          programe={programe}
          onAlegeProgramare={onAlegeProgramare}
          onAlegeNotita={onAlegeNotita}
          onProgrameaza={onProgrameazaZi}
        />
      </div>
    )
  }

  return (
    <GrilaOre
      coloane={coloane}
      onAlegeProgramare={onAlegeProgramare}
      onAlegeNotita={onAlegeNotita}
      onProgrameaza={onProgrameaza}
    />
  )
}

// ---------------------------------------------------------------------------
// Ajutătoare
// ---------------------------------------------------------------------------

function capitalizeaza(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function esteAcum(zile: Date[]): boolean {
  return zile.some((zi) => isToday(zi))
}

const ETICHETE_VEDERE: Record<VedereCalendar, { lunga: string; scurta: string }> = {
  zi: { lunga: 'Zi', scurta: 'Zi' },
  saptamana: { lunga: 'Săptămână', scurta: 'Săpt.' },
  luna: { lunga: 'Lună', scurta: 'Lună' },
}

/**
 * Zi / Săptămână / Lună. `scurt` strânge „Săptămână” în „Săpt.” pentru telefon;
 * numele întreg rămâne în `aria-label`, deci cititorul de ecran nu pierde nimic.
 */
function ComutatorVedere({
  vedere,
  onSchimba,
  scurt = false,
  className,
}: {
  vedere: VedereCalendar
  onSchimba: (vedere: VedereCalendar) => void
  scurt?: boolean
  className?: string
}) {
  return (
    <GrupButoane eticheta="Vedere calendar" {...(className ? { className } : {})}>
      {(['zi', 'saptamana', 'luna'] as VedereCalendar[]).map((v) => (
        <ButonGrup
          key={v}
          activ={vedere === v}
          onClick={() => onSchimba(v)}
          aria-label={ETICHETE_VEDERE[v].lunga}
          className={cn(scurt && 'px-2')}
        >
          {scurt ? ETICHETE_VEDERE[v].scurta : ETICHETE_VEDERE[v].lunga}
        </ButonGrup>
      ))}
    </GrupButoane>
  )
}

/**
 * Eticheta intervalului afișat, potrivită vederii. `scurt` pentru butonul de pe
 * telefon: ziua fără numele lunii întregi („12 nov”), nu „Joi, 12 noiembrie”.
 */
function eticheteInterval(
  zile: Date[],
  vedere: VedereCalendar,
  ancora: Date,
  scurt = false,
): string {
  if (vedere === 'zi') {
    return scurt
      ? formateazaZiScurta(zile[0] ?? ancora)
      : capitalizeaza(formateazaZiLunga(zile[0] ?? ancora))
  }
  if (vedere === 'luna') return capitalizeaza(formateazaLuna(ancora))
  const prima = zile[0]
  const ultima = zile[zile.length - 1]
  if (!prima || !ultima) return ''
  return `${formateazaZiScurta(prima)} – ${formateazaZiScurta(ultima)}`
}
