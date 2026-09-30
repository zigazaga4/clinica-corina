import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Buton } from './Button'
import { AntetCard, Card } from './Card'

/*
  Graficele aplicației — scrise aici, fără bibliotecă.

  Sunt două forme și ajung: coloane în timp (câte o bară pe zi, săptămână sau
  lună) și bare orizontale ordonate (ce serviciu, ce persoană, ce categorie).
  O bibliotecă de grafice ar fi adus zeci de kilobyți și propriile ei culori,
  fonturi și animații, de îmblânzit una câte una ca să semene cu restul
  aplicației.

  Regulile, aceleași peste tot:
  — culorile vin din `--color-grafic-*` (verificate pentru daltonism și
    contrast, pe ambele teme), iar textul NU poartă niciodată culoarea seriei;
  — bare subțiri (cel mult 24px), capătul de date rotunjit, baza dreaptă;
  — liniile de ghidaj sunt fire de un pixel, discrete, niciodată punctate;
  — de la două serii în sus există legendă; o serie singură o numește titlul;
  — fiecare grafic are un tabel geamăn (`CardGrafic`), ca nicio cifră să nu
    depindă de mouse sau de culori.
*/

// ---------------------------------------------------------------------------
// Axa
// ---------------------------------------------------------------------------

/**
 * Gradațiile axei: 0 și pași „rotunzi” (1, 2, 2,5, 5 × 10ⁿ) până peste maxim.
 * Cel mult cinci linii — mai multe fac din ghidaj o grilă care concurează cu
 * datele.
 */
export function gradatii(maxim: number, cate = 4): number[] {
  if (!(maxim > 0)) return [0]
  const brut = maxim / cate
  const putere = 10 ** Math.floor(Math.log10(brut))
  const pas = ([1, 2, 2.5, 5, 10].find((m) => m * putere >= brut) ?? 10) * putere
  const valori: number[] = []
  for (let v = 0; v < maxim + pas / 2 && valori.length <= cate + 1; v += pas) valori.push(v)
  // Ultima gradație trebuie să cuprindă maximul, altfel bara cea mai înaltă iese din grafic.
  if ((valori.at(-1) ?? 0) < maxim) valori.push((valori.at(-1) ?? 0) + pas)
  return valori
}

const formatorAxa = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 })

/**
 * „2.000” sau, când axa trece de zece mii, „2,5 mii” — scurt, ca să nu mănânce
 * lățimea graficului. Unitatea se alege după PLAFONUL axei, nu gradație cu
 * gradație: „7.500” lângă „10 mii” ar fi două feluri de a scrie aceeași scară.
 */
export function formateazaAxa(valoare: number, plafon = valoare): string {
  if (plafon >= 10_000_000) return valoare === 0 ? '0' : `${formatorAxa.format(valoare / 1_000_000)} mil.`
  if (plafon >= 10_000) return valoare === 0 ? '0' : `${formatorAxa.format(valoare / 1000)} mii`
  return formatorAxa.format(valoare)
}

// ---------------------------------------------------------------------------
// Coloane în timp
// ---------------------------------------------------------------------------

export interface SerieGrafic {
  cheie: string
  eticheta: string
  /** O culoare de grafic: `var(--color-grafic-1)`. Niciodată o culoare de stare. */
  culoare: string
}

export interface PunctGrafic {
  cheie: string
  /** Eticheta de sub bară — scurtă: „12”, „sept.”. */
  eticheta: string
  /** Titlul din fereastra de detaliu: „vineri, 12 septembrie”. */
  titlu: string
  valori: Record<string, number>
  /** Rânduri în plus în fereastra de detaliu — de pildă profitul zilei. */
  extra?: { eticheta: string; valoare: string }[]
}

/**
 * Coloane grupate: câte o bară pe serie, în fiecare perioadă.
 *
 * Trecând cu mouse-ul — sau cu săgețile, după ce graficul primește focus — se
 * deschide detaliul perioadei, cu TOATE seriile ei deodată: cine citește nu
 * trebuie să nimerească o bară de patru pixeli ca să afle o sumă.
 */
