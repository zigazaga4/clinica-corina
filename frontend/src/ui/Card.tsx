import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({
  children,
  className,
  ...restul
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface shadow-(--umbra-card)',
        className,
      )}
      {...restul}
    >
      {children}
    </div>
  )
}

export function AntetCard({
  titlu,
  descriere,
  actiuni,
  className,
}: {
  titlu: ReactNode
  descriere?: ReactNode
  /** Butoane aliniate la dreapta; trec sub titlu pe ecrane înguste. */
  actiuni?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-line px-4 py-3.5',
        'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold text-ink">{titlu}</h2>
        {descriere && <p className="mt-0.5 text-[13px] text-ink-faint">{descriere}</p>}
      </div>
      {actiuni && <div className="flex shrink-0 items-center gap-2">{actiuni}</div>}
    </div>
  )
}

export function CorpCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-4', className)}>{children}</div>
}

/**
 * Pereche etichetă–valoare, folosită în fișa clientului și în detaliul vânzării.
 * Valoarea lipsă se afișează ca „—”, nu ca spațiu gol: altfel nu se distinge
 * „nu s-a completat” de „nu s-a încărcat”.
 */
export function Pereche({
  eticheta,
  children,
  className,
}: {
  eticheta: ReactNode
  children: ReactNode
  className?: string
}) {
  const gol = children === null || children === undefined || children === ''
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[12px] font-medium tracking-wide text-ink-faint uppercase">
        {eticheta}
      </dt>
      <dd className={cn('mt-1 text-sm break-words', gol ? 'text-ink-faint' : 'text-ink')}>
        {gol ? '—' : children}
      </dd>
    </div>
  )
}

/** Cifră mare cu etichetă — rezumatul de sus al listelor. */
export function Statistica({
  eticheta,
  valoare,
  detaliu,
  pictograma,
  className,
}: {
  eticheta: ReactNode
  valoare: ReactNode
  detaliu?: ReactNode
  pictograma?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('flex items-start gap-3 p-3.5', className)}>
      {pictograma && (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          {pictograma}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-ink-faint">{eticheta}</p>
        <p className="mt-0.5 text-xl leading-tight font-semibold text-ink tabular-nums">
          {valoare}
        </p>
        {detaliu && <p className="mt-0.5 truncate text-[12px] text-ink-faint">{detaliu}</p>}
      </div>
    </Card>
  )
}
