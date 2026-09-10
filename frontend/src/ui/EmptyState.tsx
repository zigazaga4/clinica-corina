import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Buton } from './Button'

export interface StareGoalaProps {
  pictograma?: ReactNode
  titlu: ReactNode
  descriere?: ReactNode
  /** Acțiunea evidentă din acel context: „Adaugă primul client”. */
  actiune?: { eticheta: string; onClick: () => void }
  children?: ReactNode
  className?: string
}

/**
 * Ecranul afișat când o listă nu are rânduri.
 *
 * Distinge două situații care arată la fel și nu sunt deloc la fel: „nu există
 * încă nimic” (și atunci oferă acțiunea de a crea) și „filtrele nu au potriviri”
 * (și atunci oferă golirea filtrelor). Un simplu „Nicio înregistrare” lasă
 * utilizatorul să creadă că datele s-au pierdut.
 */
export function StareGoala({
  pictograma,
  titlu,
  descriere,
  actiune,
  children,
  className,
}: StareGoalaProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      {pictograma && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted text-ink-faint">
          {pictograma}
        </div>
      )}
      <p className="text-sm font-medium text-ink">{titlu}</p>
      {descriere && <p className="mt-1 max-w-sm text-[13px] text-ink-faint">{descriere}</p>}
      {actiune && (
        <Buton varianta="primar" dimensiune="sm" className="mt-4" onClick={actiune.onClick}>
          {actiune.eticheta}
        </Buton>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

/** Varianta pentru erori, cu reîncercare. */
export function StareEroare({
  mesaj,
  onReincearca,
  className,
}: {
  mesaj: string
  onReincearca?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger">
        <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
          <path
            d="M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-ink">Nu s-au putut încărca datele</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-faint">{mesaj}</p>
      {onReincearca && (
        <Buton dimensiune="sm" className="mt-4" onClick={onReincearca}>
          Încearcă din nou
        </Buton>
      )}
    </div>
  )
}
