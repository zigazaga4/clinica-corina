import { Clock, Layers, User } from 'lucide-react'
import type { ProgramareDetaliu, StareProgramare } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaInterval, formateazaOra } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { InsemnStareProgramare } from '@/components/insemne'
import { etichetaSedinta, marcajSedinta } from '@/features/tratamente/ProgresTratament'
import { useCuloarePersoana } from './culoriExecutanti'
import { denumireaServiciilor, pretulProgramarii } from './vizite'

/** Primul cuvânt din nume — tot ce încape pe un chip de 30 de minute. */
function prenume(nume: string): string {
  return nume.trim().split(/\s+/)[0] ?? nume
}

/**
 * Reprezentarea unei programări.
 *
 * Există în două forme, pentru că grila și lista au constrângeri diferite:
 * într-o celulă de 30 de minute încap două rânduri de text, într-un rând de
 * listă încap toate detaliile. Ambele trăiesc aici, ca starea „anulat” să
 * arate la fel în calendar și în agendă.
 *
 * Amândouă arată programarea ÎNTREAGĂ: `programare` dă ora, clientul,
 * persoana și starea, `servicii` — toate rândurile ei, cu ședința fiecăruia.
 * Fără `servicii`, programarea are un singur serviciu: pe `programare`.
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
  servicii = [programare],
  onClick,
  compact = false,
  className,
  style,
}: {
  programare: ProgramareDetaliu
  /** Toate serviciile programării; implicit doar `programare`. */
  servicii?: ProgramareDetaliu[]
  onClick: (programare: ProgramareDetaliu) => void
  /** Sub 40px înălțime se afișează doar ora și clientul, pe un rând. */
  compact?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const anulata = programare.stare === 'anulat'
  const culoare = useCuloarePersoana(programare.executant_id)

  return (
    <button
      type="button"
      onClick={() => onClick(programare)}
      title={`${formateazaInterval(programare.incepe_la, programare.se_termina_la)} · ${programare.client_nume} · ${denumireaServiciilor(servicii)} · ${programare.executant_nume}`}
      style={style}
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-md border py-1 pr-1.5 text-left',
        // Banda ocupă 4px la stânga; textul începe după ea.
        culoare ? 'pl-2.5' : 'pl-1.5',
        'transition-all hover:z-10 hover:shadow-(--umbra-card) focus-visible:z-10',
        fundal[programare.stare],
        // Programarea anulată rămâne vizibilă, dar tăiată: locul ei este liber,
        // iar ștergerea din calendar ar ascunde faptul că a existat.
        anulata && 'line-through opacity-70',
        className,
      )}
    >
      {/*
        Banda persoanei. Stă lipită de marginea din stânga, pe toată înălțimea,
        fiindcă acolo o găsește ochiul când parcurge o coloană de ședințe — și
        rămâne vizibilă chiar și pe chipurile de 20 de minute, unde din text nu
        mai încape decât ora.
      */}
      {culoare && (
        <span
          aria-hidden
          className={cn('absolute inset-y-0 left-0 w-1', culoare.fundal)}
        />
      )}

      <span className={cn('truncate text-[11px] leading-tight font-semibold', compact && 'text-[10px]')}>
        {formateazaOra(programare.incepe_la)} {programare.client_nume}
      </span>
      {!compact && (
        <span className="truncate text-[11px] leading-tight opacity-80">
          {/* „3/8”: a câta ședință a tratamentului e — recepția vede din grilă
              cât mai are clienta de venit. Lângă serviciul ei: o programare
              poate avea ședințe din două tratamente deodată. */}
          {servicii.map((serviciu, i) => {
            const marcaj = marcajSedinta(serviciu)
            return (
              <span key={serviciu.id}>
                {i > 0 && ' + '}
                {marcaj && <span className="font-semibold">{marcaj} · </span>}
                {serviciu.articol_denumire}
              </span>
            )
          })}
          {' · '}
          <span className="font-medium">{prenume(programare.executant_nume)}</span>
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
  servicii = [programare],
  onClick,
  cuExecutant = true,
}: {
  programare: ProgramareDetaliu
  /** Toate serviciile programării; implicit doar `programare`. */
  servicii?: ProgramareDetaliu[]
  onClick: (programare: ProgramareDetaliu) => void
  /** Ascuns când lista este deja filtrată pe o singură persoană. */
  cuExecutant?: boolean
}) {
  const anulata = programare.stare === 'anulat'
  const culoare = useCuloarePersoana(programare.executant_id)
  const maiMulte = servicii.length > 1

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
          {servicii.map((s) => s.articol_denumire).join(' + ')}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
          {servicii.map((serviciu) => {
            const eticheta = etichetaSedinta(serviciu)
            if (!eticheta) return null
            return (
              <span key={serviciu.id} className="inline-flex items-center gap-1 font-medium text-primary-600">
                <Layers className="size-3" aria-hidden />
                {/* Cu mai multe servicii, „Ședința 3 din 6” trebuie să spună din care. */}
                {maiMulte ? `${serviciu.articol_denumire}: ${eticheta.toLowerCase()}` : eticheta}
              </span>
            )
          })}
          {cuExecutant && (
            // Punctul colorat repetă banda din calendar, ca aceeași persoană să
            // fie aceeași culoare în ambele vederi.
            <span className={cn('inline-flex items-center gap-1', culoare && culoare.text)}>
              {culoare ? (
                <span className={cn('size-2 shrink-0 rounded-full', culoare.fundal)} aria-hidden />
              ) : (
                <User className="size-3" aria-hidden />
              )}
              <span className="font-medium">{programare.executant_nume}</span>
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
          {formateazaBani(pretulProgramarii(servicii))}
        </span>
      </span>
    </button>
  )
}
