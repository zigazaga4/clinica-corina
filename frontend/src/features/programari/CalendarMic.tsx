import { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  formateazaLuna,
  formateazaZiScurt,
  intervalPentruVedere,
  isSameDay,
  isToday,
} from '@/lib/dates'
import { Buton } from '@/ui'

/**
 * Calendarul mic: se alege ziua cu degetul, nu tastând o dată.
 *
 * Până acum, ca să ajungi în 14 octombrie din 11 septembrie trebuia apăsată
 * săgeata de treizeci și trei de ori, sau scrisă data într-un câmp care cere
 * ordinea exactă a cifrelor. Aici se apasă pe zi.
 *
 * Grila are mereu 42 de căsuțe — șase săptămâni întregi — ca înălțimea ei să nu
 * salte la schimbarea lunii, mutând butoanele de sub ea exact când degetul e pe
 * drum spre ele.
 */

export function CalendarMic({
  valoare,
  onAlege,
  className,
}: {
  /** Ziua evidențiată ca aleasă. */
  valoare: Date
  onAlege: (zi: Date) => void
  className?: string
}) {
  const [lunaAfisata, setLunaAfisata] = useState(valoare)

  // Deschis din nou pe altă zi, calendarul trebuie să arate luna acelei zile,
  // nu luna la care fusese lăsat data trecută.
  useEffect(() => setLunaAfisata(valoare), [valoare])

  const { zile } = intervalPentruVedere(lunaAfisata, 'luna')
  const lunaCurenta = lunaAfisata.getMonth()

  const mutaLuna = (pas: -1 | 1) => {
    const d = new Date(lunaAfisata)
    // Ziua 1 înainte de a schimba luna: din 31 martie, `setMonth(-1)` ar fi dat
    // 3 martie, fiindcă februarie nu are 31 de zile.
    d.setDate(1)
    d.setMonth(d.getMonth() + pas)
    setLunaAfisata(d)
  }

  return (
    // Lățime elastică, plafonată: pe telefon se întinde cât ecranul, pe
    // calculator nu se lățește absurd într-o bară largă.
    <div className={cn('w-full max-w-72 select-none', className)}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <Buton dimensiune="icon-sm" onClick={() => mutaLuna(-1)} aria-label="Luna anterioară">
          <ChevronLeft className="size-4" />
        </Buton>
        <span className="text-[13px] font-medium text-ink capitalize">
          {formateazaLuna(lunaAfisata)}
        </span>
        <Buton dimensiune="icon-sm" onClick={() => mutaLuna(1)} aria-label="Luna următoare">
          <ChevronRight className="size-4" />
        </Buton>
      </div>

      {/* Capul de tabel se ia din prima săptămână a grilei, ca ordinea zilelor
          să vină din aceeași sursă ca ele — luni întâi, ca în calendarul
          românesc. */}
      <div className="grid grid-cols-7 gap-0.5">
        {zile.slice(0, 7).map((zi) => (
          <span
            key={`cap-${zi.toISOString()}`}
            className="py-1 text-center text-[11px] font-medium text-ink-faint"
          >
            {formateazaZiScurt(zi)}
          </span>
        ))}

        {zile.map((zi) => {
          const aleasa = isSameDay(zi, valoare)
          const azi = isToday(zi)
          const dinLuna = zi.getMonth() === lunaCurenta
          return (
            <button
              key={zi.toISOString()}
              type="button"
              onClick={() => onAlege(zi)}
              aria-current={aleasa ? 'date' : undefined}
              className={cn(
                'tinta-atingere flex h-8 items-center justify-center rounded-md text-[13px] tabular-nums',
                'transition-colors',
                aleasa
                  ? 'bg-primary-600 font-semibold text-ink-invers'
                  : azi
                    ? 'bg-primary-50 font-semibold text-primary-700'
                    : dinLuna
                      ? 'text-ink hover:bg-muted'
                      : // Zilele din lunile vecine rămân apăsabile: cine caută
                        // 1 octombrie la sfârșitul lui septembrie o vede deja.
                        'text-ink-faint hover:bg-muted',
              )}
            >
              {zi.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Butonul care deschide calendarul, și panoul care se desface sub el.
 *
 * NU este un strat plutitor. Calendarul stă în curgerea normală a paginii și,
 * când apare, împinge în jos ce urmează — filtrele și grila. Un panou plutitor
 * ar fi acoperit tocmai programările pe care omul le compară în timp ce alege
 * ziua, iar pe telefon ar fi ieșit din ecran.
 *
 * Panoul se închide după alegere: spațiul se dă înapoi imediat, fără să mai
 * ceară o apăsare, iar ziua aleasă se vede în calendarul mare.
 */
export function ButonCalendar({
  valoare,
  eticheta,
  deschis,
  onComuta,
  className,
}: {
  valoare: Date
  /** Textul de pe buton; implicit, luna afișată. */
  eticheta?: string
  deschis: boolean
  onComuta: () => void
  className?: string
}) {
  return (
    <Buton
      dimensiune="sm"
      onClick={onComuta}
      aria-expanded={deschis}
      aria-controls="panou-calendar"
      // Deschis, butonul rămâne vizibil apăsat: altfel, cu panoul desfăcut sub
      // el, nu s-ar mai vedea de unde a apărut și cum se închide.
      className={cn(deschis && 'bg-muted text-ink ring-line-strong', className)}
    >
      <CalendarDays className="size-4" />
      <span className="capitalize">{eticheta ?? formateazaLuna(valoare)}</span>
    </Buton>
  )
}

/** Panoul propriu-zis. Se randează separat, ca să stea pe un rând al lui. */
export function PanouCalendar({
  valoare,
  onAlege,
}: {
  valoare: Date
  onAlege: (zi: Date) => void
}) {
  return (
    <div
      id="panou-calendar"
      className="anim-intrare-modala mb-3 flex justify-center rounded-xl border border-line bg-surface p-2 sm:justify-start"
    >
      <CalendarMic valoare={valoare} onAlege={onAlege} />
    </div>
  )
}
