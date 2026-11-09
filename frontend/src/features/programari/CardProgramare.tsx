import { Check, Clock, Layers, User, UserX } from 'lucide-react'
import { etichetaStareProgramare } from '@/domain/labels'
import type { ProgramareDetaliu, StareProgramare } from '@/domain/types'
import { functii } from '@/config/functii'
import { cn } from '@/lib/cn'
import { formateazaInterval, formateazaOra } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { InsemnStareProgramare } from '@/components/insemne'
import { etichetaSedinta, marcajSedinta } from '@/features/tratamente/ProgresTratament'
import { useCuloarePersoana } from './culoriExecutanti'
import { PunctProcedura, useCuloareProgramarii } from './culoriProceduri'
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

/**
 * Starea, ca semn mic lângă oră, pe chipul colorat al persoanei: onorată sau
 * neprezentată. Programată nu are semn — e cazul obișnuit — iar anulata e
 * oricum tăiată.
 */
function SemnStare({ stare }: { stare: StareProgramare }) {
  // Culoarea textului chipului, nu verde/roșu: pe un chip plin verde sau roșu
  // (culoarea unei proceduri) semnul colorat ar dispărea în fundal. Forma —
  // bifă sau om tăiat — spune oricum starea.
  if (stare === 'onorat') return <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden />
  if (stare === 'neprezentat') return <UserX className="size-3 shrink-0" strokeWidth={3} aria-hidden />
  return null
}

// ---------------------------------------------------------------------------
// Forma pentru grilă
// ---------------------------------------------------------------------------

export function ChipProgramare({
  programare,
  servicii = [programare],
  onClick,
  compact = false,
  ampla = false,
  className,
  style,
}: {
  programare: ProgramareDetaliu
  /** Toate serviciile programării; implicit doar `programare`. */
  servicii?: ProgramareDetaliu[]
  onClick: (programare: ProgramareDetaliu) => void
  /** Sub 40px înălțime se afișează doar ora și clientul, pe un rând. */
  compact?: boolean
  /** Peste ~50px înălțime (o oră sau mai mult): trei rânduri — interval, client, procedură. */
  ampla?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const anulata = programare.stare === 'anulat'
  // Culoarea procedurii bate culoarea persoanei (cerința clinicii, 9 nov. 2026).
  const culoare = useCuloareProgramarii(programare, servicii)

  return (
    <button
      type="button"
      onClick={() => onClick(programare)}
      title={`${formateazaInterval(programare.incepe_la, programare.se_termina_la)} · ${programare.client_nume} · ${denumireaServiciilor(servicii)} · ${programare.executant_nume} · ${etichetaStareProgramare[programare.stare]}\nApasă pentru detalii`}
      style={{ ...style, ...culoare?.stil }}
      className={cn(
        'relative flex w-full cursor-pointer flex-col overflow-hidden rounded-md border px-1.5 py-1 text-left',
        // Sub cursor iese în față, cu umbră și contur: se vede că se apasă.
        'transition-all hover:z-10 hover:shadow-(--umbra-card) hover:ring-2 hover:ring-ink/20 focus-visible:z-10',
        // Cu persoana cunoscută, TOT chipul îi poartă culoarea (cerința
        // clinicii), fără bandă pe margine (cerută scoasă, 2026-10-01); starea
        // rămâne un semn mic lângă oră. Fără ea — un cont care nu vede lista
        // persoanelor — chipul rămâne în culoarea stării.
        culoare ? culoare.chip : fundal[programare.stare],
        // Programarea anulată rămâne vizibilă, dar tăiată: locul ei este liber,
        // iar ștergerea din calendar ar ascunde faptul că a existat.
        anulata && 'line-through opacity-70',
        className,
      )}
    >
      <span
        className={cn(
          'flex items-center gap-0.5 truncate text-[11px] leading-tight font-semibold',
          compact && 'text-[10px]',
        )}
      >
        {culoare && <SemnStare stare={programare.stare} />}
        <span className="truncate">
          {/* Ca în softul vechi, intervalul întreg: „14:30–15:30”. Pe chipul
              scund încape doar ora de început, lângă nume. */}
          {formateazaOra(programare.incepe_la)}
          {ampla && `–${formateazaOra(programare.se_termina_la)}`}
          {!ampla && ` ${programare.client_nume}`}
        </span>
      </span>
      {/* Pe chipul înalt, numele clientului are rândul lui: într-o coloană de
          săptămână, „14:30–15:30 Maria Popescu” pe un singur rând ar tăia numele. */}
      {ampla && (
        <span className="truncate text-[11px] leading-tight font-semibold">{programare.client_nume}</span>
      )}
      {!compact && (
        <span className="truncate text-[11px] leading-tight opacity-80">
          {/* „3/8”: a câta ședință a tratamentului e — recepția vede din grilă
              cât mai are clienta de venit. Lângă serviciul ei: o programare
              poate avea ședințe din două tratamente deodată. */}
          {servicii.map((serviciu, i) => {
            const marcaj = functii.tratamente ? marcajSedinta(serviciu) : null
            return (
              <span key={serviciu.id}>
                {i > 0 && ' + '}
                {/* Chipul are o singură culoare; cu mai multe proceduri,
                    fiecare își poartă punctul. */}
                {servicii.length > 1 && <PunctProcedura articolId={serviciu.articol_id} className="mr-1" />}
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
      {/* Fără bandă colorată pe margine (cerută scoasă, 2026-10-01): starea o
          spune însemnul din dreapta. */}
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
          {/* Punctul procedurii: pe listă, culoarea nu acoperă tot rândul. */}
          {servicii.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ' + '}
              <PunctProcedura articolId={s.articol_id} className="mr-1.5 align-middle" />
              {s.articol_denumire}
            </span>
          ))}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
          {servicii.map((serviciu) => {
            const eticheta = functii.tratamente ? etichetaSedinta(serviciu) : null
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
            <span
              style={culoare?.stil}
              className={cn('inline-flex items-center gap-1', culoare && culoare.text)}
            >
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
        {functii.costuri && (
          <span
            className={cn(
              'text-[12px] text-ink-soft tabular-nums',
              anulata && 'text-ink-faint line-through',
            )}
          >
            {formateazaBani(pretulProgramarii(servicii))}
          </span>
        )}
      </span>
    </button>
  )
}
