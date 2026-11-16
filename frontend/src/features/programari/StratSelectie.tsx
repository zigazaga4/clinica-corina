import { useRef, useState, type PointerEvent } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formateazaOra } from '@/lib/dates'
import { PAS_MINUTE, PIXELI_PE_ORA, minutLaPozitie, momentInZi, pozitieVerticala } from './constante'

/*
  Stratul de sub programările unei coloane: locul pe care se apasă pentru o
  programare nouă.

  O apăsare alege sfertul de oră de sub cursor. Apăsat și tras cu mouse-ul,
  alege un interval întreg — de la 10:00 la 11:30 — care se vede cât timp se
  trage. Fără să apese, cursorul poartă cu el sfertul pe care l-ar alege, cu
  ora scrisă: golurile din calendar devin vizibil locuri în care se poate
  programa.

  Stă SUB programări: o programare apăsată își deschide detaliul, ca până acum,
  iar doar spațiul liber dintre ele ajunge aici.

  Pe ecranul tactil, a trage cu degetul înseamnă a derula grila. Acolo
  browserul preia gestul și trimite `pointercancel`, deci contează doar
  atingerea scurtă — care alege sfertul, ca o apăsare.
*/

/** Minute de la începutul grilei; `pana` este exclus. */
interface Interval {
  de: number
  pana: number
}

/** Intervalul dintre două sferturi, oricare ar fi primul: tragerea merge și în sus. */
function intervalIntre(a: number, b: number): Interval {
  return { de: Math.min(a, b), pana: Math.max(a, b) + PAS_MINUTE }
}

export function StratSelectie({
  zi,
  onAlege,
  pixeliPeOra = PIXELI_PE_ORA,
}: {
  /** Ziua coloanei. */
  zi: Date
  /** `sfarsit` este `null` la o simplă apăsare — durata o hotărăște formularul. */
  onAlege: (inceput: Date, sfarsit: Date | null) => void
  /** Înălțimea unei ore în grila de deasupra (ziua mare are ore mai înalte). */
  pixeliPeOra?: number
}) {
  // Ce se desenează: sfertul de sub cursor sau intervalul tras.
  const [umbra, setUmbra] = useState<(Interval & { trasa: boolean }) | null>(null)
  // Tragerea în curs: primul sfert apăsat și cel de acum. Ref, nu stare —
  // se citește în handlere, iar desenul îl face deja `umbra`.
  const tragere = useRef<{ ancora: number; acum: number } | null>(null)

  const sfertLa = (e: PointerEvent<HTMLDivElement>) =>
    minutLaPozitie(e.clientY - e.currentTarget.getBoundingClientRect().top, pixeliPeOra)

  const apasa = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const sfert = sfertLa(e)
    tragere.current = { ancora: sfert, acum: sfert }
    if (e.pointerType !== 'touch') {
      // Captura ține tragerea legată de coloană chiar dacă mouse-ul iese din
      // ea; fără `preventDefault`, tragerea ar selecta textul din jur. Pe
      // atingere, amândouă ar opri derularea grilei.
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    setUmbra({ ...intervalIntre(sfert, sfert), trasa: false })
  }

  const muta = (e: PointerEvent<HTMLDivElement>) => {
    const sfert = sfertLa(e)
    const t = tragere.current
    if (!t) {
      // Doar mouse-ul are „deasupra”; degetul nu arată nimic până nu atinge.
      if (e.pointerType === 'mouse') setUmbra({ de: sfert, pana: sfert + PAS_MINUTE, trasa: false })
      return
    }
    if (e.pointerType === 'touch') return
    t.acum = sfert
    setUmbra({ ...intervalIntre(t.ancora, sfert), trasa: sfert !== t.ancora })
  }

  const elibereaza = () => {
    const t = tragere.current
    tragere.current = null
    setUmbra(null)
    if (!t) return
    const { de, pana } = intervalIntre(t.ancora, t.acum)
    onAlege(momentInZi(zi, de), t.acum === t.ancora ? null : momentInZi(zi, pana))
  }

  const renunta = () => {
    tragere.current = null
    setUmbra(null)
  }

  return (
    // Ascuns cititoarelor de ecran: pentru tastatură există butonul „Programare
    // nouă”, iar o grilă de sute de sferturi apăsabile nu ar fi de folos nimănui.
    <div
      aria-hidden
      data-strat-selectie=""
      className="absolute inset-0 cursor-pointer select-none"
      onPointerDown={apasa}
      onPointerMove={muta}
      onPointerUp={elibereaza}
      onPointerCancel={renunta}
      onPointerLeave={() => {
        if (!tragere.current) setUmbra(null)
      }}
    >
      {umbra && <Umbra zi={zi} pixeliPeOra={pixeliPeOra} {...umbra} />}
    </div>
  )
}

/** Sfertul de sub cursor, sau intervalul tras, cu orele lui. */
function Umbra({
  zi,
  de,
  pana,
  trasa,
  pixeliPeOra,
}: Interval & { zi: Date; trasa: boolean; pixeliPeOra: number }) {
  const inceput = momentInZi(zi, de)
  const sfarsit = momentInZi(zi, pana)
  const sus = pozitieVerticala(inceput, pixeliPeOra)

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-1 flex gap-1 overflow-hidden rounded-md px-1.5',
        'text-[11px] leading-3.5 font-medium text-primary-700 tabular-nums',
        trasa
          ? 'items-start bg-primary-500/15 pt-0.5 ring-1 ring-primary-500/60 ring-inset'
          : 'items-center bg-primary-500/10',
      )}
      style={{ top: sus, height: pozitieVerticala(sfarsit, pixeliPeOra) - sus }}
    >
      <Plus className="size-3 shrink-0" aria-hidden />
      {formateazaOra(inceput)}
      {trasa && ` – ${formateazaOra(sfarsit)}`}
    </div>
  )
}
