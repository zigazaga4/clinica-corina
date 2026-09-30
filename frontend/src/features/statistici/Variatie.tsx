import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

const procent = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 })

/**
 * Cât s-a schimbat o cifră față de perioada comparată: „▲ 12% față de 10.200 RON”.
 *
 * Culoarea spune dacă schimbarea e BUNĂ, nu dacă e în sus: cheltuielile care
 * cresc sunt roșii, încasările care cresc sunt verzi. Săgeata și semnul spun
 * direcția — culoarea nu rămâne niciodată singură să o spună.
 */
export function Variatie({
  curent,
  anterior,
  maiMultEBine = true,
  formateaza,
}: {
  curent: number
  anterior: number
  /** false la cheltuieli: mai mult înseamnă mai rău. */
  maiMultEBine?: boolean
  /** Cum se scrie valoarea de comparat — bani sau bucăți. */
  formateaza: (valoare: number) => string
}) {
  const diferenta = curent - anterior
  const directie = diferenta === 0 ? 0 : diferenta > 0 ? 1 : -1
  const bine = directie === 0 ? null : (directie > 0) === maiMultEBine

  /*
    Procentul are sens doar față de o bază pozitivă. Față de zero nu există;
    față de un profit negativ ar ieși „1.169%” — adevărat, dar de neînțeles.
    Acolo se scrie diferența în bani.
  */
  const text =
    anterior > 0
      ? `${procent.format(Math.abs((diferenta / anterior) * 100))}%`
      : anterior < 0
        ? formateaza(Math.abs(diferenta))
        : null

  const Sageata = directie > 0 ? ArrowUpRight : directie < 0 ? ArrowDownRight : Minus

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-0.5 font-medium',
          bine === true && 'text-success',
          bine === false && 'text-danger',
          bine === null && 'text-ink-faint',
        )}
      >
        <Sageata className="size-3.5" aria-hidden />
        <span className="sr-only">{directie > 0 ? 'crescut' : directie < 0 ? 'scăzut' : 'neschimbat'}</span>
        {text}
      </span>
      <span className="truncate">
        {anterior === 0
          ? directie === 0
            ? 'la fel ca în perioada comparată'
            : 'nimic în perioada comparată'
          : `față de ${formateaza(anterior)}`}
      </span>
    </span>
  )
}