export function GraficColoane({
  serii,
  puncte,
  formateaza,
  descriere,
  inaltime = 200,
}: {
  serii: SerieGrafic[]
  puncte: PunctGrafic[]
  /** Valorile din fereastra de detaliu. */
  formateaza: (valoare: number) => string
  /** Ce arată graficul, pentru cititorul de ecran. */
  descriere: string
  /** Înălțimea zonei cu bare, în pixeli; etichetele de dedesubt se adaugă. */
  inaltime?: number
}) {
  const [activ, setActiv] = useState<number | null>(null)
  const idDetaliu = useId()

  const maxim = Math.max(0, ...puncte.flatMap((p) => serii.map((s) => p.valori[s.cheie] ?? 0)))
  const axa = gradatii(maxim)
  const plafon = axa.at(-1) || 1
  // Etichete de axă cât încap: una din câteva, la intervale egale.
  const dinCate = Math.max(1, Math.ceil(puncte.length / 10))

  const muta = (e: KeyboardEvent<HTMLDivElement>) => {
    const ultim = puncte.length - 1
    const urmator: Record<string, number> = {
      ArrowRight: Math.min(ultim, (activ ?? -1) + 1),
      ArrowLeft: Math.max(0, (activ ?? ultim + 1) - 1),
      Home: 0,
      End: ultim,
    }
    if (e.key in urmator) {
      e.preventDefault()
      setActiv(urmator[e.key] ?? null)
    } else if (e.key === 'Escape') {
      setActiv(null)
    }
  }

  const punctActiv = activ === null ? null : puncte[activ]

  return (
    <div className="min-w-0">
      {serii.length > 1 && <Legenda serii={serii} />}

      {/* `pt-2`: eticheta gradației de sus stă pe linia ei, pe jumătate deasupra. */}
      <div className="flex gap-2 pt-2">
        {/* Axa valorilor. Etichetele stau pe liniile lor, aliniate la dreapta. */}
        <div className="relative w-12 shrink-0" style={{ height: inaltime }} aria-hidden>
          {axa.map((v) => (
            <span
              key={v}
              className="absolute right-0 translate-y-1/2 text-[11px] whitespace-nowrap text-ink-faint tabular-nums"
              style={{ bottom: `${(v / plafon) * 100}%` }}
            >
              {formateazaAxa(v, plafon)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            role="group"
            aria-label={descriere}
            aria-describedby={punctActiv ? idDetaliu : undefined}
            tabIndex={0}
            onKeyDown={muta}
            onFocus={() => setActiv((a) => a ?? puncte.length - 1)}
            onBlur={() => setActiv(null)}
            onPointerLeave={() => setActiv(null)}
            className="relative flex rounded-sm outline-offset-4"
            style={{ height: inaltime }}
          >
            {/* Liniile de ghidaj: fire, sub bare. Baza, un ton mai apăsat. */}
            {axa.map((v) => (
              <span
                key={v}
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-x-0 h-px',
                  v === 0 ? 'bg-line-strong' : 'bg-line',
                )}
                style={{ bottom: `${(v / plafon) * 100}%` }}
              />
            ))}

            {puncte.map((punct, i) => (
              <div
                key={punct.cheie}
                onPointerEnter={() => setActiv(i)}
                className={cn(
                  'relative h-full min-w-0 flex-1 transition-colors',
                  activ === i && 'bg-muted/70',
                )}
              >
                {/*
                  Barele stau într-un miez de trei sferturi din lățimea
                  perioadei; restul rămâne aer între perioade. Lățimea se dă
                  aici, pe miez, și nu ca `padding` în procente pe perioadă:
                  acela s-ar fi măsurat din lățimea ÎNTREGULUI grafic și ar fi
                  strivit barele la doi pixeli.
                */}
                <div className="mx-auto flex h-full w-3/4 items-end justify-center gap-[2px]">
                  {serii.map((serie) => {
                    const valoare = punct.valori[serie.cheie] ?? 0
                    return (
                      <span
                        key={serie.cheie}
                        aria-hidden
                        className="block max-w-6 min-w-px flex-1 rounded-t-[4px]"
                        style={{
                          // O valoare mică, dar nenulă, rămâne vizibilă: doi pixeli.
                          height: valoare > 0 ? `max(2px, ${(valoare / plafon) * 100}%)` : 0,
                          backgroundColor: serie.culoare,
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Etichetele perioadelor, sub bare. */}
          <div className="mt-1.5 flex" aria-hidden>
            {puncte.map((punct, i) => (
              <span
                key={punct.cheie}
                className="min-w-0 flex-1 text-center text-[11px] whitespace-nowrap text-ink-faint"
              >
                {i % dinCate === 0 ? punct.eticheta : ''}
              </span>
            ))}
          </div>

          {punctActiv && activ !== null && (
            <DetaliuPunct
              id={idDetaliu}
              punct={punctActiv}
              serii={serii}
              formateaza={formateaza}
              pozitie={(activ + 0.5) / puncte.length}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Fereastra de deasupra barelor: valorile întâi, apăsat; numele seriei, după. */
function DetaliuPunct({
  id,
  punct,
  serii,
  formateaza,
  pozitie,
}: {
  id: string
  punct: PunctGrafic
  serii: SerieGrafic[]
  formateaza: (valoare: number) => string
  /** Unde e perioada, de la 0 (stânga) la 1 (dreapta). */
  pozitie: number
}) {
  // Lângă margini se lipește de ea, ca să nu iasă din grafic.
  const aliniere =
    pozitie < 0.2 ? 'translate-x-0' : pozitie > 0.8 ? '-translate-x-full' : '-translate-x-1/2'
  return (
    <div
      id={id}
      role="status"
      className={cn(
        'pointer-events-none absolute -top-2 z-10 w-max max-w-64 -translate-y-full rounded-lg',
        'border border-line bg-elevated px-3 py-2 shadow-ridicat',
        aliniere,
      )}
      style={{ left: `${pozitie * 100}%` }}
    >
      <p className="mb-1 text-[12px] font-medium text-ink-soft">{punct.titlu}</p>
      {serii.map((serie) => (
        <p key={serie.cheie} className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: serie.culoare }} />
          <span className="font-semibold text-ink tabular-nums">
            {formateaza(punct.valori[serie.cheie] ?? 0)}
          </span>
          <span className="text-ink-faint">{serie.eticheta}</span>
        </p>
      ))}
      {punct.extra?.map((rand) => (
        <p key={rand.eticheta} className="mt-0.5 flex items-center gap-2 text-[13px]">
          <span aria-hidden className="w-3" />
          <span className="font-semibold text-ink tabular-nums">{rand.valoare}</span>
          <span className="text-ink-faint">{rand.eticheta}</span>
        </p>
      ))}
    </div>
  )
}

function Legenda({ serii }: { serii: SerieGrafic[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {serii.map((serie) => (
        <li key={serie.cheie} className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: serie.culoare }} />
          {serie.eticheta}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Bare orizontale, ordonate
// ---------------------------------------------------------------------------

export interface RandBare {
  cheie: string
  eticheta: string
  valoare: number
  /** Sub nume, discret: „12 ședințe”. */
  detaliu?: string
}

/**
 * Bare orizontale, cea mai mare sus, cu valoarea scrisă la capătul fiecăreia.
 *
 * Toate au aceeași culoare: sunt o singură serie, iar lungimea spune deja cât.
 * Peste `maxim` rânduri, coada se strânge într-unul singur, „Altele”, în gri —
 * o listă de treizeci de bare nu mai compară nimic.
 */
export function GraficBare({
  randuri,
  formateaza,
  culoare = 'var(--color-grafic-1)',
  maxim = 7,
  detaliuAltele,
}: {
  randuri: RandBare[]
  formateaza: (valoare: number) => string
  culoare?: string
  maxim?: number
  /** Textul de sub „Altele”, după câte rânduri strânge. */
  detaliuAltele?: (numar: number) => string
}) {
  const vizibile = randuri.length > maxim + 1 ? randuri.slice(0, maxim) : randuri
  const coada = randuri.slice(vizibile.length)
  const toate: (RandBare & { altele?: boolean })[] =
    coada.length > 0
      ? [
          ...vizibile,
          {
            cheie: '__altele',
            eticheta: 'Altele',
            valoare: coada.reduce((s, r) => s + r.valoare, 0),
            detaliu: detaliuAltele?.(coada.length),
            altele: true,
          },
        ]
      : vizibile
  /*
    Scara o dau rândurile adevărate, nu „Altele”: suma a șaisprezece servicii
    ar fi fost cea mai lungă bară și ar fi turtit exact clasamentul pe care îl
    citește omul. „Altele” își scrie doar suma, fără bară.
  */
  const cel_mai_mare = Math.max(0, ...vizibile.map((r) => r.valoare)) || 1

  return (
    <ul className="space-y-2.5">
      {toate.map((rand) => (
        <li
          key={rand.cheie}
          className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:items-center sm:gap-3"
        >
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink" title={rand.eticheta}>
              {rand.eticheta}
            </p>
            {rand.detaliu && <p className="truncate text-[12px] text-ink-faint">{rand.detaliu}</p>}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {!rand.altele && (
              <span
                aria-hidden
                className="block h-3 shrink-0 rounded-r-[4px]"
                style={{
                  // Loc păstrat pentru sumă, la capătul barei celei mai lungi.
                  width: `calc((100% - 7rem) * ${rand.valoare / cel_mai_mare})`,
                  minWidth: rand.valoare > 0 ? 2 : 0,
                  backgroundColor: culoare,
                }}
              />
            )}
            <span
              className={cn(
                'shrink-0 text-[13px] tabular-nums',
                rand.altele ? 'text-ink-soft' : 'font-medium text-ink',
              )}
            >
              {formateaza(rand.valoare)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Cardul unui grafic, cu tabelul lui geamăn
// ---------------------------------------------------------------------------

export interface TabelGrafic {
  antete: string[]
  /** Celulele fiecărui rând; coloanele din `laDreapta` sunt cifre. */
  randuri: { cheie: string; celule: ReactNode[] }[]
  /** Indicii coloanelor aliniate la dreapta. */
  laDreapta?: number[]
}

/**
 * Un grafic în cardul lui: titlu, descriere și butonul care îl schimbă cu
 * tabelul acelorași cifre — pentru cine nu vede culorile, pentru cine vrea să
 * copieze o sumă exactă, pentru telefonul pe care barele ies prea subțiri.
 */
export function CardGrafic({
  titlu,
  descriere,
  tabel,
  gol,
  incarca = false,
  children,
  className,
}: {
  titlu: ReactNode
  descriere?: ReactNode
  tabel?: TabelGrafic
  /** Arătat în locul graficului când nu există date. */
  gol?: ReactNode
  /** Cifre noi pe drum: graficul vechi rămâne, estompat — fără salt, fără schelet. */
  incarca?: boolean
  children: ReactNode
  className?: string
}) {
  const [caTabel, setCaTabel] = useState(false)
  const arataTabel = caTabel && tabel !== undefined && !gol

  return (
    <Card className={cn('min-w-0', className)}>
      <AntetCard
        titlu={titlu}
        descriere={descriere}
        actiuni={
          tabel &&
          !gol && (
            <Buton
              varianta="discret"
              dimensiune="sm"
              onClick={() => setCaTabel((t) => !t)}
              aria-pressed={caTabel}
            >
              {caTabel ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
              {caTabel ? 'Grafic' : 'Tabel'}
            </Buton>
          )
        }
      />
      <div className={cn('p-4 transition-opacity', incarca && 'opacity-60')}>
        {gol ?? (arataTabel ? <TabelSimplu tabel={tabel} /> : children)}
      </div>
    </Card>
  )
}

function TabelSimplu({ tabel }: { tabel: TabelGrafic }) {
  const dreapta = new Set(tabel.laDreapta ?? [])
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line">
            {tabel.antete.map((antet, i) => (
              <th
                key={antet}
                scope="col"
                className={cn(
                  'px-2 py-1.5 font-medium whitespace-nowrap text-ink-faint',
                  dreapta.has(i) ? 'text-right' : 'text-left',
                )}
              >
                {antet}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabel.randuri.map((rand) => (
            <tr key={rand.cheie} className="border-b border-line last:border-0">
              {rand.celule.map((celula, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-2 py-1.5 text-ink',
                    dreapta.has(i) ? 'text-right whitespace-nowrap tabular-nums' : 'text-left',
                  )}
                >
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
