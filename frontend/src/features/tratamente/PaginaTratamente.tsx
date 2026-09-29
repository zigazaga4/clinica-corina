import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Layers, Plus, Wallet } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import type { FiltruTratamente } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useTratament, useTratamente } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { SelectorClient } from '@/components/selectoare'
import type { ProgramareDetaliu, TratamentDetaliu, Uuid } from '@/domain/types'
import { DetaliuProgramare } from '@/features/programari/DetaliuProgramare'
import { FormularProgramare, type ProgramareInitiala } from '@/features/programari/FormularProgramare'
import { formateazaData, formateazaDataOra } from '@/lib/dates'
import { useIntarziat } from '@/lib/hooks'
import { formateazaBani, sumaTotal } from '@/lib/money'
import { plural } from '@/lib/text'
import {
  Buton,
  CampCautare,
  Card,
  File,
  Paginare,
  StareGoala,
  Statistica,
  Tabel,
  type Coloana,
  type Fila,
} from '@/ui'
import { DetaliuTratament } from './DetaliuTratament'
import { FormularTratament } from './FormularTratament'
import { BaniTratament, InsemnTratament, ProgresSedinte } from './ProgresTratament'

/**
 * Tratamentele — serviciile care se fac în mai multe ședințe.
 *
 * Ecranul răspunde la o singură întrebare a recepției: „unde a ajuns fiecare
 * client cu ce a cumpărat, și pe cine trebuie să sun?”. De aceea cele în curs
 * fără nicio ședință programată stau primele, iar butonul de pe rând este
 * chiar „Programează”: ședința următoare se face de aici, cu clientul și
 * serviciul deja alese.
 *
 * Nimic din ce se vede nu se ține de mână: câte ședințe s-au făcut, cât s-a
 * încasat și cât mai e de plată se numără din programări, pe server.
 */

const PE_PAGINA = 25

type FilaTratamente = 'in_curs' | 'incheiate' | 'toate'

const FILE: Fila<FilaTratamente>[] = [
  { valoare: 'in_curs', eticheta: 'În curs' },
  { valoare: 'incheiate', eticheta: 'Încheiate' },
  { valoare: 'toate', eticheta: 'Toate' },
]

