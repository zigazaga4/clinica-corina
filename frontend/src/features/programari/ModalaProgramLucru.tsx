import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useProgramLucru, useSeteazaProgramLucru } from '@/app/queries'
import { SelectorUtilizator } from '@/components/selectoare'
import { etichetaZileLucru } from '@/domain/labels'
import type { Uuid, ZileLucru } from '@/domain/types'
import { cn } from '@/lib/cn'
import { addDays, formateazaLuna, laInputDate } from '@/lib/dates'
import { Buton, ButonGrup, Camp, GrupButoane, Modala, useNotificari } from '@/ui'
import { useCuloarePersoana } from './culoriExecutanti'
import { felulZilei } from './programLucru'

/** Zilele săptămânii, de luni — ca în restul calendarului. */
const ZILE_SAPTAMANA = ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D']

type Alegere = ZileLucru | 'fara'

const OPTIUNI: { valoare: Alegere; eticheta: string; ajutor: string }[] = [
  { valoare: 'pare', eticheta: etichetaZileLucru.pare, ajutor: '2, 4, 6…' },
  { valoare: 'impare', eticheta: etichetaZileLucru.impare, ajutor: '1, 3, 5…' },
  { valoare: 'personalizat', eticheta: 'Personalizat', ajutor: 'apeși zilele' },
  { valoare: 'fara', eticheta: 'Fără program', ajutor: 'nimic marcat' },
]

/**
 * Programul de lucru al unei persoane pe o lună: zile pare, impare sau
 * personalizat — zilele apăsate una câte una (cerințele clinicii, 2026-10-01).
 *
 * Trei alegeri, de sus în jos, cum le spune recepția: luna, persoana, zilele.
 * Dedesubt, luna desenată: zilele în care lucrează în culoarea persoanei, cele
 * libere estompate — se vede înainte de salvare exact ce va arăta calendarul.
 */
