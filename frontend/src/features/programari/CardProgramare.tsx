import { Clock, User } from 'lucide-react'
import type { ProgramareDetaliu, StareProgramare } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaInterval, formateazaOra } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { InsemnStareProgramare } from '@/components/insemne'

/**
 * Reprezentarea unei programări.
 *
 * Există în două forme, pentru că grila și lista au constrângeri diferite:
 * într-o celulă de 30 de minute încap două rânduri de text, într-un rând de
 * listă încap toate detaliile. Ambele trăiesc aici, ca starea „anulat” să
 * arate la fel în calendar și în agendă.
 */

/**
 * Culorile stării.
 *
 * Sunt scrise ca clase complete, nu compuse din bucăți (`bg-${ton}-soft`):
 * Tailwind generează utilitarele citind codul sursă la compilare, deci o clasă
 * construită la execuție nu ajunge niciodată în CSS-ul final.
 */
const fundal: Record<StareProgramare, string> = {
  programat: 'bg-info-soft text-info border-info/30',
  onorat: 'bg-success-soft text-success border-success/30',
  anulat: 'bg-muted text-ink-faint border-line',
  neprezentat: 'bg-danger-soft text-danger border-danger/30',
}

/** Banda verticală din lista de agendă. */
const banda: Record<StareProgramare, string> = {
  programat: 'bg-info',
  onorat: 'bg-success',
  anulat: 'bg-line-strong',
  neprezentat: 'bg-danger',
}

// ---------------------------------------------------------------------------
// Forma pentru grilă
// ---------------------------------------------------------------------------

export function ChipProgramare({
  programare,
  onClick,
  compact = false,
  className,
  style,
}: {
  programare: ProgramareDetaliu
  onClick: (programare: ProgramareDetaliu) => void
  /** Sub 40px înălțime se afișează doar ora și clientul, pe un rând. */
  compact?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const anulata = programare.stare === 'anulat'

  return (
    <button
      type="button"
      onClick={() => onClick(programare)}
      title={`${formateazaInterval(programare.incepe_la, programare.se_termina_la)} · ${programare.client_nume} · ${programare.articol_denumire}`}
      style={style}
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-md border px-1.5 py-1 text-left',
        'transition-all hover:z-10 hover:shadow-(--umbra-card) focus-visible:z-10',
        fundal[programare.stare],
        // Programarea anulată rămâne vizibilă, dar tăiată: locul ei este liber,
        // iar ștergerea din calendar ar ascunde faptul că a existat.
        anulata && 'line-through opacity-70',
        className,
      )}
    >
      <span className={cn('truncate text-[11px] leading-tight font-semibold', compact && 'text-[10px]')}>
        {formateazaOra(programare.incepe_la)} {programare.client_nume}
      </span>
      {!compact && (
        <span className="truncate text-[11px] leading-tight opacity-80">
          {programare.articol_denumire}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Forma pentru listă (agenda zilei, telefon)
// ---------------------------------------------------------------------------

export function RandProgramare({
  programare,
  onClick,
  cuExecutant = true,
}: {
  programare: ProgramareDetaliu
  onClick: (programare: ProgramareDetaliu) => void
  /** Ascuns când lista este deja filtrată pe o singură persoană. */
  cuExecutant?: boolean
}) {
  const anulata = programare.stare === 'anulat'

  return (
    <button
      type="button"
      onClick={() => onClick(programare)}
      className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      {/* Bandă colorată: dă starea dintr-o privire, la derularea rapidă a zilei. */}
      <span
        className={cn('w-1 shrink-0 rounded-full', banda[programare.stare])}
        aria-hidden
      />

      <span className="w-13 shrink-0 pt-0.5 text-[13px] font-semibold text-ink tabular-nums">
        {formateazaOra(programare.incepe_la)}
        <span className="block text-[11px] font-normal text-ink-faint">
          {formateazaOra(programare.se_termina_la)}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium text-ink', anulata && 'line-through')}>
          {programare.client_nume}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-soft">
          {programare.articol_denumire}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
          {cuExecutant && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" aria-hidden />
              {programare.executant_nume}
            </span>
          )}
          {programare.client_telefon && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {programare.client_telefon}
            </span>
          )}
        </span>
      </span>

      {/*
        Suma stă discret, aliniată la dreapta: recepția citește pe verticală
        banii zilei, fără să deschidă fiecare programare în parte.
      */}
      <span className="flex shrink-0 flex-col items-end gap-1 self-start">
        <InsemnStareProgramare stare={programare.stare} />
        <span
          className={cn(
            'text-[12px] text-ink-soft tabular-nums',
            anulata && 'text-ink-faint line-through',
          )}
        >
          {formateazaBani(programare.pret)}
        </span>
      </span>
    </button>
  )
}
