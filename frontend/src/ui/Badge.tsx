import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Tonurile disponibile. Etichetele de domeniu (stare programare, tip articol,
 * acțiune jurnal) se mapează pe ele în `@/domain/labels`, ca aceeași stare să
 * arate identic oriunde apare.
 */
export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const tonuri: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-ink-soft ring-line',
  primary: 'bg-primary-50 text-primary-700 ring-primary-200',
  success: 'bg-success-soft text-success ring-success/25',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
  info: 'bg-info-soft text-info ring-info/25',
}

export interface BadgeProps {
  children: ReactNode
  ton?: BadgeTone
  /** Bulină colorată în față — ajută la scanarea rapidă a unei coloane. */
  cuPunct?: boolean
  className?: string
}

export function Badge({ children, ton = 'neutral', cuPunct = false, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5',
        'text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tonuri[ton],
        className,
      )}
    >
      {cuPunct && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/** Contor mic, pentru numărul de rezultate sau de filtre active. */
export function Contor({ valoare, className }: { valoare: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5',
        'bg-primary-600 text-[11px] font-semibold text-white tabular-nums',
        className,
      )}
    >
      {valoare}
    </span>
  )
}
