import { useState, type ReactNode } from 'react'
import {
  formateazaProcent,
  parteaSedintei,
  procentReducere,
  totalCuReducere,
} from '@/domain/reducere'
import { cn } from '@/lib/cn'
import { formateazaBani, numarInCamp, parseNumar } from '@/lib/money'
import { plural } from '@/lib/text'
import { Input } from '@/ui'

/**
 * Totalul unui abonament, cu reducere (cerința clinicii, 8 oct. 2026).
 *
 * „Total abonament” — prețul de listă — stă fix; „Reducere” și „Total de
 * plată” se țin una de alta: 50% scrie 450 din 900, iar 400 scris de mână
 * arată 55,56%. Sub ele, partea fiecărei ședințe. Folosit în programare (la
 * abonamentul pe care îl începe ședința) și în fișa tratamentului.
 *
 * Totalul de plată e al părintelui (`total`, ca text de câmp); procentul se
 * calculează din el, în afară de clipa în care tocmai se tastează în el.
 */
export function ReducereAbonament({
  lista,
  total,
  onTotal,
  numarSedinte,
  sufixEticheta = '',
  disabled = false,
  eroare = null,
  ajutor,
  className,
}: {
  /** Prețul de listă al abonamentului; 0 = nu se știe, deci fără procent. */
  lista: number
  /** Totalul de plată, ca text de câmp („450” / „450,5”). */
  total: string
  onTotal: (total: string) => void
  numarSedinte: number
  /** „ 2” când formularul are mai multe abonamente — etichetele rămân unice. */
  sufixEticheta?: string
  disabled?: boolean
  eroare?: string | null
  ajutor?: ReactNode
  className?: string
}) {
  // Procentul tastat acum; null = se arată cel calculat din total.
  const [procentScris, setProcentScris] = useState<string | null>(null)

  const totalNumar = parseNumar(total)
  const procentCalculat = totalNumar === null ? null : procentReducere(lista, totalNumar)
  const procentAfisat =
    procentScris ?? (procentCalculat === null ? '' : numarInCamp(Math.max(procentCalculat, 0)))

  const schimbaProcentul = (text: string) => {
    setProcentScris(text)
    const procent = parseNumar(text)
    if (procent !== null && procent >= 0 && procent <= 100) {
      onTotal(numarInCamp(totalCuReducere(lista, procent)))
    }
  }

  return (
    <div className={cn('flex flex-col gap-2.5 rounded-lg border border-line bg-muted/60 p-3', className)}>
      {lista > 0 && (
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="text-ink-soft">Total abonament{sufixEticheta}</span>
          <span className="font-medium text-ink tabular-nums">{formateazaBani(lista)}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {lista > 0 && (
          <Input
            eticheta={`Reducere${sufixEticheta}`}
            inputMode="decimal"
            value={procentAfisat}
            onChange={(e) => schimbaProcentul(e.target.value)}
            onBlur={() => setProcentScris(null)}
            disabled={disabled}
            sufix="%"
            className="text-right tabular-nums"
            placeholder="0"
          />
        )}
        <Input
          eticheta={`Total de plată${sufixEticheta}`}
          inputMode="decimal"
          obligatoriu
          value={total}
          onChange={(e) => {
            setProcentScris(null)
            onTotal(e.target.value)
          }}
          disabled={disabled}
          eroare={eroare}
          sufix="RON"
          className="pr-13 text-right tabular-nums"
          containerClassName={lista > 0 ? undefined : 'col-span-2'}
        />
      </div>
      <p className="text-[12px] text-ink-faint tabular-nums">
        {totalNumar !== null && totalNumar >= 0 && (
          <>
            {numarSedinte} {plural(numarSedinte, 'ședință', 'ședințe')} ×{' '}
            {formateazaBani(parteaSedintei(totalNumar, numarSedinte))}
            {procentCalculat !== null && procentCalculat > 0 && (
              <> · reducere {formateazaProcent(procentCalculat)}</>
            )}
            {ajutor ? ' · ' : ''}
          </>
        )}
        {ajutor}
      </p>
    </div>
  )
}
