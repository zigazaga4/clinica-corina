import type { ReactNode } from 'react'
import { InsemnInactiv } from '@/components/insemne'
import type { Articol, TipArticol } from '@/domain/types'
import { formateazaDurata } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { Badge, CelulaDubla, Tabel, type Coloana } from '@/ui'

/*
  Listele nomenclatorului.

  Serviciile și produsele sunt același tabel — `articol` este un nomenclator
  unic, discriminat prin `tip` — și diferă doar prin coloana de durată, pe care
  produsele nu o au (articol_durata_ck). O singură componentă pentru amândouă
  ține cele două file identice la formatare, la ordinea coloanelor și la forma
  cardului de pe telefon.
*/

interface ProprietatiLista<T> {
  randuri: T[]
  incarca: boolean
  eroare: string | null
  onReincearca: () => void
  /** Lipsește pentru cine nu are drept de modificare — rândurile devin inerte. */
  onDeschide?: (rand: T) => void
  stareGoala: ReactNode
}

/** Starea unui rând de nomenclator. Inactiv nu înseamnă șters, ci scos din uz. */
function InsemnStare({ activ }: { activ: boolean }) {
  return activ ? <Badge ton="success">Activ</Badge> : <InsemnInactiv />
}

// ---------------------------------------------------------------------------
// Servicii și produse
// ---------------------------------------------------------------------------

function coloaneArticol(tip: TipArticol): Coloana<Articol>[] {
  const durata: Coloana<Articol> = {
    cheie: 'durata',
    antet: 'Durată',
    className: 'w-28 whitespace-nowrap tabular-nums text-ink-soft',
    celula: (articol) => formateazaDurata(articol.durata_minute),
  }

  return [
    {
      cheie: 'denumire',
      antet: 'Denumire',
      celula: (articol) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{articol.denumire}</span>
          {/* Serviciul în mai multe ședințe: prețul de alături e al tuturor. */}
          {articol.numar_sedinte > 1 && (
            <Badge ton="primary">{articol.numar_sedinte} ședințe</Badge>
          )}
        </span>
      ),
    },
    ...(tip === 'serviciu' ? [durata] : []),
    {
      cheie: 'pret_lista',
      antet: 'Preț listă',
      laDreapta: true,
      className: 'w-36 whitespace-nowrap tabular-nums',
      celula: (articol) => formateazaBani(articol.pret_lista),
    },
    {
      cheie: 'activ',
      antet: 'Stare',
      className: 'w-24',
      celula: (articol) => <InsemnStare activ={articol.activ} />,
    },
  ]
}

export function ListaArticole({
  tip,
  randuri,
  incarca,
  eroare,
  onReincearca,
  onDeschide,
  stareGoala,
}: ProprietatiLista<Articol> & { tip: TipArticol }) {
  return (
    <Tabel
      coloane={coloaneArticol(tip)}
      randuri={randuri}
      cheieRand={(articol) => articol.id}
      incarca={incarca}
      eroare={eroare}
      onReincearca={onReincearca}
      onRandClick={onDeschide}
      stareGoala={stareGoala}
      randMobil={(articol) => (
        <div className="tinta-atingere flex items-center justify-between gap-3">
          <CelulaDubla
            principal={articol.denumire}
            secundar={tip === 'serviciu' ? formateazaDurata(articol.durata_minute) : undefined}
          />
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm font-medium text-ink tabular-nums">
              {formateazaBani(articol.pret_lista)}
            </span>
            {!articol.activ && <InsemnInactiv />}
          </div>
        </div>
      )}
    />
  )
}

/*
  Nu există listă de puncte de lucru.

  Clinica are o singură locație, așa că nu are ce alege și ce administra. Vezi
  comentariul de pe `PunctLucru` în @/domain/types pentru ce s-a păstrat în
  spate și de ce.
*/