export function ModalaProgramLucru({
  deschisa,
  onInchide,
  lunaInitiala,
  utilizatorInitial,
}: {
  deschisa: boolean
  onInchide: () => void
  /** Luna afișată în calendar când s-a apăsat butonul. */
  lunaInitiala: Date
  /** Persoana filtrată în calendar, dacă e una. */
  utilizatorInitial: Uuid | null
}) {
  const notificari = useNotificari()
  const seteaza = useSeteazaProgramLucru()

  const [luna, setLuna] = useState(() => primaZi(lunaInitiala))
  const [utilizatorId, setUtilizatorId] = useState<Uuid | null>(utilizatorInitial)
  const [alegere, setAlegere] = useState<Alegere>('fara')
  // Zilele lucrate la „Personalizat”, ca numere ale zilelor din lună.
  const [alese, setAlese] = useState<Set<number>>(() => new Set())
  const [eroare, setEroare] = useState<string | null>(null)

  // La fiecare deschidere, pornește de la ce se vede în calendar.
  useEffect(() => {
    if (!deschisa) return
    setLuna(primaZi(lunaInitiala))
    setUtilizatorId(utilizatorInitial)
    setEroare(null)
  }, [deschisa])

  const zile = useMemo(() => zileleLunii(luna), [luna])
  const deLa = laInputDate(luna)
  const panaLa = laInputDate(zile[zile.length - 1] ?? luna)

  // Programele tuturor pe luna aleasă: precompletează alegerea și arată restul.
  const { data: programe } = useProgramLucru({ de_la: deLa, pana_la: panaLa }, deschisa)
  const existent = programe?.find((p) => p.utilizator_id === utilizatorId && p.luna === deLa)

  // Persoana sau luna schimbată: alegerea pleacă de la ce are deja salvat.
  useEffect(() => {
    setAlegere(existent?.zile ?? 'fara')
    setAlese(new Set(existent?.zile_alese ?? []))
  }, [existent?.id, existent?.zile, existent?.zile_alese?.join(), utilizatorId, deLa])

  const culoare = useCuloarePersoana(utilizatorId)

  const lucreazaIn = (zi: Date): boolean =>
    alegere === 'personalizat'
      ? alese.has(zi.getDate())
      : alegere !== 'fara' && felulZilei(zi) === alegere
  const zileLucrate = zile.filter(lucreazaIn).length

  const alege = (noua: Alegere) => {
    // Din pare / impare spre personalizat: pornește de la zilele acelea, ca
    // „impare, dar nu și pe 15” să fie o singură apăsare.
    if (noua === 'personalizat' && (alegere === 'pare' || alegere === 'impare')) {
      setAlese(new Set(zile.filter((zi) => felulZilei(zi) === alegere).map((zi) => zi.getDate())))
    }
    setAlegere(noua)
  }

  const comutaZiua = (numar: number) => {
    setAlese((precedente) => {
      const urmatoare = new Set(precedente)
      if (urmatoare.has(numar)) urmatoare.delete(numar)
      else urmatoare.add(numar)
      return urmatoare
    })
  }

  const salveaza = async () => {
    if (!utilizatorId) {
      setEroare('Alege persoana.')
      return
    }
    setEroare(null)
    try {
      const rezultat = await seteaza.mutateAsync({
        utilizator_id: utilizatorId,
        luna: deLa,
        zile: alegere === 'fara' ? null : alegere,
        ...(alegere === 'personalizat' ? { zile_alese: [...alese] } : {}),
      })
      const numeLuna = formateazaLuna(luna)
      notificari.succes(
        'Program salvat',
        rezultat
          ? `${rezultat.utilizator_nume} lucrează în ${descriereProgram(rezultat.zile, rezultat.zile_alese)} din ${numeLuna}.`
          : `Fără program în ${numeLuna}.`,
      )
      onInchide()
    } catch (err) {
      setEroare(mesajEroare(err))
    }
  }

  // Golurile de dinaintea zilei 1, ca luna să înceapă sub ziua ei din săptămână.
  const goluri = (luna.getDay() + 6) % 7

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      blocata={seteaza.isPending}
      dimensiune="sm"
      titlu="Program de lucru"
      descriere="Luna, persoana și zilele în care lucrează."
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seteaza.isPending} plin className="sm:w-auto">
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            onClick={() => void salveaza()}
            incarca={seteaza.isPending}
            plin
            className="sm:w-auto"
          >
            Salvează
          </Buton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Camp eticheta="Luna">
          {() => (
            <div className="flex items-center justify-between gap-2 rounded-lg ring-1 ring-line ring-inset">
              <Buton
                varianta="discret"
                dimensiune="icon"
                onClick={() => setLuna((l) => lunaVecina(l, -1))}
                aria-label="Luna anterioară"
              >
                <ChevronLeft className="size-4" />
              </Buton>
              <span className="text-sm font-semibold text-ink capitalize">{formateazaLuna(luna)}</span>
              <Buton
                varianta="discret"
                dimensiune="icon"
                onClick={() => setLuna((l) => lunaVecina(l, 1))}
                aria-label="Luna următoare"
              >
                <ChevronRight className="size-4" />
              </Buton>
            </div>
          )}
        </Camp>

        <SelectorUtilizator
          valoare={utilizatorId}
          onSchimba={(id) => {
            setUtilizatorId(id)
            setEroare(null)
          }}
          eticheta="Persoana"
          obligatoriu
        />

        <Camp eticheta="Lucrează în">
          {() => (
            <GrupButoane eticheta="Zilele de lucru" className="w-full">
              {OPTIUNI.map((o) => (
                <ButonGrup
                  key={o.valoare}
                  activ={alegere === o.valoare}
                  onClick={() => alege(o.valoare)}
                  className="h-auto flex-1 flex-col gap-0 px-1 py-1.5"
                >
                  <span>{o.eticheta}</span>
                  <span className="text-[11px] font-normal text-ink-faint">{o.ajutor}</span>
                </ButonGrup>
              ))}
            </GrupButoane>
          )}
        </Camp>

        {/* Luna desenată: așa va arăta calendarul după salvare. */}
        <div style={culoare?.stil}>
          <div className="grid grid-cols-7 gap-1 text-center">
            {ZILE_SAPTAMANA.map((z) => (
              <span key={z} className="text-[11px] font-medium text-ink-faint">
                {z}
              </span>
            ))}
            {Array.from({ length: goluri }, (_, i) => (
              <span key={`gol-${i}`} />
            ))}
            {zile.map((zi) => {
              const lucru = lucreazaIn(zi)
              const clase = cn(
                'flex h-8 items-center justify-center rounded-md text-[13px] tabular-nums',
                alegere === 'fara'
                  ? 'text-ink-soft'
                  : lucru
                    ? cn('font-semibold text-ink', culoare ? culoare.chip : 'bg-success-soft')
                    : 'text-ink-faint line-through',
              )
              // Personalizat: fiecare zi se apasă — lucrează / liber.
              return alegere === 'personalizat' ? (
                <button
                  key={zi.getDate()}
                  type="button"
                  onClick={() => comutaZiua(zi.getDate())}
                  aria-pressed={lucru}
                  aria-label={`${zi.getDate()} — ${lucru ? 'lucrează' : 'liber'}`}
                  className={cn(
                    clase,
                    'cursor-pointer ring-1 ring-line ring-inset transition-colors hover:ring-ink/30',
                  )}
                >
                  {zi.getDate()}
                </button>
              ) : (
                <span
                  key={zi.getDate()}
                  title={alegere === 'fara' ? undefined : lucru ? 'Lucrează' : 'Liber'}
                  className={clase}
                >
                  {zi.getDate()}
                </span>
              )
            })}
          </div>
          <p className="mt-2 text-[13px] text-ink-faint">
            {alegere === 'fara'
              ? 'Fără program: calendarul nu marchează zilele acestei persoane.'
              : `Lucrează ${zileLucrate} zile, liber ${zile.length - zileLucrate}.`}
            {alegere === 'personalizat' && ' Apasă pe o zi ca s-o treci lucrată sau liberă.'}
          </p>
        </div>

        {/* Ce au ceilalți în luna aceasta — apăsat, trece pe persoana aceea. */}
        {programe && programe.length > 0 && (
          <div className="rounded-xl bg-muted px-3 py-2.5">
            <p className="mb-1 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
              Programul lunii
            </p>
            <ul className="flex flex-col gap-0.5">
              {programe.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setUtilizatorId(p.utilizator_id)}
                    className="text-[13px] text-ink hover:text-primary-600"
                  >
                    <span className="font-medium">{p.utilizator_nume}</span> —{' '}
                    {descriereProgram(p.zile, p.zile_alese)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {eroare && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {eroare}
          </p>
        )}
      </div>
    </Modala>
  )
}

/** „zile impare”, „12 zile alese” — programul, pe scurt. */
function descriereProgram(zile: ZileLucru, alese: number[] | null): string {
  if (zile !== 'personalizat') return etichetaZileLucru[zile].toLowerCase()
  const n = alese?.length ?? 0
  return n === 1 ? 'o zi aleasă' : `${n} zile alese`
}

function primaZi(zi: Date): Date {
  return new Date(zi.getFullYear(), zi.getMonth(), 1)
}

function lunaVecina(luna: Date, pas: -1 | 1): Date {
  return new Date(luna.getFullYear(), luna.getMonth() + pas, 1)
}

function zileleLunii(luna: Date): Date[] {
  const zile: Date[] = []
  for (let zi = luna; zi.getMonth() === luna.getMonth(); zi = addDays(zi, 1)) zile.push(zi)
  return zile
}
