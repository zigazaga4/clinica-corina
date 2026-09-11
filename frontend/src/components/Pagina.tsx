import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Buton } from '@/ui'

/*
  Structura unui ecran.

  Fiecare pagină are aceeași anatomie: titlu, acțiune principală în dreapta,
  bară de filtre sub el, conținut. Definită aici o singură dată, marginile,
  spațierile și comportamentul pe ecrane mici rămân identice pretutindeni —
  altfel fiecare ecran ar ajunge cu propriul său `p-4` ușor diferit.
*/

/**
 * Nu are lățime maximă, dinadins.
 *
 * A avut: `max-w-7xl`, adică 1280px, plus centrare. Nu se vedea în fereastra
 * implicită de 1440px — mai rămâneau exact câțiva pixeli — dar pe un monitor
 * lat, sau pur și simplu maximizată, aplicația se oprea din crescut și își
 * împărțea restul în două dungi goale, tot mai late. Arăta ca o fereastră care
 * refuză să se facă mare, nu ca o setare de lățime, tocmai fiindcă la
 * dimensiunea din fabrică nu se observa deloc.
 *
 * Aici se măsoară în programări pe zi și rânduri de tabel, nu în rânduri de
 * text: un calendar cu zece coloane și un jurnal cu opt au numai de câștigat
 * din fiecare pixel. Un ecran care chiar vrea măsură de citit și-o cere singur,
 * prin `className` — `cn` este peste `tailwind-merge`, deci o suprascrie.
 */
export function Pagina({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('w-full p-3 sm:p-4 lg:p-6', className)}>{children}</div>
}

export function AntetPagina({
  titlu,
  descriere,
  actiuni,
  inapoi,
  className,
}: {
  titlu: ReactNode
  descriere?: ReactNode
  actiuni?: ReactNode
  /** Afișează săgeata de revenire; `true` întoarce în istoric. */
  inapoi?: string | true
  className?: string
}) {
  const navigate = useNavigate()

  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:flex-row sm:items-start', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {inapoi && (
          <Buton
            varianta="discret"
            dimensiune="icon-sm"
            aria-label="Înapoi"
            onClick={() => (inapoi === true ? navigate(-1) : navigate(inapoi))}
            className="-ml-1.5 mt-0.5 shrink-0"
          >
            <ArrowLeft className="size-4.5" />
          </Buton>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink sm:text-xl">{titlu}</h1>
          {descriere && <p className="mt-0.5 text-[13px] text-ink-faint">{descriere}</p>}
        </div>
      </div>

      {actiuni && <div className="flex shrink-0 items-center gap-2">{actiuni}</div>}
    </div>
  )
}

/**
 * Bara de filtre.
 *
 * Pe ecrane mici filtrele se derulează orizontal, fără bară vizibilă, în loc să
 * se împacheteze pe trei rânduri și să împingă lista sub marginea ecranului.
 */
export function BaraFiltre({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        /*
          Filtrele se așază pe mai multe rânduri, nu pe unul singur derulabil.

          Erau într-o bandă cu derulare orizontală și cu bara de derulare
          ascunsă (`fara-bara`). Pe un ecran de telefon, două filtre de 208px
          nu încap în 412px, așa că al doilea rămânea tăiat de marginea din
          dreapta — fără nicio bară, fără nicio săgeată, fără niciun semn că
          mai există ceva acolo. Arăta exact ca un ecran stricat, iar pe
          calculator, unde nu se trage cu degetul, chiar era: filtrul tăiat nu
          putea fi atins deloc.

          Pe lat rămâne oricum un singur rând — au loc toate.
        */
        'mb-3 flex flex-wrap items-center gap-2',
        '[&>*]:shrink-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Grilă de câmpuri pentru formulare: o coloană pe telefon, două pe desktop. */
export function GrilaFormular({
  children,
  coloane = 2,
  className,
}: {
  children: ReactNode
  coloane?: 1 | 2 | 3
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-3.5',
        coloane === 1 && 'grid-cols-1',
        coloane === 2 && 'grid-cols-1 sm:grid-cols-2',
        coloane === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Câmp care ocupă toată lățimea într-o `GrilaFormular`. */
export function PeToataLatimea({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2 lg:col-span-3">{children}</div>
}
