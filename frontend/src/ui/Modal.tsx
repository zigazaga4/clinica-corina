import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Buton } from './Button'

/*
  Fereastra modală, construită peste elementul nativ `<dialog>`.

  Motivul alegerii: `showModal()` aduce gratuit capturarea focalizării,
  închiderea cu Escape și randarea în „top layer”, deci nicio bară laterală și
  niciun antet lipicios nu o poate acoperi, indiferent de z-index. O
  reimplementare în JavaScript ar fi însemnat capcană de focalizare scrisă de
  mână — locul clasic în care se strecoară erori de accesibilitate.

  Pe ecrane înguste apare ca foaie ancorată jos: degetul ajunge la butoane fără
  să traverseze tot ecranul.
*/

/*
  Blocarea derulării, numărată.

  Modalele se pot suprapune: fereastra de detaliu a unei programări deschide
  peste ea confirmarea „Ședință efectuată”. Cu o simplă atribuire pe
  `document.body.style.overflow`, închiderea celei interioare ar fi deblocat
  fundalul deși cea exterioară era încă deschisă, iar pagina ar fi derulat sub
  ea. Contorul face ca fundalul să se elibereze abia când se închide ULTIMA.
*/
let modaleDeschise = 0

function blocheazaDerularea(): void {
  modaleDeschise++
  document.body.style.overflow = 'hidden'
}

function elibereazaDerularea(): void {
  modaleDeschise = Math.max(0, modaleDeschise - 1)
  if (modaleDeschise === 0) document.body.style.overflow = ''
}

export type DimensiuneModala = 'sm' | 'md' | 'lg' | 'xl'

const latimi: Record<DimensiuneModala, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
}

export interface ModalaProps {
  deschisa: boolean
  onInchide: () => void
  titlu: ReactNode
  descriere?: ReactNode
  children: ReactNode
  /** Bara de acțiuni de jos; rămâne vizibilă la derularea conținutului. */
  subsol?: ReactNode
  dimensiune?: DimensiuneModala
  /**
   * Împiedică închiderea din fundal sau Escape. Se folosește doar cât timp o
   * salvare este în curs — altfel utilizatorul închide fereastra și nu mai știe
   * dacă operațiunea s-a efectuat.
   */
  blocata?: boolean
  className?: string
}

export function Modala({
  deschisa,
  onInchide,
  titlu,
  descriere,
  children,
  subsol,
  dimensiune = 'md',
  blocata = false,
  className,
}: ModalaProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (deschisa && !dialog.open) {
      dialog.showModal()
      blocheazaDerularea()
      return () => elibereazaDerularea()
    }
    if (!deschisa && dialog.open) {
      dialog.close()
    }
    return undefined
    // Curățarea din ramura de deschidere acoperă și demontarea: o modală
    // distrusă cât era deschisă își scade singură contribuția, în loc să lase
    // pagina blocată din derulare pentru totdeauna.
  }, [deschisa])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="titlu-modala"
      onCancel={(e) => {
        // `cancel` este Escape. Îl preluăm ca să treacă prin `onInchide`, altfel
        // starea React ar rămâne „deschisă” după ce dialogul s-a închis.
        e.preventDefault()
        if (!blocata) onInchide()
      }}
      onClick={(e) => {
        // Clic pe `::backdrop`: ținta este chiar elementul dialog, pentru că
        // panoul dinăuntru oprește propagarea prin propriul său container.
        if (e.target === dialogRef.current && !blocata) onInchide()
      }}
      className={cn(
        'm-0 max-h-none w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-black/45',
        // `open:` DOAR pentru `display`, care chiar trebuie să depindă de starea
        // dialogului. Nu și pentru așezare: varianta `open:` se compilează cu un
        // `:is([open], …)` în plus, deci cântărește mai greu decât `sm:`, iar
        // regula de calculator nu învingea niciodată — fereastra rămânea lipită
        // de marginea de jos pe orice lățime. Media query-urile nu adaugă
        // specificitate, așa că ordinea în fișier nu o salva.
        'h-full open:flex open:flex-col justify-end',
        'sm:items-center sm:justify-center sm:p-6',
        'backdrop:backdrop-blur-[2px]',
      )}
    >
      <div
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden bg-elevated shadow-(--umbra-ridicat)',
          'rounded-t-2xl pb-sigur',
          'sm:mx-auto sm:max-h-[85dvh] sm:rounded-2xl sm:pb-0',
          'anim-intrare-foaie sm:anim-intrare-modala',
          latimi[dimensiune],
          className,
        )}
      >
        {/* Mâner vizual pentru foaia de pe telefon. */}
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id="titlu-modala" className="text-base font-semibold text-ink">
              {titlu}
            </h2>
            {descriere && <p className="mt-1 text-[13px] text-ink-faint">{descriere}</p>}
          </div>
          <Buton
            varianta="discret"
            dimensiune="icon-sm"
            onClick={onInchide}
            disabled={blocata}
            aria-label="Închide"
            className="-mt-1 -mr-1.5 shrink-0"
          >
            <X className="size-4.5" />
          </Buton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {subsol && (
          <div
            className={cn(
              'flex flex-col-reverse gap-2 border-t border-line bg-surface px-5 py-3.5',
              'sm:flex-row sm:justify-end',
            )}
          >
            {subsol}
          </div>
        )}
      </div>
    </dialog>
  )
}

/**
 * Confirmare pentru acțiunile care nu se pot desface.
 *
 * Există ca piesă separată pentru că altfel fiecare ecran și-ar scrie propria
 * variantă, iar formularea, tonul butonului și comportamentul la eroare ar
 * diferi de la o ștergere la alta.
 */
export function ModalaConfirmare({
  deschisa,
  onInchide,
  onConfirma,
  titlu,
  mesaj,
  etichetaConfirmare = 'Confirmă',
  periculoasa = false,
  inCurs = false,
}: {
  deschisa: boolean
  onInchide: () => void
  onConfirma: () => void
  titlu: ReactNode
  mesaj: ReactNode
  etichetaConfirmare?: string
  periculoasa?: boolean
  inCurs?: boolean
}) {
  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      titlu={titlu}
      dimensiune="sm"
      blocata={inCurs}
      subsol={
        <>
          <Buton onClick={onInchide} disabled={inCurs} className="sm:w-auto" plin>
            Renunță
          </Buton>
          <Buton
            varianta={periculoasa ? 'pericol' : 'primar'}
            onClick={onConfirma}
            incarca={inCurs}
            className="sm:w-auto"
            plin
          >
            {etichetaConfirmare}
          </Buton>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">{mesaj}</p>
    </Modala>
  )
}
