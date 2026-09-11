import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useInchidereExterna } from '@/lib/hooks'

/**
 * Meniu contextual.
 *
 * Adună acțiunile secundare ale unui rând sau ale unui ecran, ca bara de sus
 * să conțină doar acțiunea principală. Se închide singur după alegere: un
 * meniu rămas deschis peste conținut este confuz și cere un clic în plus.
 */

export interface MeniuProps {
  /** Elementul care deschide meniul; primește starea pentru `aria-expanded`. */
  declansator: (props: { deschis: boolean; comuta: () => void }) => ReactNode
  children: ReactNode
  /** Aliniere față de declanșator. */
  aliniere?: 'stanga' | 'dreapta'
  /**
   * Partea în care se desface meniul.
   *
   * „sus” este obligatoriu pentru declanșatoarele lipite de marginea de jos a
   * ecranului — meniul contului, de pildă. Desfăcut în jos de acolo, ajunge sub
   * marginea ferestrei și nu se mai vede: butonul răspunde, dar nu apare nimic.
   */
  directie?: 'jos' | 'sus'
  className?: string
}

export function Meniu({
  declansator,
  children,
  aliniere = 'dreapta',
  directie = 'jos',
  className,
}: MeniuProps) {
  const [deschis, setDeschis] = useState(false)
  const ref = useInchidereExterna<HTMLDivElement>(deschis, () => setDeschis(false))

  return (
    <div ref={ref} className="relative inline-flex">
      {declansator({ deschis, comuta: () => setDeschis((d) => !d) })}

      {deschis && (
        <div
          role="menu"
          // Închiderea se face la orice alegere din interior, ca fiecare
          // element de meniu să nu fie nevoit să o ceară explicit.
          onClick={() => setDeschis(false)}
          className={cn(
            'absolute z-30 min-w-48 overflow-hidden rounded-xl',
            'border border-line bg-elevated p-1 shadow-(--umbra-ridicat)',
            'anim-intrare-modala',
            directie === 'sus' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            aliniere === 'dreapta' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function ElementMeniu({
  children,
  onClick,
  pictograma,
  periculos = false,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  pictograma?: ReactNode
  periculos?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
        'transition-colors disabled:pointer-events-none disabled:opacity-40',
        periculos ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-muted',
      )}
    >
      {pictograma && <span className="shrink-0 text-ink-faint">{pictograma}</span>}
      <span className="truncate">{children}</span>
    </button>
  )
}

export function SeparatorMeniu() {
  return <div role="separator" className="my-1 h-px bg-line" />
}

export function TitluMeniu({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
      {children}
    </p>
  )
}
