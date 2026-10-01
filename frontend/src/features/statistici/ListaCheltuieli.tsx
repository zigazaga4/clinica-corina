import { useMemo, useState } from 'react'
import { Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import type { FiltruCheltuieli } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useCategoriiCheltuieli, useCheltuieli } from '@/app/queries'
import { BaraFiltre } from '@/components/Pagina'
import type { CheltuialaDetaliu } from '@/domain/types'
import { formateazaData } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { plural } from '@/lib/text'
import { Buton, ButonRand, Card, Paginare, Select, StareGoala, Tabel, type Coloana } from '@/ui'
import { AlegerePerioadei } from './AlegerePerioadei'
import { FormularCheltuiala } from './FormularCheltuiala'
import type { AlegerePerioada, PerioadaCalculata } from './perioade'

const PE_PAGINA = 25

/**
 * Fila „Cheltuieli”: banii ieșiți în perioada aleasă — aceeași perioadă ca în
 * rezumat, ca suma de aici să fie exact cea scăzută acolo din profit.
 */
export function ListaCheltuieli({
  alegere,
  onAlegere,
  calculata,
}: {
  alegere: AlegerePerioada
  onAlegere: (alegere: AlegerePerioada) => void
  calculata: PerioadaCalculata
}) {
  const [categorie, setCategorie] = useState('')
  const [pagina, setPagina] = useState(1)
  const [formular, setFormular] = useState<{
    cheltuiala?: CheltuialaDetaliu
    doarStergere?: boolean
  } | null>(null)

  /** Modifică + Șterge, pe fiecare rând. */
  const actiuni = (c: CheltuialaDetaliu) => (
    <div className="flex items-center justify-end gap-1">
      <ButonRand
        varianta="discret"
        dimensiune="icon-sm"
        onClick={() => setFormular({ cheltuiala: c })}
        aria-label={`Modifică cheltuiala ${c.categorie}`}
        title="Modifică"
      >
        <Pencil className="size-4" />
      </ButonRand>
      <ButonRand
        varianta="discret"
        dimensiune="icon-sm"
        onClick={() => setFormular({ cheltuiala: c, doarStergere: true })}
        className="text-danger hover:text-danger"
        aria-label={`Șterge cheltuiala ${c.categorie}`}
        title="Șterge"
      >
        <Trash2 className="size-4" />
      </ButonRand>
    </div>
  )

  const filtru = useMemo<FiltruCheltuieli>(
    () => ({
      de_la: calculata.perioada.de_la,
      pana_la: calculata.perioada.pana_la,
      ...(categorie ? { categorie } : {}),
      pagina,
      pe_pagina: PE_PAGINA,
    }),
    [calculata, categorie, pagina],
  )
  const lista = useCheltuieli(filtru)
  const categorii = useCategoriiCheltuieli()

  const randuri = lista.data?.randuri ?? []
  const total = lista.data?.total ?? 0

  const coloane: Coloana<CheltuialaDetaliu>[] = [
    {
      cheie: 'data',
      antet: 'Data',
      className: 'w-32 whitespace-nowrap',
      celula: (c) => formateazaData(c.data),
    },
    {
      cheie: 'categorie',
      antet: 'Categoria',
      celula: (c) => <span className="font-medium text-ink">{c.categorie}</span>,
    },
    {
      cheie: 'descriere',
      antet: 'Descriere',
      ascunsaSub: 'md',
      celula: (c) => <span className="text-ink-soft">{c.descriere ?? '—'}</span>,
    },
    {
      cheie: 'creat_de',
      antet: 'Scrisă de',
      ascunsaSub: 'lg',
      celula: (c) => <span className="text-ink-soft">{c.creat_de_nume ?? '—'}</span>,
    },
    {
      cheie: 'suma',
      antet: 'Suma',
      laDreapta: true,
      className: 'w-36 font-medium whitespace-nowrap tabular-nums',
      celula: (c) => formateazaBani(c.suma),
    },
    {
      cheie: 'actiuni',
      antet: <span className="sr-only">Acțiuni</span>,
      className: 'w-24',
      celula: actiuni,
    },
  ]

  return (
    <>
      <BaraFiltre className="items-end">
        <AlegerePerioadei
          alegere={alegere}
          onSchimba={(a) => {
            onAlegere(a)
            setPagina(1)
          }}
        />
        <Select
          eticheta="Categoria"
          value={categorie}
          onChange={(e) => {
            setCategorie(e.target.value)
            setPagina(1)
          }}
          containerClassName="w-52 self-start"
        >
          <option value="">Toate categoriile</option>
          {(categorii.data ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Buton varianta="primar" onClick={() => setFormular({})} className="self-start sm:mt-6">
          <Plus className="size-4" />
          Adaugă cheltuială
        </Buton>
      </BaraFiltre>

      <p className="mb-3 text-[13px] text-ink-soft">
        {total} {plural(total, 'cheltuială', 'cheltuieli')} ·{' '}
        <span className="font-semibold text-ink">{formateazaBani(lista.data?.suma ?? 0)}</span>
      </p>

      <Card className="overflow-hidden">
        <Tabel
          coloane={coloane}
          randuri={randuri}
          cheieRand={(c) => c.id}
          onRandClick={(c) => setFormular({ cheltuiala: c })}
          incarca={lista.isFetching}
          eroare={lista.isError ? mesajEroare(lista.error) : null}
          onReincearca={() => void lista.refetch()}
          actiuneMobil={actiuni}
          randMobil={(c) => (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{c.categorie}</p>
                {c.descriere && <p className="truncate text-[13px] text-ink-soft">{c.descriere}</p>}
                <p className="mt-0.5 text-[12px] text-ink-faint">{formateazaData(c.data)}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
                {formateazaBani(c.suma)}
              </span>
            </div>
          )}
          stareGoala={
            <StareGoala
              pictograma={<Receipt className="size-5" />}
              titlu={categorie ? 'Nicio cheltuială în această categorie' : 'Nicio cheltuială în perioada aleasă'}
              descriere="Chiria, salariile, consumabilele, marfa — tot ce iese din clinică. Se scad din încasări, ca profitul să fie cel adevărat."
              actiune={{ eticheta: 'Adaugă cheltuială', onClick: () => setFormular({}) }}
            />
          }
        />
        <Paginare
          pagina={lista.data?.pagina ?? pagina}
          pePagina={lista.data?.pe_pagina ?? PE_PAGINA}
          total={total}
          onSchimba={setPagina}
        />
      </Card>

      {/* Montat doar cât e deschis; cheia îl reface de la o cheltuială la alta. */}
      {formular && (
        <FormularCheltuiala
          key={`${formular.cheltuiala?.id ?? 'noua'}-${formular.doarStergere ? 'sterge' : 'scrie'}`}
          cheltuiala={formular.cheltuiala}
          doarStergere={formular.doarStergere}
          onInchide={() => setFormular(null)}
        />
      )}
    </>
  )
}
