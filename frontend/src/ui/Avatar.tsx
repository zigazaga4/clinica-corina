import { cn } from '@/lib/cn'
import { initiale, normalizeaza } from '@/lib/text'

const dimensiuni = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-[11px]',
  md: 'size-9.5 text-[13px]',
  lg: 'size-12 text-base',
} as const

/**
 * Paleta de fundaluri pentru inițiale.
 *
 * Aplicația nu are fotografii de profil (nu fac obiectul contractului), deci
 * distincția vizuală se face din culoare. Culoarea se alege DETERMINIST din
 * nume: aceeași persoană are aceeași culoare pe orice ecran și pe orice
 * dispozitiv, ceea ce transformă cercul într-un reper de recunoaștere rapidă
 * în agenda zilei.
 */
const palete = [
  'bg-primary-100 text-primary-700',
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-danger-soft text-danger',
  'bg-muted text-ink-soft',
] as const

function indexCuloare(nume: string): number {
  const text = normalizeaza(nume)
  let suma = 0
  for (let i = 0; i < text.length; i++) suma = (suma * 31 + text.charCodeAt(i)) >>> 0
  return suma % palete.length
}

export interface AvatarProps {
  nume: string
  dimensiune?: keyof typeof dimensiuni
  className?: string
  /** Culoare fixă în locul celei derivate din nume. */
  ton?: (typeof palete)[number]
}

export function Avatar({ nume, dimensiune = 'md', className, ton }: AvatarProps) {
  return (
    <span
      title={nume}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        ton ?? palete[indexCuloare(nume)],
        dimensiuni[dimensiune],
        className,
      )}
    >
      {initiale(nume)}
    </span>
  )
}
