import { useMemo, useState } from 'react'
import { FilterX, ScrollText } from 'lucide-react'
import type { FiltruJurnal } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useJurnal } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { InsemnActiuneJurnal } from '@/components/insemne'
import { SelectorUtilizator } from '@/components/selectoare'
import { etichetaActiuneJurnal, etichetaEntitate, numeEntitate } from '@/domain/labels'
import {
  ACTIUNE_JURNAL,
  type ActiuneJurnal,
  type JurnalOperatiuneDetaliu,
  type Uuid,
} from '@/domain/types'
import { endOfDay, formateazaDataOra, laData, laTimestamptz, startOfDay } from '@/lib/dates'
import {
  Buton,
  ButonGrup,
  Card,
  GrupButoane,
  Input,
  Paginare,
  Select,
  StareGoala,
  Tabel,
  type Coloana,
} from '@/ui'
import { rezumatSchimbare } from './campuri'
import { ModalaDetaliuJurnal } from './ModalaDetaliuJurnal'

/**
 * Jurnalul operațiunilor (art. 3.1.D — „jurnal al operațiunilor asupra
 * datelor, cu utilizatorul și momentul efectuării”).
 *
 * Ecranul este exclusiv de citire, în toate componentele lui: tabela
 * `jurnal_operatiuni` este append-only (§3), fără UPDATE și fără DELETE. Un
 * jurnal care s-ar putea corecta nu ar mai proba nimic, așa că aici nu există
 * și nu trebuie adăugată nicio acțiune de modificare sau de ștergere — nici
 * măcar pentru intrările evident greșite.
 */

/** Jurnalul crește cu fiecare operațiune din clinică; paginile mici l-ar face de nerăsfoit. */
const PE_PAGINA = 50

const ENTITATI = Object.entries(etichetaEntitate).sort((a, b) => a[1].localeCompare(b[1], 'ro'))