export function PaginaTratamente() {
  /*
    Adresa poate cere ceva: `?client=` filtrează pe un client (de pe fișa
    lui), `?tratament=` deschide o fișă (din detaliul unei ședințe). Ambele se
    citesc o dată, la sosire.
  */
  const [parametri, setParametri] = useSearchParams()

  const [fila, setFila] = useState<FilaTratamente>(parametri.get('client') ? 'toate' : 'in_curs')
  const [clientId, setClientId] = useState<Uuid | null>(parametri.get('client'))
  const [cautare, setCautare] = useState('')
  const cautareIntarziata = useIntarziat(cautare.trim())
  const [pagina, setPagina] = useState(1)

  const [tratamentDeschis, setTratamentDeschis] = useState<TratamentDetaliu | null>(null)
  const [formularTratament, setFormularTratament] = useState<{ tratament: TratamentDetaliu | null } | null>(null)
  const [programareDeschisa, setProgramareDeschisa] = useState<ProgramareDetaliu | null>(null)
  const [formularProgramare, setFormularProgramare] = useState<{
    programare?: ProgramareDetaliu
    /** Toate serviciile programării de modificat — ședința poate avea tovarăși. */
    servicii?: ProgramareDetaliu[]
    initial?: ProgramareInitiala
  } | null>(null)

  const filtru = useMemo<FiltruTratamente>(
    () => ({
      ...(fila === 'toate' ? {} : { in_curs: fila === 'in_curs' }),
      ...(clientId ? { client_id: clientId } : {}),
      ...(cautareIntarziata ? { q: cautareIntarziata } : {}),
      pagina,
      pe_pagina: PE_PAGINA,
    }),
    [fila, clientId, cautareIntarziata, pagina],
  )
  const lista = useTratamente(filtru)
  const randuri = lista.data?.randuri ?? []

  /*
    Deschis dintr-un link — „Ședința 3 din 8 →” din detaliul programării.
    Rândul se cere separat, ca să meargă și când nu e pe pagina curentă a
    listei; parametrul se scoate din adresă odată consumat, ca înapoi-ul să
    nu redeschidă fereastra.
  */
  const idCerut = parametri.get('tratament')
  const cerut = useTratament(idCerut)
  useEffect(() => {
    if (!idCerut || !cerut.data) return
    setTratamentDeschis(cerut.data)
    setParametri({}, { replace: true })
  }, [idCerut, cerut.data, setParametri])

  // Fereastra deschisă ține o copie luată la clic; după o mutație, lista vine
  // reîncărcată și copia se împrospătează din ea, ca „3/8” să devină „4/8”
  // fără să se închidă și redeschidă fereastra.
  useEffect(() => {
    if (!tratamentDeschis) return
    const proaspat = randuri.find((t) => t.id === tratamentDeschis.id)
    if (proaspat && proaspat !== tratamentDeschis) setTratamentDeschis(proaspat)
  }, [randuri, tratamentDeschis])

  const inCurs = randuri.filter((t) => t.incheiat_la === null)
  const deIncasat = sumaTotal(inCurs.map((t) => t.de_incasat))
  const deSunat = inCurs.filter((t) => t.urmatoarea_la === null && t.sedinte_ramase > 0).length

  const areFiltre = clientId !== null || cautareIntarziata !== ''
  const goleste = () => {
    setClientId(null)
    setCautare('')
    setPagina(1)
  }

  const programeaza = (t: TratamentDetaliu) => {
    setTratamentDeschis(null)
    setFormularProgramare({
      initial: { client_id: t.client_id, articol_id: t.articol_id, tratament_id: t.id },
    })
  }

  const coloane: Coloana<TratamentDetaliu>[] = [
    {
      cheie: 'client',
      antet: 'Client',
      celula: (t) => (
        <span className="block">
          <span className="block font-medium text-ink">{t.client_nume}</span>
          <span className="block truncate text-[12px] text-ink-soft">{t.articol_denumire}</span>
        </span>
      ),
    },
    {
      cheie: 'sedinte',
      antet: 'Ședințe',
      className: 'w-52',
      celula: (t) => <ProgresSedinte tratament={t} />,
    },
    {
      cheie: 'bani',
      antet: 'Încasat',
      className: 'w-40 whitespace-nowrap',
      celula: (t) => <BaniTratament tratament={t} />,
    },
    {
      cheie: 'urmatoarea',
      antet: 'Următoarea ședință',
      ascunsaSub: 'md',
      className: 'w-44 whitespace-nowrap',
      celula: (t) =>
        t.urmatoarea_la ? (
          <span className="text-ink-soft tabular-nums">{formateazaDataOra(t.urmatoarea_la)}</span>
        ) : t.incheiat_la !== null ? (
          <span className="text-ink-faint">încheiat {formateazaData(t.incheiat_la)}</span>
        ) : t.sedinte_ramase > 0 ? (
          <span className="font-medium text-warning">neprogramată</span>
        ) : (
          <span className="text-ink-faint">toate programate</span>
        ),
    },
    {
      cheie: 'stare',
      antet: 'Stare',
      className: 'w-28',
      celula: (t) => <InsemnTratament tratament={t} />,
    },
    {
      cheie: 'actiuni',
      antet: '',
      laDreapta: true,
      className: 'w-36',
      celula: (t) =>
        t.incheiat_la === null && t.sedinte_ramase > 0 ? (
          <Buton
            dimensiune="sm"
            varianta="primar"
            onClick={(e) => {
              // Butonul stă pe un rând care se deschide la clic: fără oprire,
              // s-ar deschide și fișa, peste formular.
              e.stopPropagation()
              programeaza(t)
            }}
          >
            <CalendarPlus className="size-4" />
            Programează
          </Buton>
        ) : null,
    },
  ]

  return (
    <Pagina>
      <AntetPagina
        titlu="Tratamente"
        descriere="Serviciile care se fac în mai multe ședințe: unde a ajuns fiecare client și ce mai are de plătit."
        actiuni={
          <Buton varianta="primar" onClick={() => setFormularTratament({ tratament: null })}>
            <Plus className="size-4" />
            Tratament nou
          </Buton>
        }
      />

      <div className="mb-3 grid grid-cols-3 gap-3 sm:max-w-2xl">
        <Statistica
          eticheta="În curs"
          valoare={fila === 'in_curs' ? (lista.data?.total ?? 0) : inCurs.length}
          pictograma={<Layers className="size-4" />}
          detaliu={areFiltre ? 'pe filtrele alese' : undefined}
        />
        <Statistica
          eticheta="De sunat"
          valoare={deSunat}
          pictograma={<CalendarPlus className="size-4" />}
          detaliu={`fără ${plural(deSunat, 'ședință', 'ședințe')} programată`}
        />
        <Statistica
          eticheta="De încasat"
          valoare={formateazaBani(deIncasat)}
          pictograma={<Wallet className="size-4" />}
          detaliu="din tratamentele afișate"
        />
      </div>

      <BaraFiltre>
        <File
          file={FILE}
          activa={fila}
          onSchimba={(f) => {
            setFila(f)
            setPagina(1)
          }}
        />
        <CampCautare
          valoare={cautare}
          onSchimba={(v) => {
            setCautare(v)
            setPagina(1)
          }}
          placeholder="Client sau serviciu…"
          aria-label="Caută tratamente"
          containerClassName="w-56"
        />
        <SelectorClient
          valoare={clientId}
          onSchimba={(id) => {
            setClientId(id)
            setPagina(1)
          }}
          cuGolire
          placeholder="Toți clienții"
          className="w-56"
        />
        {areFiltre && (
          <Buton varianta="discret" onClick={goleste}>
            Golește filtrele
          </Buton>
        )}
      </BaraFiltre>

      <Card className="overflow-hidden">
        <Tabel
          coloane={coloane}
          randuri={randuri}
          cheieRand={(t) => t.id}
          onRandClick={setTratamentDeschis}
          incarca={lista.isFetching}
          eroare={lista.isError ? mesajEroare(lista.error) : null}
          onReincearca={() => void lista.refetch()}
          randMobil={(t) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{t.client_nume}</p>
                  <p className="truncate text-[12px] text-ink-soft">{t.articol_denumire}</p>
                </div>
                <InsemnTratament tratament={t} />
              </div>
              <ProgresSedinte tratament={t} />
              <div className="flex items-end justify-between gap-3">
                <BaniTratament tratament={t} />
                {t.incheiat_la === null && t.sedinte_ramase > 0 && (
                  <Buton
                    dimensiune="sm"
                    varianta="primar"
                    onClick={(e) => {
                      e.stopPropagation()
                      programeaza(t)
                    }}
                  >
                    <CalendarPlus className="size-4" />
                    Programează
                  </Buton>
                )}
              </div>
            </div>
          )}
          stareGoala={
            areFiltre || fila !== 'in_curs' ? (
              <StareGoala
                pictograma={<Layers className="size-5" />}
                titlu="Niciun tratament pe filtrele alese"
                descriere="Lărgește căutarea sau schimbă fila."
                actiune={areFiltre ? { eticheta: 'Golește filtrele', onClick: goleste } : undefined}
              />
            ) : (
              <StareGoala
                pictograma={<Layers className="size-5" />}
                titlu="Niciun tratament în curs"
                descriere="Un tratament se deschide singur la prima programare a unui serviciu care se face în mai multe ședințe — numărul lor se setează în Nomenclator."
                actiune={{ eticheta: 'Tratament nou', onClick: () => setFormularTratament({ tratament: null }) }}
              />
            )
          }
        />
        <Paginare
          pagina={lista.data?.pagina ?? pagina}
          pePagina={lista.data?.pe_pagina ?? PE_PAGINA}
          total={lista.data?.total ?? 0}
          onSchimba={setPagina}
        />
      </Card>

      {tratamentDeschis && (
        <DetaliuTratament
          tratament={tratamentDeschis}
          onInchide={() => setTratamentDeschis(null)}
          onProgrameaza={programeaza}
          onModifica={(t) => {
            setTratamentDeschis(null)
            setFormularTratament({ tratament: t })
          }}
          onDeschideSedinta={setProgramareDeschisa}
        />
      )}

      {formularTratament && (
        <FormularTratament
          key={formularTratament.tratament?.id ?? 'nou'}
          tratament={formularTratament.tratament}
          onInchide={() => setFormularTratament(null)}
        />
      )}

      {/*
        Ședința se deschide PESTE fișa tratamentului: de acolo se marchează
        onorată sau se încasează, apoi se revine la fișă cu contoarele
        împrospătate.
      */}
      <DetaliuProgramare
        programare={programareDeschisa}
        onInchide={() => setProgramareDeschisa(null)}
        onModifica={(p, servicii) => {
          setProgramareDeschisa(null)
          setFormularProgramare({ programare: p, servicii })
        }}
      />

      <FormularProgramare
        deschisa={formularProgramare !== null}
        onInchide={() => setFormularProgramare(null)}
        programare={formularProgramare?.programare ?? null}
        servicii={formularProgramare?.servicii}
        initial={formularProgramare?.initial ?? null}
      />
    </Pagina>
  )
}
