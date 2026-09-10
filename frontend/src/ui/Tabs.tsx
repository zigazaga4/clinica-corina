import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface Fila<T extends string> {
  valoare: T
  eticheta: ReactNode
  /** Numărul de elemente din filă; ascuns când este zero. */
  contor?: number
}

/**
 * File orizontale.
 *
 * Se derulează lateral pe telefon (`fara-bara`) în loc să se împacheteze pe
 * două rânduri — un set de file care își schimbă înălțimea împinge conținutul
 * de sub el la fiecare selecție.
 */
export function File<T extends string>({
  file,
  activa,
  onSchimba,
  className,
}: {
  file: Fila<T>[]
  activa: T
  onSchimba: (valoare: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'fara-bara -mb-px flex gap-1 overflow-x-auto border-b border-line',
        className,
      )}
    >
      {file.map((fila) => {
        const selectata = fila.valoare === activa
        return (
          <button
            key={fila.valoare}
            type="button"
            role="tab"
            aria-selected={selectata}
            onClick={() => onSchimba(fila.valoare)}
            className={cn(
              'relative shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap',
              'transition-colors',
              selectata
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-ink-soft hover:border-line-strong hover:text-ink',
            )}
          >
            {fila.eticheta}
            {fila.contor !== undefined && fila.contor > 0 && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
                  selectata ? 'bg-primary-100 text-primary-700' : 'bg-muted text-ink-faint',
                )}
              >
                {fila.contor}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
