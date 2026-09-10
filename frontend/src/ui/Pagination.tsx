import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Buton } from './Button'

/**
 * Navigarea între pagini.
 *
 * Afișează intervalul („26–50 din 312”), nu doar numărul paginii: operatoarea
 * trebuie să știe câte înregistrări există în total ca să decidă dacă merită
 * să rafineze filtrul sau să răsfoiască.
 */
export function Paginare({
  pagina,
  pePagina,
  total,
  onSchimba,
  className,
}: {
  pagina: number
  pePagina: number
  total: number
  onSchimba: (pagina: number) => void
  className?: string
}) {
  const ultima = Math.max(1, Math.ceil(total / pePagina))
  // O singură pagină nu are ce naviga; bara ar fi doar zgomot.
  if (total === 0 || ultima === 1) return null

  const primul = (pagina - 1) * pePagina + 1
  const ultimul = Math.min(pagina * pePagina, total)

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-t border-line px-4 py-2.5',
        className,
      )}
    >
      <p className="text-[13px] text-ink-faint tabular-nums">
        <span className="hidden sm:inline">Afișate </span>
        {primul}–{ultimul} din {total}
      </p>

      <div className="flex items-center gap-1">
        <Buton
          dimensiune="icon-sm"
          varianta="secundar"
          onClick={() => onSchimba(pagina - 1)}
          disabled={pagina <= 1}
          aria-label="Pagina anterioară"
        >
          <ChevronLeft className="size-4" />
        </Buton>
        <span className="px-2 text-[13px] text-ink-soft tabular-nums">
          {pagina} / {ultima}
        </span>
        <Buton
          dimensiune="icon-sm"
          varianta="secundar"
          onClick={() => onSchimba(pagina + 1)}
          disabled={pagina >= ultima}
          aria-label="Pagina următoare"
        >
          <ChevronRight className="size-4" />
        </Buton>
      </div>
    </div>
  )
}
