import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Input, type InputProps } from './Field'

/**
 * Câmpul de căutare.
 *
 * Are buton de golire pentru că, altfel, ștergerea unui termen lung se face
 * ținând Backspace apăsat — iar la recepție, cu clientul în față, asta
 * contează. Butonul apare doar când există text de golit.
 */
export function CampCautare({
  valoare,
  onSchimba,
  placeholder = 'Caută…',
  className,
  ...restul
}: Omit<InputProps, 'value' | 'onChange' | 'pictograma' | 'sufix'> & {
  valoare: string
  onSchimba: (valoare: string) => void
}) {
  return (
    <Input
      type="search"
      role="searchbox"
      value={valoare}
      onChange={(e) => onSchimba(e.target.value)}
      placeholder={placeholder}
      pictograma={<Search className="size-4" />}
      sufix={
        valoare ? (
          <button
            type="button"
            onClick={() => onSchimba('')}
            aria-label="Golește căutarea"
            className="rounded-md p-1 text-ink-faint transition-colors hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : undefined
      }
      className={cn(
        // Chromium adaugă propriul „x” la input[type=search]; îl avem pe al nostru.
        '[&::-webkit-search-cancel-button]:hidden',
        className,
      )}
      {...restul}
    />
  )
}
