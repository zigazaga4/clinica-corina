import { cn } from '@/lib/cn'

const dimensiuni = {
  xs: 'size-3 border-[1.5px]',
  sm: 'size-4 border-2',
  md: 'size-5 border-2',
  lg: 'size-8 border-[3px]',
} as const

export interface SpinnerProps {
  dimensiune?: keyof typeof dimensiuni
  className?: string
  /** Text pentru cititoarele de ecran; „Se încarcă” dacă lipsește. */
  eticheta?: string
}

/** Indicatorul de așteptare, folosit în butoane, tabele și ecrane goale. */
export function Spinner({ dimensiune = 'md', className, eticheta }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={eticheta ?? 'Se încarcă'}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full',
        'border-current border-t-transparent',
        dimensiuni[dimensiune],
        className,
      )}
    />
  )
}

/** Ecran de așteptare centrat, pentru conținutul unei pagini întregi. */
export function IncarcarePagina({ text = 'Se încarcă…' }: { text?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-ink-faint">
      <Spinner dimensiune="lg" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

/**
 * Dreptunghi pulsatoriu care ține locul conținutului în timpul încărcării.
 * Păstrează înălțimea rândului, ca lista să nu sară la sosirea datelor.
 */
export function Schelet({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}
