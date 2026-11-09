import type { ReactNode } from 'react'
import { ArrowDownToLine, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useActualizare, type StareActualizare } from '@/app/actualizare'
import { Buton, Spinner } from '@/ui'

/** De unde se ia instalatorul cu mâna, dacă cel automat nu reușește. */
const ADRESA_MANUALA = 'https://github.com/zigazaga4/clinica-corina-actualizari/releases/latest'

/**
 * Poarta de acces în aplicație.
 *
 * Cât timp nu există o versiune nouă — sau cât timp nu se poate afla — lasă
 * programul să meargă neatins. În clipa în care apare una, îl ÎNLOCUIEȘTE cu
 * ecranul de mai jos.
 *
 * Înlocuire, nu acoperire cu un strat deasupra: un strat lasă dedesubt un
 * program viu, prin care se poate ajunge cu tasta Tab, care își cere mai
 * departe datele de la server și în care un clic nimerit ar putea încă salva
 * ceva. Aici nu mai există nimic dedesubt. Singurul lucru pe care îl mai poate
 * face cineva este să apese butonul.
 */
export function PoartaActualizare({ children }: { children: ReactNode }) {
  const { stare, instaleaza } = useActualizare()

  if (stare.faza === 'in-regula') return <>{children}</>
  return <EcranActualizare stare={stare} instaleaza={instaleaza} />
}

function EcranActualizare({
  stare,
  instaleaza,
}: {
  stare: Exclude<StareActualizare, { faza: 'in-regula' }>
  instaleaza: () => void
}) {
  // Fără `pt-sigur`/`pb-sigur` pe învelișul de mai jos: ecranul apare doar în
  // aplicația de birou, unde marginile de sistem sunt oricum zero, iar clasele
  // acelea s-ar fi bătut cu `py-8` pe aceeași proprietate — cu câștigătorul
  // decis de ordinea din foaia de stil, nu de ordinea scrisă aici.
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="titlu-actualizare"
      className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-canvas px-5 py-8 text-ink"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-(--umbra-ridicat)">
        {stare.faza === 'esec' ? (
          <Esec stare={stare} instaleaza={instaleaza} />
        ) : (
          <Progres stare={stare} instaleaza={instaleaza} />
        )}
      </div>
    </div>
  )
}

function Progres({
  stare,
  instaleaza,
}: {
  stare: Extract<StareActualizare, { faza: 'gasita' | 'descarcare' | 'instalare' }>
  instaleaza: () => void
}) {
  const lucreaza = stare.faza !== 'gasita'

  return (
    <>
      <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300">
        <ArrowDownToLine className="size-5.5" aria-hidden="true" />
      </div>

      <h1 id="titlu-actualizare" className="text-xl font-semibold">
        A apărut o versiune nouă
      </h1>

      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        {stare.faza === 'gasita'
          ? 'Programul nu poate fi folosit până nu este actualizat. Durează mai puțin de un minut și se repornește singur.'
          : 'Nu închideți fereastra. Programul se repornește singur când termină.'}
      </p>

      <dl className="mt-5 rounded-xl bg-muted px-4 py-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-soft">Versiunea nouă</dt>
          <dd className="font-semibold tabular-nums">{stare.versiune}</dd>
        </div>
        {stare.faza === 'gasita' && (
          <div className="mt-1 flex items-baseline justify-between gap-4">
            <dt className="text-ink-faint">Aveți acum</dt>
            <dd className="text-ink-faint tabular-nums">{stare.versiuneCurenta}</dd>
          </div>
        )}
      </dl>

      {stare.faza === 'gasita' && stare.note?.trim() && (
        <p className="mt-4 text-sm leading-relaxed whitespace-pre-line text-ink-soft">
          {stare.note.trim()}
        </p>
      )}

      {lucreaza ? (
        <BaraProgres stare={stare} />
      ) : (
        <Buton className="mt-6" dimensiune="lg" plin onClick={instaleaza}>
          Actualizează acum
        </Buton>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-faint">
        <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
        <span>
          Pachetul este verificat cu semnătura clinicii înainte de instalare. Datele
          dumneavoastră rămân pe server și nu sunt atinse.
        </span>
      </p>
    </>
  )
}

function BaraProgres({
  stare,
}: {
  stare: Extract<StareActualizare, { faza: 'descarcare' | 'instalare' }>
}) {
  const procent = stare.faza === 'descarcare' ? stare.procent : 100
  const text =
    stare.faza === 'instalare'
      ? 'Se instalează…'
      : procent === null
        ? 'Se descarcă…'
        : `Se descarcă… ${procent}%`

  return (
    <div className="mt-6">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={text}
        {...(procent === null
          ? {}
          : { 'aria-valuenow': procent, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
      >
        <div
          className={
            procent === null
              ? 'h-full w-1/3 animate-pulse rounded-full bg-primary-500'
              : 'h-full rounded-full bg-primary-500 transition-[width] duration-200'
          }
          {...(procent === null ? {} : { style: { width: `${procent}%` } })}
        />
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
        <Spinner dimensiune="sm" />
        {text}
      </p>
    </div>
  )
}

function Esec({
  stare,
  instaleaza,
}: {
  stare: Extract<StareActualizare, { faza: 'esec' }>
  instaleaza: () => void
}) {
  return (
    <>
      <div className="mb-5 flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert className="size-5.5" aria-hidden="true" />
      </div>

      <h1 id="titlu-actualizare" className="text-xl font-semibold">
        Actualizarea nu a reușit
      </h1>

      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Cel mai des este de vină internetul. Încercați din nou; dacă tot nu merge,
        instalatorul se poate descărca de mână, de la adresa de mai jos, și pornit
        ca orice alt program.
      </p>

      <p className="mt-4 rounded-xl bg-muted px-4 py-3 font-mono text-xs break-all text-ink-soft">
        {stare.mesaj}
      </p>

      <Buton className="mt-6" dimensiune="lg" plin onClick={instaleaza}>
        Încearcă din nou
      </Buton>

      {/*
        Adresa este scrisă, nu legată. Într-o aplicație de birou o legătură
        obișnuită s-ar deschide ÎN aplicație, înlocuind-o cu o pagină de
        GitHub din care nu se mai iese. Așa poate fi selectată și dusă în
        browser, iar programul rămâne unde e.
      */}
      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        <span className="block">Descărcare manuală:</span>
        <span className="mt-0.5 block font-mono break-all text-ink-soft select-all">
          {ADRESA_MANUALA}
        </span>
      </p>
    </>
  )
}
