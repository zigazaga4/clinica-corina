import { useMemo, useState } from 'react'
import { Clock3, Receipt, ShoppingBag, Wallet } from 'lucide-react'
import type { FiltruVanzari } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useVanzari } from '@/app/queries'
import { BaraFiltre } from '@/components/Pagina'
import { InsemnPlata } from '@/components/insemne'
import { SelectorArticol, SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import type { Uuid, VanzareDetaliu } from '@/domain/types'
import {
  endOfDay,
  formateazaData,
  formateazaDataOra,
  formateazaOra,
  laData,
  laTimestamptz,
  startOfDay,
} from '@/lib/dates'
import { formateazaBani, sumaTotal } from '@/lib/money'
import { plural } from '@/lib/text'
import {
  Buton,
  ButonGrup,
  Card,
  CelulaDubla,
  GrupButoane,
  Input,
  Paginare,
  StareGoala,
  Statistica,
  Tabel,
  type Coloana,
} from '@/ui'
import { DetaliuVanzare } from './DetaliuVanzare'
import { FormularVanzare } from './FormularVanzare'

/**
 * Jurnalul încasărilor (art. 3.1.C — „ce s-a încasat, de la cine, când, de către cine”).
 *
 * Lista răspunde la o singură întrebare practică: cât s-a încasat, pe ce filtru.
 * De aceea rezumatul de sus și tabelul citesc ACELEAȘI filtre; un total calculat
 * peste altceva decât rândurile afișate ar fi imposibil de verificat la casă.
 *
 * A fost un ecran al lui, „Încasări”. Acum este o filă din Statistici, în
 * spatele parolei lor: lista tuturor banilor intrați ESTE o statistică — oricine
 * o vede adună singur cât a câștigat clinica. Serverul o păzește la fel
 * (`GET /vanzari` cere deblocarea); bonul unui client rămâne pe fișa lui.
 */

const PE_PAGINA = 25

/**
 * §7 nu prevede un endpoint de agregare, deci totalul se însumează din rânduri.
 * Peste această limită suma devine parțială și o spunem explicit, în loc să
 * afișăm o cifră mai mică decât realitatea fără nicio avertizare.
 */
const LIMITA_REZUMAT = 500

interface StareFiltre {
  client_id: Uuid | null
  operator_id: Uuid | null
  articol_id: Uuid | null
  /** Zile „YYYY-MM-DD”, cum le dă `<input type="date">`. */
  de_la: string
  pana_la: string
  /** null = toate; false = doar cele neachitate — „cine îmi datorează produse?”. */
  achitat: boolean | null
}

const FILTRE_GOALE: StareFiltre = {
  client_id: null,
  operator_id: null,
  articol_id: null,
  de_la: '',
  pana_la: '',
  achitat: null,
}

const FILTRE_PLATA: { valoare: boolean | null; eticheta: string }[] = [
  { valoare: null, eticheta: 'Toate' },
  { valoare: true, eticheta: 'Achitate' },
  { valoare: false, eticheta: 'Neachitate' },
]

export function ListaIncasari() {
  const [filtre, setFiltre] = useState<StareFiltre>(FILTRE_GOALE)
  const [pagina, setPagina] = useState(1)
  const [formular, setFormular] = useState<{ vanzare?: VanzareDetaliu } | null>(null)
  const [vanzareDeschisa, setVanzareDeschisa] = useState<VanzareDetaliu | null>(null)

  const filtruBaza = useMemo<FiltruVanzari>(
    () => ({
      ...(filtre.client_id ? { client_id: filtre.client_id } : {}),
      ...(filtre.operator_id ? { operator_id: filtre.operator_id } : {}),
      ...(filtre.articol_id ? { articol_id: filtre.articol_id } : {}),
      ...(filtre.de_la ? { de_la: laTimestamptz(startOfDay(laData(filtre.de_la))) } : {}),
      // Capătul de sus acoperă ziua ÎNTREAGĂ, până la 23:59:59.999. Cu miezul
      // nopții ca limită, tot ce s-a încasat după-amiaza în ultima zi aleasă ar
      // lipsi din listă — și nimeni nu ar bănui de ce nu se potrivesc totalurile.
      ...(filtre.pana_la ? { pana_la: laTimestamptz(endOfDay(laData(filtre.pana_la))) } : {}),
      ...(filtre.achitat === null ? {} : { achitat: filtre.achitat }),
    }),
    [filtre],
  )

  const lista = useVanzari({ ...filtruBaza, pagina, pe_pagina: PE_PAGINA })
  // A doua interogare, fără paginare, ține rezumatul: pagina curentă ar da
  // totalul a 25 de încasări, nu al filtrului.
  const rezumat = useVanzari({ ...filtruBaza, pagina: 1, pe_pagina: LIMITA_REZUMAT })

  const randuri = lista.data?.randuri ?? []
  const numar = lista.data?.total ?? 0
  const randuriRezumat = rezumat.data?.randuri ?? []
  // Încasat înseamnă bani intrați: vânzările neachitate își au rândul lor,
  // altfel casa de seară ar căuta bani care n-au venit încă.
  const total = sumaTotal(randuriRezumat.filter((v) => v.achitat).map((v) => v.total))
  const deIncasat = sumaTotal(randuriRezumat.filter((v) => !v.achitat).map((v) => v.total))
  const rezumatPartial = (rezumat.data?.total ?? 0) > randuriRezumat.length

  const areFiltre = useMemo(
    () => Object.values(filtre).some((valoare) => valoare !== null && valoare !== ''),
    [filtre],
  )

  const schimba = <C extends keyof StareFiltre>(camp: C, valoare: StareFiltre[C]) => {
    setFiltre((precedente) => ({ ...precedente, [camp]: valoare }))
    // Orice filtru nou repornește de la prima pagină: altfel lista rămâne pe
    // pagina 7 a unui rezultat care între timp are două.
    setPagina(1)
  }

  const goleste = () => {
    setFiltre(FILTRE_GOALE)
    setPagina(1)
  }

  const coloane: Coloana<VanzareDetaliu>[] = [
    {
      cheie: 'data',
      antet: 'Data',
      className: 'w-36 whitespace-nowrap',
      celula: (v) => (
        <CelulaDubla principal={formateazaData(v.efectuat_la)} secundar={formateazaOra(v.efectuat_la)} />
      ),
    },
    {
      cheie: 'client',
      antet: 'Client',
      celula: (v) => <span className="font-medium text-ink">{v.client_nume}</span>,
    },
    {
      cheie: 'articole',
      antet: 'Ce acoperă',
      celula: (v) => <span className="text-ink-soft">{descrieLinii(v)}</span>,
    },
    {
      cheie: 'operator',
      antet: 'Operator',
      // Locul rămas liber de coloana punctului de lucru îl ia operatorul: pe
      // ecranele medii era ascuns degeaba.
      ascunsaSub: 'lg',
      celula: (v) => <span className="text-ink-soft">{v.operator_nume}</span>,
    },
    {
      cheie: 'plata',
      antet: 'Plata',
      className: 'w-28',
      celula: (v) => <InsemnPlata achitat={v.achitat} />,
    },
    {
      cheie: 'total',
      antet: 'Total',
      laDreapta: true,
      className: 'w-32 font-medium whitespace-nowrap tabular-nums',
      celula: (v) => formateazaBani(v.total),
    },
  ]

  return (
    <>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-[13px] text-ink-faint">
          Ședințele achitate și produsele vândute — plătite sau rămase de plată — cu clientul,
          momentul și operatorul lor.
        </p>
        <Buton varianta="primar" onClick={() => setFormular({})} className="shrink-0">
          <ShoppingBag className="size-4" />
          Vinde produse
        </Buton>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-3">
        <Statistica
          eticheta="Încasări"
          valoare={numar}
          pictograma={<Receipt className="size-4" />}
          detaliu={areFiltre ? 'pe filtrele alese' : 'în total'}
        />
        <Statistica
          eticheta="Încasat"
          valoare={formateazaBani(total)}
          pictograma={<Wallet className="size-4" />}
          detaliu={rezumatPartial ? `primele ${LIMITA_REZUMAT} încasări` : undefined}
        />
        <Statistica
          eticheta="De încasat"
          valoare={formateazaBani(deIncasat)}
          pictograma={<Clock3 className="size-4" />}
          detaliu="produse neachitate"
        />
      </div>

      <BaraFiltre>
        <SelectorClient
          valoare={filtre.client_id}
          onSchimba={(id) => schimba('client_id', id)}
          cuGolire
          placeholder="Toți clienții"
          className="w-56"
        />
        <Input
          type="date"
          eticheta="De la"
          value={filtre.de_la}
          onChange={(e) => schimba('de_la', e.target.value)}
          containerClassName="w-40"
        />
        <Input
          type="date"
          eticheta="Până la"
          value={filtre.pana_la}
          onChange={(e) => schimba('pana_la', e.target.value)}
          containerClassName="w-40"
        />
        <SelectorUtilizator
          valoare={filtre.operator_id}
          onSchimba={(id) => schimba('operator_id', id)}
          eticheta="Operator"
          cuGolire
          placeholder="Toți operatorii"
          className="w-48"
        />
        <SelectorArticol
          valoare={filtre.articol_id}
          onSchimba={(id) => schimba('articol_id', id)}
          eticheta="Articol"
          cuGolire
          placeholder="Toate articolele"
          className="w-52"
        />
        <GrupButoane eticheta="Plata" className="mt-6">
          {FILTRE_PLATA.map((optiune) => (
            <ButonGrup
              key={optiune.eticheta}
              activ={filtre.achitat === optiune.valoare}
              onClick={() => schimba('achitat', optiune.valoare)}
              className="h-11 px-3 sm:h-8"
            >
              {optiune.eticheta}
            </ButonGrup>
          ))}
        </GrupButoane>
        {areFiltre && (
          <Buton varianta="discret" onClick={goleste} className="mt-6">
            Golește filtrele
          </Buton>
        )}
      </BaraFiltre>

      <Card className="overflow-hidden">
        <Tabel
          coloane={coloane}
          randuri={randuri}
          cheieRand={(v) => v.id}
          onRandClick={setVanzareDeschisa}
          incarca={lista.isFetching}
          eroare={lista.isError ? mesajEroare(lista.error) : null}
          onReincearca={() => void lista.refetch()}
          randMobil={(v) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{v.client_nume}</p>
                <p className="truncate text-[13px] text-ink-soft">{descrieLinii(v)}</p>
                <p className="mt-0.5 truncate text-[12px] text-ink-faint">
                  {formateazaDataOra(v.efectuat_la)} · {v.operator_nume}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold text-ink tabular-nums">
                  {formateazaBani(v.total)}
                </span>
                {!v.achitat && <InsemnPlata achitat={false} />}
              </div>
            </div>
          )}
          stareGoala={
            areFiltre ? (
              <StareGoala
                pictograma={<Receipt className="size-5" />}
                titlu="Nicio încasare pe filtrele alese"
                descriere="Datele există, dar niciuna nu se potrivește cu filtrele curente. Lărgește intervalul sau golește filtrele."
                actiune={{ eticheta: 'Golește filtrele', onClick: goleste }}
              />
            ) : (
              <StareGoala
                pictograma={<Receipt className="size-5" />}
                titlu="Nicio încasare înregistrată"
                descriere="Aici ajung ședințele achitate din programare și produsele vândute la recepție."
                actiune={{ eticheta: 'Vinde produse', onClick: () => setFormular({}) }}
              />
            )
          }
        />
        <Paginare
          pagina={lista.data?.pagina ?? pagina}
          pePagina={lista.data?.pe_pagina ?? PE_PAGINA}
          total={numar}
          onSchimba={setPagina}
        />
      </Card>

      {vanzareDeschisa && (
        <DetaliuVanzare
          vanzare={vanzareDeschisa}
          onInchide={() => setVanzareDeschisa(null)}
          onModifica={(v) => {
            setVanzareDeschisa(null)
            setFormular({ vanzare: v })
          }}
        />
      )}

      {/*
        Formularul se montează doar cât este deschis, iar cheia îl reface la
        trecerea de la o încasare la alta: starea liniilor pornește curată, fără
        un efect care să o resincronizeze la fiecare deschidere.
      */}
      {formular && (
        <FormularVanzare
          key={formular.vanzare?.id ?? 'noua'}
          vanzare={formular.vanzare}
          onInchide={() => setFormular(null)}
        />
      )}
    </>
  )
}

/**
 * „1 ședință și 2 produse” — ce a acoperit plata, într-o singură celulă.
 *
 * Denumirile articolelor nu încap pe un rând de tabel, iar ce se verifică la
 * casă este altceva: dacă banii au stins ședințe sau au plătit marfă. Linia cu
 * `programare_id` este o ședință; restul sunt produse vândute la recepție.
 */
function descrieLinii(vanzare: VanzareDetaliu): string {
  const sedinte = vanzare.linii.filter((l) => l.programare_id !== null).length
  const produse = vanzare.linii.length - sedinte

  const parti: string[] = []
  if (sedinte > 0) parti.push(`${sedinte} ${plural(sedinte, 'ședință', 'ședințe')}`)
  if (produse > 0) parti.push(`${produse} ${plural(produse, 'produs', 'produse')}`)

  return parti.length > 0 ? parti.join(' și ') : '—'
}
