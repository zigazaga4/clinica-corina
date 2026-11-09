import { Ban, Check } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface CuloarePaleta {
  /** Numele pe care îl aude cititorul de ecran și îl vede cine ține mouse-ul deasupra. */
  nume: string
  /** #rrggbb, cu litere mici. */
  hex: string
}

/**
 * Culorile propuse, în ordinea în care le-a cerut clinica (9 nov. 2026):
 * albastru, galben, verde — apoi cele care mai pot fi nevoie ca să se
 * deosebească zece proceduri între ele.
 *
 * Sunt tonuri de mijloc, nici pastel, nici închise: programarea le primește pe
 * fundal (30%) și pe contur, cu text obișnuit deasupra, iar galbenul închis
 * dă același rezultat lizibil ca albastrul.
 */
export const CULORI_PALETA: CuloarePaleta[] = [
  { nume: 'Albastru', hex: '#3b82f6' },
  { nume: 'Galben', hex: '#eab308' },
  { nume: 'Verde', hex: '#22c55e' },
  { nume: 'Roșu', hex: '#ef4444' },
  { nume: 'Portocaliu', hex: '#f97316' },
  { nume: 'Mov', hex: '#8b5cf6' },
  { nume: 'Roz', hex: '#ec4899' },
  { nume: 'Turcoaz', hex: '#14b8a6' },
  { nume: 'Gri', hex: '#6b7280' },
]

/**
 * Punctul unei culori — semnul mic care o arată acolo unde nu acoperă un rând
 * întreg (lista din Nomenclator, agenda zilei). Decorativ: numele lucrului
 * colorat stă mereu lângă el.
 */
export function PunctCuloare({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      style={{ backgroundColor: hex }}
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      aria-hidden
    />
  )
}

/**
 * Alegerea unei culori dintr-o paletă, cu „fără culoare” și „altă culoare”.
 *
 * Valoarea e `#rrggbb` sau `null` (= fără). Un singur control, folosit la orice
 * ecran care colorează ceva: culorile se văd, nu se aleg dintr-o listă de
 * nume, iar cine vrea o nuanță anume o ia din selectorul sistemului.
 *
 * Fiecare culoare e un buton cu numele ei (`aria-label`) și stare apăsată:
 * culoarea singură n-ar spune nimic cuiva care n-o distinge.
 */
export function PaletaCulori({
  valoare,
  onSchimba,
  eticheta = 'Culoare',
  culori = CULORI_PALETA,
  disabled = false,
  className,
}: {
  valoare: string | null
  onSchimba: (hex: string | null) => void
  /** Numele grupului, pentru cititorul de ecran. */
  eticheta?: string
  culori?: CuloarePaleta[]
  disabled?: boolean
  className?: string
}) {
  const actuala = valoare?.toLowerCase() ?? null
  const dinPaleta = culori.some((c) => c.hex === actuala)
  // O culoare care nu e în paletă a venit din selectorul sistemului.
  const personalizata = actuala !== null && !dinPaleta

  return (
    <div role="group" aria-label={eticheta} className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        title="Fără culoare"
        aria-label="Fără culoare"
        aria-pressed={actuala === null}
        disabled={disabled}
        onClick={() => onSchimba(null)}
        className={cn(
          'flex size-8 cursor-pointer items-center justify-center rounded-full border border-dashed border-line-strong text-ink-faint',
          'transition-shadow hover:text-ink disabled:cursor-not-allowed disabled:opacity-50',
          actuala === null && 'text-ink ring-2 ring-ink ring-offset-2 ring-offset-surface',
        )}
      >
        <Ban className="size-4" aria-hidden />
      </button>

      {culori.map((c) => {
        const aleasa = actuala === c.hex
        return (
          <button
            key={c.hex}
            type="button"
            title={c.nume}
            aria-label={c.nume}
            aria-pressed={aleasa}
            disabled={disabled}
            onClick={() => onSchimba(c.hex)}
            style={{ backgroundColor: c.hex }}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-full text-white',
              'transition-shadow hover:shadow-(--umbra-card) disabled:cursor-not-allowed disabled:opacity-50',
              aleasa && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
            )}
          >
            {aleasa && <Check className="size-4 drop-shadow" aria-hidden />}
          </button>
        )
      })}

      {/* Altă culoare: selectorul sistemului, ascuns sub un cerc cu toate culorile. */}
      <label
        title="Altă culoare"
        className={cn(
          'relative flex size-8 cursor-pointer items-center justify-center rounded-full text-white',
          'transition-shadow hover:shadow-(--umbra-card)',
          disabled && 'cursor-not-allowed opacity-50',
          personalizata && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
        )}
        style={{
          background: personalizata
            ? actuala
            : 'conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #8b5cf6, #ef4444)',
        }}
      >
        {personalizata && <Check className="size-4 drop-shadow" aria-hidden />}
        <input
          type="color"
          aria-label="Altă culoare"
          disabled={disabled}
          value={actuala ?? '#3b82f6'}
          onChange={(e) => onSchimba(e.target.value.toLowerCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </label>
    </div>
  )
}