export function PaginaJurnal() {
  const [entitate, setEntitate] = useState('')
  const [actiuni, setActiuni] = useState<ActiuneJurnal[]>([])
  const [utilizatorId, setUtilizatorId] = useState<Uuid | null>(null)
  const [deLa, setDeLa] = useState('')
  const [panaLa, setPanaLa] = useState('')
  const [pagina, setPagina] = useState(1)

  const [selectata, setSelectata] = useState<JurnalOperatiuneDetaliu | null>(null)

  const filtru = useMemo<FiltruJurnal>(
    () => ({
      pagina,
      pe_pagina: PE_PAGINA,
      ...(entitate === '' ? {} : { entitate }),
      ...(utilizatorId === null ? {} : { utilizator_id: utilizatorId }),
      ...(actiuni.length === 0 ? {} : { actiune: actiuni }),
      // Capătul de jos începe la 00:00, cel de sus se închide la ultima
      // milisecundă a zilei alese: cu un `pana_la` la miezul nopții, tot ce s-a
      // întâmplat în după-amiaza ultimei zile ar cădea în afara intervalului.
      ...(deLa === '' ? {} : { de_la: laTimestamptz(startOfDay(laData(deLa))) }),
      ...(panaLa === '' ? {} : { pana_la: laTimestamptz(endOfDay(laData(panaLa))) }),
    }),
    [pagina, entitate, utilizatorId, actiuni, deLa, panaLa],
  )

  const { data, isPending, isFetching, error, refetch } = useJurnal(filtru)

  const randuri = data?.randuri ?? []
  const areFiltre =
    entitate !== '' || actiuni.length > 0 || utilizatorId !== null || deLa !== '' || panaLa !== ''

  const golesteFiltrele = () => {
    setEntitate('')
    setActiuni([])
    setUtilizatorId(null)
    setDeLa('')
    setPanaLa('')
    setPagina(1)
  }

  // Orice schimbare de filtru readuce pe prima pagină: altfel o filtrare mai
  // strictă ar lăsa ecranul pe o pagină care nu mai există, adică gol.
  const comutaActiune = (actiune: ActiuneJurnal) => {
    setActiuni((curente) =>
      curente.includes(actiune) ? curente.filter((a) => a !== actiune) : [...curente, actiune],
    )
    setPagina(1)
  }

  const coloane: Coloana<JurnalOperatiuneDetaliu>[] = [
    {
      cheie: 'moment',
      antet: 'Moment',
      celula: (j) => <span className="tabular-nums">{formateazaDataOra(j.creat_la)}</span>,
      className: 'w-44 whitespace-nowrap',
    },
    {
      cheie: 'utilizator',
      antet: 'Utilizator',
      celula: (j) =>
        j.utilizator_nume ?? <span className="text-ink-faint">Cont șters</span>,
      className: 'w-48',
    },
    {
      cheie: 'actiune',
      antet: 'Acțiune',
      celula: (j) => <InsemnActiuneJurnal actiune={j.actiune} />,
      className: 'w-36',
    },
    {
      cheie: 'entitate',
      antet: 'Entitate',
      celula: (j) => numeEntitate(j.entitate),
      className: 'w-40',
      ascunsaSub: 'md',
    },
    {
      cheie: 'rezumat',
      antet: 'Ce s-a schimbat',
      celula: (j) => <span className="text-ink-soft">{rezumatSchimbare(j)}</span>,
      ascunsaSub: 'lg',
    },
  ]

  return (
    <Pagina>
      <AntetPagina
        titlu="Jurnal operațiuni"
        descriere="Cine a operat, ce a schimbat și când. Jurnalul se poate doar citi: intrările nu se modifică și nu se șterg."
      />

      {/*
        Selectorul de persoană stă lângă bara de filtre, nu în ea: panoul lui se
        deschide sub câmp, iar derularea orizontală a barei l-ar tăia.
      */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SelectorUtilizator
          valoare={utilizatorId}
          onSchimba={(id) => {
            setUtilizatorId(id)
            setPagina(1)
          }}
          eticheta=""
          placeholder="Toți utilizatorii"
          cuGolire
          className="w-full shrink-0 sm:w-52"
        />

        <BaraFiltre className="mb-0 min-w-0 flex-1">
          <Select
            value={entitate}
            onChange={(e) => {
              setEntitate(e.target.value)
              setPagina(1)
            }}
            aria-label="Filtrează după entitate"
            containerClassName="w-44"
          >
            <option value="">Toate entitățile</option>
            {ENTITATI.map(([valoare, eticheta]) => (
              <option key={valoare} value={valoare}>
                {eticheta}
              </option>
            ))}
          </Select>

          <GrupButoane eticheta="Filtrează după acțiune">
            {ACTIUNE_JURNAL.map((actiune) => (
              <ButonGrup
                key={actiune}
                activ={actiuni.includes(actiune)}
                onClick={() => comutaActiune(actiune)}
              >
                {etichetaActiuneJurnal[actiune]}
              </ButonGrup>
            ))}
          </GrupButoane>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={deLa}
              max={panaLa || undefined}
              onChange={(e) => {
                setDeLa(e.target.value)
                setPagina(1)
              }}
              aria-label="Începutul intervalului"
              containerClassName="w-40"
            />
            <span className="text-ink-faint" aria-hidden>
              –
            </span>
            <Input
              type="date"
              value={panaLa}
              min={deLa || undefined}
              onChange={(e) => {
                setPanaLa(e.target.value)
                setPagina(1)
              }}
              aria-label="Sfârșitul intervalului"
              containerClassName="w-40"
            />
          </div>

          {areFiltre && (
            <Buton varianta="discret" onClick={golesteFiltrele}>
              <FilterX className="size-4" />
              Golește filtrele
            </Buton>
          )}
        </BaraFiltre>
      </div>

      <Card className="overflow-hidden">
        <Tabel
          coloane={coloane}
          randuri={randuri}
          cheieRand={(j) => String(j.id)}
          incarca={isPending || isFetching}
          eroare={error ? mesajEroare(error) : null}
          onReincearca={() => void refetch()}
          onRandClick={setSelectata}
          randuriSchelet={10}
          randMobil={(j) => (
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink-faint tabular-nums">
                  {formateazaDataOra(j.creat_la)}
                </span>
                <InsemnActiuneJurnal actiune={j.actiune} />
              </div>
              <p className="mt-1 truncate text-sm font-medium text-ink">
                {numeEntitate(j.entitate)} · {j.utilizator_nume ?? 'Cont șters'}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-ink-faint">{rezumatSchimbare(j)}</p>
            </div>
          )}
          stareGoala={
            areFiltre ? (
              <StareGoala
                pictograma={<ScrollText className="size-5" />}
                titlu="Nicio operațiune"
                descriere="Niciun rând nu corespunde filtrelor alese. Încearcă un interval mai larg."
                actiune={{ eticheta: 'Golește filtrele', onClick: golesteFiltrele }}
              />
            ) : (
              <StareGoala
                pictograma={<ScrollText className="size-5" />}
                titlu="Jurnalul este gol"
                descriere="Operațiunile asupra datelor se înregistrează aici pe măsură ce sunt efectuate."
              />
            )
          }
        />

        <Paginare
          pagina={data?.pagina ?? pagina}
          pePagina={data?.pe_pagina ?? PE_PAGINA}
          total={data?.total ?? 0}
          onSchimba={setPagina}
        />
      </Card>

      {selectata && (
        <ModalaDetaliuJurnal intrare={selectata} onInchide={() => setSelectata(null)} />
      )}
    </Pagina>
  )
}
