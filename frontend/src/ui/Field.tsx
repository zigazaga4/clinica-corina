import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/*
  Controalele de formular.

  Toate împart aceeași bază vizuală (`baza`) și același contract: primesc
  `eroare` și se colorează singure. Componenta `Camp` leagă eticheta, mesajul de
  ajutor și mesajul de eroare de control prin `id` / `aria-describedby`, astfel
  încât niciun formular nu trebuie să se ocupe de accesibilitate pe cont propriu.
*/

const baza = cn(
  'w-full rounded-(--radius-camp) bg-surface px-3 text-sm text-ink',
  'ring-1 ring-inset ring-line transition-shadow duration-150',
  'placeholder:text-ink-faint',
  'focus:ring-2 focus:ring-primary-500 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-faint',
)

const cuEroare = 'ring-danger focus:ring-danger'

// ---------------------------------------------------------------------------
// Învelișul comun
// ---------------------------------------------------------------------------

export interface CampProps {
  eticheta?: ReactNode
  /** Marchează câmpul obligatoriu, vizual și pentru cititoarele de ecran. */
  obligatoriu?: boolean
  ajutor?: ReactNode
  eroare?: string | null
  className?: string
  /** Primește id-ul generat și îl aplică pe control. */
  children: (id: string, descrisDe: string | undefined) => ReactNode
}

export function Camp({
  eticheta,
  obligatoriu,
  ajutor,
  eroare,
  className,
  children,
}: CampProps) {
  const id = useId()
  const idAjutor = `${id}-ajutor`
  const idEroare = `${id}-eroare`
  // Eroarea înlocuiește textul de ajutor: două mesaje sub același câmp se
  // contrazic mai des decât se completează.
  const descrisDe = eroare ? idEroare : ajutor ? idAjutor : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {eticheta && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
          {eticheta}
          {obligatoriu && (
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      {children(id, descrisDe)}

      {eroare ? (
        <p id={idEroare} role="alert" className="text-[13px] text-danger">
          {eroare}
        </p>
      ) : ajutor ? (
        <p id={idAjutor} className="text-[13px] text-ink-faint">
          {ajutor}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controale
// ---------------------------------------------------------------------------

type ProprietatiCamp = Pick<CampProps, 'eticheta' | 'obligatoriu' | 'ajutor' | 'eroare'>

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    ProprietatiCamp {
  /** Pictogramă la începutul câmpului. */
  pictograma?: ReactNode
  /** Conținut la sfârșit: unitate de măsură, buton de golire. */
  sufix?: ReactNode
  className?: string
  containerClassName?: string
  ref?: Ref<HTMLInputElement>
}

export function Input({
  eticheta,
  obligatoriu,
  ajutor,
  eroare,
  pictograma,
  sufix,
  className,
  containerClassName,
  ref,
  ...restul
}: InputProps) {
  return (
    <Camp
      eticheta={eticheta}
      obligatoriu={obligatoriu}
      ajutor={ajutor}
      eroare={eroare}
      className={containerClassName}
    >
      {(id, descrisDe) => (
        <div className="relative flex items-center">
          {pictograma && (
            <span className="pointer-events-none absolute left-3 flex text-ink-faint" aria-hidden>
              {pictograma}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            aria-describedby={descrisDe}
            aria-invalid={eroare ? true : undefined}
            required={obligatoriu}
            className={cn(
              baza,
              'h-9.5',
              pictograma && 'pl-9.5',
              sufix && 'pr-9.5',
              eroare && cuEroare,
              className,
            )}
            {...restul}
          />
          {sufix && (
            <span className="absolute right-2 flex items-center text-ink-faint">{sufix}</span>
          )}
        </div>
      )}
    </Camp>
  )
}

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    ProprietatiCamp {
  className?: string
  containerClassName?: string
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({
  eticheta,
  obligatoriu,
  ajutor,
  eroare,
  className,
  containerClassName,
  rows = 3,
  ref,
  ...restul
}: TextareaProps) {
  return (
    <Camp
      eticheta={eticheta}
      obligatoriu={obligatoriu}
      ajutor={ajutor}
      eroare={eroare}
      className={containerClassName}
    >
      {(id, descrisDe) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-describedby={descrisDe}
          aria-invalid={eroare ? true : undefined}
          required={obligatoriu}
          className={cn(baza, 'resize-y py-2 leading-relaxed', eroare && cuEroare, className)}
          {...restul}
        />
      )}
    </Camp>
  )
}

export interface SelectProps
  extends SelectHTMLAttributes<HTMLSelectElement>,
    ProprietatiCamp {
  children: ReactNode
  className?: string
  containerClassName?: string
  ref?: Ref<HTMLSelectElement>
}

export function Select({
  eticheta,
  obligatoriu,
  ajutor,
  eroare,
  children,
  className,
  containerClassName,
  ref,
  ...restul
}: SelectProps) {
  return (
    <Camp
      eticheta={eticheta}
      obligatoriu={obligatoriu}
      ajutor={ajutor}
      eroare={eroare}
      className={containerClassName}
    >
      {(id, descrisDe) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            aria-describedby={descrisDe}
            aria-invalid={eroare ? true : undefined}
            required={obligatoriu}
            className={cn(
              baza,
              'h-9.5 cursor-pointer appearance-none pr-9',
              eroare && cuEroare,
              className,
            )}
            {...restul}
          >
            {children}
          </select>
          {/* Săgeata proprie: cea implicită diferă vizibil între WebKit și Chromium. */}
          <svg
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-faint"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </Camp>
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  eticheta: ReactNode
  descriere?: ReactNode
  className?: string
  ref?: Ref<HTMLInputElement>
}

export function Checkbox({ eticheta, descriere, className, ref, ...restul }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          'mt-0.5 size-4 shrink-0 cursor-pointer rounded-[5px] border-line bg-surface',
          'text-primary-600 accent-primary-600',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...restul}
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-tight select-none">
        <span className="text-ink">{eticheta}</span>
        {descriere && <span className="mt-0.5 block text-[13px] text-ink-faint">{descriere}</span>}
      </label>
    </div>
  )
}

/** Comutator, pentru setările care se aplică imediat (activ / inactiv). */
export function Comutator({
  eticheta,
  descriere,
  bifat,
  onChange,
  disabled,
  className,
}: {
  eticheta: ReactNode
  descriere?: ReactNode
  bifat: boolean
  onChange: (valoare: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <label htmlFor={id} className="cursor-pointer text-sm select-none">
        <span className="text-ink">{eticheta}</span>
        {descriere && <span className="mt-0.5 block text-[13px] text-ink-faint">{descriere}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={bifat}
        disabled={disabled}
        onClick={() => onChange(!bifat)}
        className={cn(
          'relative inline-flex h-6 w-10.5 shrink-0 cursor-pointer rounded-full',
          'transition-colors duration-200',
          'disabled:cursor-not-allowed disabled:opacity-50',
          bifat ? 'bg-primary-600' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-xs',
            'transition-transform duration-200',
            bifat && 'translate-x-4.5',
          )}
        />
      </button>
    </div>
  )
}
