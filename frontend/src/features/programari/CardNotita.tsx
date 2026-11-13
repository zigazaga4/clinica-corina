import { StickyNote, Users } from 'lucide-react'
import type { NotitaDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaInterval, formateazaOra } from '@/lib/dates'
import { useCuloarePersoana } from './culoriExecutanti'

/**
 * Reprezentarea unei notițe în calendar.
 *
 * Aceleași două forme ca la programare — chip pentru grilă, rând pentru
 * listă — dar cu o singură grijă în plus: să NU semene cu o ședință. Fundal
 * ROȘU (cerința clinicii, 2026-10-01: timpul liber / concediul se vede în
 * roșu), contur întrerupt, pictogramă de bilețel. Cine se uită de la un metru
 * la agenda zilei trebuie să vadă că la 15:00 persoana nu e disponibilă.
 *
 * Fără bandă colorată pe margine (cerută scoasă, 2026-10-01): a cui e notița
 * spune coloana persoanei și rândul al doilea al chipului.
 */

const STIL_NOTITA = 'bg-danger-soft text-danger border-danger/60 border-dashed'

/** Cui i se adresează, pentru rândul de listă și pentru `title`. */
export function pentruCine(notita: NotitaDetaliu): string {
  return notita.executant_nume ?? 'Toată clinica'
}

// ---------------------------------------------------------------------------
// Forma pentru grilă
// ---------------------------------------------------------------------------

export function ChipNotita({
  notita,
  onClick,
  compact = false,
  mare = false,
  className,
  style,
}: {
  notita: NotitaDetaliu
  onClick: (notita: NotitaDetaliu) => void
  compact?: boolean
  /** Ziua mare de pe telefon: text mare, rupt pe rânduri în loc de „…”. */
  mare?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(notita)}
      title={`${formateazaInterval(notita.incepe_la, notita.se_termina_la)} · ${notita.titlu} · ${pentruCine(notita)}\nApasă pentru detalii`}
      style={style}
      className={cn(
        'relative flex w-full cursor-pointer flex-col overflow-hidden rounded-md border px-1.5 py-1 text-left',
        mare && 'px-2',
        'transition-all hover:z-10 hover:shadow-(--umbra-card) hover:ring-2 hover:ring-ink/20 focus-visible:z-10',
        STIL_NOTITA,
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center gap-1 leading-tight font-semibold',
          mare ? 'text-[15px] font-bold' : 'truncate text-[11px]',
          compact && !mare && 'text-[10px]',
        )}
      >
        <StickyNote className={cn('shrink-0', mare ? 'size-4' : 'size-3')} aria-hidden />
        <span className={mare ? 'min-w-0 break-words' : 'truncate'}>
          {formateazaOra(notita.incepe_la)} {notita.titlu}
        </span>
      </span>
      {!compact && (
        <span
          className={cn(
            'leading-tight',
            mare ? 'text-[14px] break-words opacity-90' : 'truncate text-[11px] opacity-80',
          )}
        >
          {notita.detalii ?? pentruCine(notita)}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Forma pentru listă (agenda zilei, telefon)
// ---------------------------------------------------------------------------

export function RandNotita({
  notita,
  onClick,
}: {
  notita: NotitaDetaliu
  onClick: (notita: NotitaDetaliu) => void
}) {
  const culoare = useCuloarePersoana(notita.executant_id)

  return (
    <button
      type="button"
      onClick={() => onClick(notita)}
      className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <span className="w-13 shrink-0 pt-0.5 text-[13px] font-semibold text-ink tabular-nums">
        {formateazaOra(notita.incepe_la)}
        <span className="block text-[11px] font-normal text-ink-faint">
          {formateazaOra(notita.se_termina_la)}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <StickyNote className="size-3.5 shrink-0 text-danger" aria-hidden />
          <span className="truncate">{notita.titlu}</span>
        </span>
        {notita.detalii && (
          <span className="mt-0.5 block truncate text-[12px] text-ink-soft">{notita.detalii}</span>
        )}
        <span
          style={culoare?.stil}
          className={cn(
            'mt-1 inline-flex items-center gap-1 text-[11px] text-ink-faint',
            culoare && culoare.text,
          )}
        >
          {culoare ? (
            <span className={cn('size-2 shrink-0 rounded-full', culoare.fundal)} aria-hidden />
          ) : (
            <Users className="size-3" aria-hidden />
          )}
          <span className="font-medium">{pentruCine(notita)}</span>
        </span>
      </span>
    </button>
  )
}
