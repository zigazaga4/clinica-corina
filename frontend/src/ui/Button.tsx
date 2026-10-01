import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

export type VariantaButon = 'primar' | 'secundar' | 'discret' | 'pericol' | 'legatura'
export type DimensiuneButon = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variante: Record<VariantaButon, string> = {
  primar:
    'bg-primary-600 text-white shadow-xs hover:bg-primary-700 active:bg-primary-800 ' +
    'dark:text-primary-950 dark:hover:bg-primary-500',
  secundar:
    'bg-surface text-ink ring-1 ring-inset ring-line hover:bg-muted active:bg-line/60',
  discret: 'text-ink-soft hover:bg-muted hover:text-ink active:bg-line/60',
  pericol: 'bg-danger text-white shadow-xs hover:brightness-95 active:brightness-90',
  legatura: 'text-primary-600 hover:text-primary-700 hover:underline underline-offset-4',
}

const dimensiuni: Record<DimensiuneButon, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[13px]',
  md: 'h-9.5 gap-2 px-3.5 text-sm',
  lg: 'h-11 gap-2 px-5 text-[15px]',
  icon: 'size-9.5',
  'icon-sm': 'size-8',
}

export interface ButonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children?: ReactNode
  varianta?: VariantaButon
  dimensiune?: DimensiuneButon
  /**
   * Afișează un indicator ȘI dezactivează butonul. Un singur adevăr pentru
   * „operațiunea este în curs” — altfel un dublu-clic trimite două cereri, iar
   * la vânzări asta înseamnă două înregistrări.
   */
  incarca?: boolean
  /** Ocupă toată lățimea — implicit pe ecranele mici. */
  plin?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Buton({
  children,
  varianta = 'secundar',
  dimensiune = 'md',
  incarca = false,
  plin = false,
  className,
  disabled,
  type = 'button',
  ref,
  ...restul
}: ButonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || incarca}
      aria-busy={incarca || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-lg font-medium',
        'transition-colors duration-150 select-none',
        'disabled:pointer-events-none disabled:opacity-50',
        variante[varianta],
        dimensiuni[dimensiune],
        plin && 'w-full',
        className,
      )}
      {...restul}
    >
      {incarca && <Spinner dimensiune="sm" className="absolute" />}
      {/*
        Conținutul rămâne în flux și devine invizibil, ca lățimea butonului să
        nu se schimbe la salvare — un buton care se micșorează sub cursor mută
        restul barei de acțiuni.
      */}
      <span className={cn('inline-flex items-center gap-2', incarca && 'invisible')}>
        {children}
      </span>
    </button>
  )
}

/**
 * Buton așezat pe un rând care se deschide singur la clic.
 *
 * Apăsarea lui nu are voie să ajungă și la rând: altfel „Șterge” ar deschide
 * și detaliul de dedesubt. Oprește deopotrivă clicul și tastele (Enter/Spațiu
 * pe rândul focalizat).
 */
export function ButonRand({ onClick, onKeyDown, ...restul }: ButonProps) {
  return (
    <Buton
      {...restul}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        onKeyDown?.(e)
      }}
    />
  )
}

/** Grup de butoane lipite — folosit pentru comutarea vederii de calendar. */
export function GrupButoane({
  children,
  className,
  eticheta,
}: {
  children: ReactNode
  className?: string
  eticheta?: string
}) {
  return (
    <div
      role="group"
      aria-label={eticheta}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5 ring-1 ring-inset ring-line',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Buton dintr-un `GrupButoane`, cu stare apăsată. */
export function ButonGrup({
  children,
  activ,
  className,
  ...restul
}: ButonProps & { activ?: boolean }) {
  return (
    <Buton
      varianta="discret"
      dimensiune="sm"
      aria-pressed={activ}
      className={cn(
        'rounded-[7px] font-medium',
        activ
          ? 'bg-surface text-ink shadow-xs hover:bg-surface'
          : 'text-ink-soft hover:bg-transparent hover:text-ink',
        className,
      )}
      {...restul}
    >
      {children}
    </Buton>
  )
}
