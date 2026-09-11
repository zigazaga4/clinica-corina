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
 * gălbui, contur întrerupt, pictogramă de bilețel. Cine se uită de la un metru
 * la agenda zilei trebuie să vadă că la 15:00 nu vine o clientă, ci
 * furnizorul.
 *
 * Culoarea persoanei rămâne, ca la programări: o notiță a Irinei stă în banda
 * Irinei. Notița întregii clinici nu are bandă.
 */

const STIL_NOTITA = 'bg-warning-soft text-warning border-warning/40 border-dashed'

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
  className,
  style,
}: {
  notita: NotitaDetaliu
  onClick: (notita: NotitaDetaliu) => void
  compact?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const culoare = useCuloarePersoana(notita.executant_id)

  return (
    <button
      type="button"
      onClick={() => onClick(notita)}
      title={`${formateazaInterval(notita.incepe_la, notita.se_termina_la)} · ${notita.titlu} · ${pentruCine(notita)}`}
      style={style}
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-md border py-1 pr-1.5 text-left',
        culoare ? 'pl-2.5' : 'pl-1.5',
        'transition-all hover:z-10 hover:shadow-(--umbra-card) focus-visible:z-10',
        STIL_NOTITA,
        className,
      )}
    >
      {culoare && (
        <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', culoare.fundal)} />
      )}

      <span
        className={cn(
          'flex items-center gap-1 truncate text-[11px] leading-tight font-semibold',
          compact && 'text-[10px]',
        )}
      >
        <StickyNote className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {formateazaOra(notita.incepe_la)} {notita.titlu}
        </span>
      </span>
      {!compact && (
        <span className="truncate text-[11px] leading-tight opacity-80">
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
      {/* Bandă întreruptă: aceeași poziție ca la programări, alt desen. */}
      <span
        className="w-1 shrink-0 rounded-full border-l-4 border-dashed border-warning"
        aria-hidden
      />

      <span className="w-13 shrink-0 pt-0.5 text-[13px] font-semibold text-ink tabular-nums">
        {formateazaOra(notita.incepe_la)}
        <span className="block text-[11px] font-normal text-ink-faint">
          {formateazaOra(notita.se_termina_la)}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <StickyNote className="size-3.5 shrink-0 text-warning" aria-hidden />
          <span className="truncate">{notita.titlu}</span>
        </span>
        {notita.detalii && (
          <span className="mt-0.5 block truncate text-[12px] text-ink-soft">{notita.detalii}</span>
        )}
        <span
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
