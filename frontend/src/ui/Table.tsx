import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Schelet } from './Spinner'
import { StareEroare, StareGoala } from './EmptyState'

/*
  Tabelul.

  Este piesa care rezolvă cerința art. 2.2 / 3.1.E — „interfață adaptată
  dimensiunii ecranului” — o singură dată, pentru toate listele. Pe ecran lat
  randează un tabel; sub pragul `sm` randează carduri, prin `randMobil`.

  Alternativa uzuală, un tabel care se derulează orizontal pe telefon, este
  inutilizabilă cu degetul: recepționera ar trebui să deruleze lateral ca să
  vadă ora unei programări. Aici fiecare listă își declară forma de card, iar
  restul — încărcare, eroare, listă goală, evidențierea rândului — vine de-a
  gata și arată la fel peste tot.
*/

export interface Coloana<T> {
  /** Identificator stabil; folosit drept cheie React. */
  cheie: string
  antet: ReactNode
  celula: (rand: T) => ReactNode
  /** Clase pe celulă și pe antet: lățime, aliniere, `tabular-nums`. */
  className?: string
  /** Ascunde coloana sub pragul dat, ca tabelul să respire pe ecrane medii. */
  ascunsaSub?: 'md' | 'lg' | 'xl'
  /** Aliniere la dreapta pentru sume și cantități. */
  laDreapta?: boolean
}

export interface TabelProps<T> {
  coloane: Coloana<T>[]
  randuri: T[]
  cheieRand: (rand: T) => string
  /** Card afișat în locul rândului pe ecrane înguste. */
  randMobil?: (rand: T) => ReactNode
  onRandClick?: (rand: T) => void
  /**
   * Acțiune lângă cardul de pe telefon, în afara zonei apăsabile.
   *
   * Cardul întreg este un buton când rândul se poate deschide, iar un buton
   * pus înăuntrul altuia nu este HTML valid — apăsarea ar ajunge la amândouă.
   */
  actiuneMobil?: (rand: T) => ReactNode
  incarca?: boolean
  eroare?: string | null
  onReincearca?: () => void
  /** Ce se afișează când nu există rânduri. */
  stareGoala?: ReactNode
  /** Câte rânduri-schelet la prima încărcare. */
  randuriSchelet?: number
  className?: string
}

const ascundere: Record<NonNullable<Coloana<unknown>['ascunsaSub']>, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

export function Tabel<T>({
  coloane,
  randuri,
  cheieRand,
  randMobil,
  onRandClick,
  actiuneMobil,
  incarca = false,
  eroare = null,
  onReincearca,
  stareGoala,
  randuriSchelet = 6,
  className,
}: TabelProps<T>) {
  if (eroare) {
    return <StareEroare mesaj={eroare} {...(onReincearca ? { onReincearca } : {})} />
  }

  // Scheletul se arată doar la PRIMA încărcare. La refiltrare, rândurile vechi
  // rămân vizibile și estompate — ecranul nu clipește la fiecare tastă apăsată.
  if (incarca && randuri.length === 0) {
    return <ScheletTabel coloane={coloane.length} randuri={randuriSchelet} />
  }

  if (randuri.length === 0) {
    return <>{stareGoala ?? <StareGoala titlu="Nicio înregistrare" />}</>
  }

  const clicabil = Boolean(onRandClick)

  return (
    <div className={cn('relative', incarca && 'opacity-60 transition-opacity', className)}>
      {/* --- ecrane late: tabel --- */}
      <div className={cn('overflow-x-auto', randMobil && 'hidden sm:block')}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {coloane.map((coloana) => (
                <th
                  key={coloana.cheie}
                  scope="col"
                  className={cn(
                    'px-3 py-2.5 text-left text-[12px] font-medium tracking-wide',
                    'text-ink-faint uppercase whitespace-nowrap',
                    coloana.laDreapta && 'text-right',
                    coloana.ascunsaSub && ascundere[coloana.ascunsaSub],
                    coloana.className,
                  )}
                >
                  {coloana.antet}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {randuri.map((rand) => (
              <tr
                key={cheieRand(rand)}
                onClick={onRandClick ? () => onRandClick(rand) : undefined}
                // Rândul devine accesibil de la tastatură doar dacă este chiar
                // interactiv; altfel ar apărea în ordinea de tabulare degeaba.
                tabIndex={clicabil ? 0 : undefined}
                role={clicabil ? 'button' : undefined}
                onKeyDown={
                  onRandClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRandClick(rand)
                        }
                      }
                    : undefined
                }
                className={cn(
                  'border-b border-line/70 last:border-0',
                  clicabil && 'cursor-pointer transition-colors hover:bg-muted focus:bg-muted',
                )}
              >
                {coloane.map((coloana) => (
                  <td
                    key={coloana.cheie}
                    className={cn(
                      'px-3 py-2.5 align-middle text-ink',
                      coloana.laDreapta && 'text-right',
                      coloana.ascunsaSub && ascundere[coloana.ascunsaSub],
                      coloana.className,
                    )}
                  >
                    {coloana.celula(rand)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- ecrane înguste: carduri --- */}
      {randMobil && (
        <ul className="divide-y divide-line sm:hidden">
          {randuri.map((rand) => (
            <li key={cheieRand(rand)} className="flex items-center">
              {onRandClick ? (
                <button
                  type="button"
                  onClick={() => onRandClick(rand)}
                  className="min-w-0 flex-1 px-4 py-3 text-left transition-colors active:bg-muted"
                >
                  {randMobil(rand)}
                </button>
              ) : (
                <div className="min-w-0 flex-1 px-4 py-3">{randMobil(rand)}</div>
              )}
              {actiuneMobil && <div className="shrink-0 pr-4">{actiuneMobil(rand)}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ScheletTabel({ coloane, randuri }: { coloane: number; randuri: number }) {
  return (
    <div className="space-y-px p-3" aria-hidden>
      {Array.from({ length: randuri }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          {Array.from({ length: coloane }, (_, j) => (
            <Schelet
              key={j}
              className={cn('h-4', j === 0 ? 'w-[28%]' : 'flex-1', j > 2 && 'hidden md:block')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Celulă cu titlu pe primul rând și detaliu discret pe al doilea. */
export function CelulaDubla({
  principal,
  secundar,
  className,
}: {
  principal: ReactNode
  secundar?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-medium text-ink">{principal}</div>
      {secundar !== undefined && secundar !== null && secundar !== '' && (
        <div className="truncate text-[12px] text-ink-faint">{secundar}</div>
      )}
    </div>
  )
}
