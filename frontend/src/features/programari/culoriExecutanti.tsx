import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { mesajEroare } from '@/api/errors'
import { useModificaUtilizator } from '@/app/queries'
import type { Utilizator, Uuid } from '@/domain/types'
import { cn } from '@/lib/cn'
import { useNotificari } from '@/ui'

/**
 * Cine are programarea, citit din culoare.
 *
 * La recepție lucrează două persoane care își fac programări una alteia. Într-o
 * zi plină, „a cui e ședința de la 14:30” se citea doar deschizând programarea
 * sau apropiind ochii de un nume scris cu 11 pixeli. O bandă colorată răspunde
 * la întrebare de la un metru distanță.
 *
 * Culoarea NU înlocuiește numele, îl dublează: culoarea singură ar fi lăsat pe
 * dinafară pe oricine o distinge greu, iar un calendar tipărit alb-negru ar fi
 * devenit ilizibil. Numele rămâne scris peste tot unde încape.
 */

export interface CuloarePersoana {
  /** Fundal plin — benzi, puncte, pastile. */
  fundal: string
  /** Text colorat, pentru nume pe fundal neutru. */
  text: string
  /** Fundal foarte palid + text colorat, pentru pastila din legendă. */
  pastila: string
  /**
   * Chipul ÎNTREG al programării din calendar: fundal, contur și text lizibil.
   * Clinica a cerut culoarea persoanei pe toată programarea, nu doar pe o bandă.
   */
  chip: string
  /**
   * Variabilele CSS ale unei culori ALESE de persoană (`--persoana`,
   * `--persoana-text`). Se pun pe elementul care poartă clasele de mai sus —
   * sau pe un părinte al lui. Gol la culorile din paletă, care au jetoanele lor.
   */
  stil: React.CSSProperties
  /** Culoarea ca #rrggbb, pentru selectorul de culoare. */
  hex: string
}

/*
  Clasele sunt scrise ÎNTREGI, niciodată compuse (`bg-persoana-${n}`).

  Tailwind își adună utilitarele citind codul sursă la compilare. Un nume de
  clasă construit la execuție nu apare nicăieri în sursă, deci nu ajunge în
  CSS-ul final, iar culoarea ar fi lipsit — exact în producție, unde nimeni nu
  se mai uită cu inspectorul deschis.
*/
const PALETA: CuloarePersoana[] = [
  {
    fundal: 'bg-persoana-1',
    text: 'text-persoana-1',
    pastila: 'bg-persoana-1/12 text-persoana-1',
    chip: 'bg-persoana-1/25 border-persoana-1/60 text-ink',
    stil: {},
    hex: '#8455c6',
  },
  {
    fundal: 'bg-persoana-2',
    text: 'text-persoana-2',
    pastila: 'bg-persoana-2/12 text-persoana-2',
    chip: 'bg-persoana-2/25 border-persoana-2/60 text-ink',
    stil: {},
    hex: '#009192',
  },
  {
    fundal: 'bg-persoana-3',
    text: 'text-persoana-3',
    pastila: 'bg-persoana-3/12 text-persoana-3',
    chip: 'bg-persoana-3/25 border-persoana-3/60 text-ink',
    stil: {},
    hex: '#d17427',
  },
  {
    fundal: 'bg-persoana-4',
    text: 'text-persoana-4',
    pastila: 'bg-persoana-4/12 text-persoana-4',
    chip: 'bg-persoana-4/25 border-persoana-4/60 text-ink',
    stil: {},
    hex: '#c94b8f',
  },
  {
    fundal: 'bg-persoana-5',
    text: 'text-persoana-5',
    pastila: 'bg-persoana-5/12 text-persoana-5',
    chip: 'bg-persoana-5/25 border-persoana-5/60 text-ink',
    stil: {},
    hex: '#4a8c3a',
  },
  {
    fundal: 'bg-persoana-6',
    text: 'text-persoana-6',
    pastila: 'bg-persoana-6/12 text-persoana-6',
    chip: 'bg-persoana-6/25 border-persoana-6/60 text-ink',
    stil: {},
    hex: '#3d6ecb',
  },
]

/**
 * Bejul deschis, cerut anume de clinică.
 *
 * Singura culoare cu fundal și text diferite: bejul destul de deschis cât să se
 * cheme bej nu se poate citi ca text pe alb (motivarea completă stă lângă
 * jetoane, în `index.css`). Pastila are și ea nevoie de mai mult fundal decât
 * celelalte — 12% dintr-un bej deschis, pe alb, nu se mai vede deloc.
 */
const BEJ: CuloarePersoana = {
  fundal: 'bg-persoana-bej',
  text: 'text-persoana-bej-text',
  pastila: 'bg-persoana-bej/45 text-persoana-bej-text dark:bg-persoana-bej/15',
  // Bejul e deja deschis: plin, cu text închis. Pe întunecat, plin ar fi alb.
  chip: 'bg-persoana-bej border-persoana-bej-text/50 text-ink dark:bg-persoana-bej/20',
  stil: {},
  hex: '#ddceaf',
}

/**
 * Culoarea aleasă de persoană, oricare ar fi ea (cerința clinicii, 2026-10-01).
 *
 * Clasele sunt aceleași pentru toate culorile alese și citesc variabilele din
 * `stil`. Textul nu e culoarea goală: un galben deschis ales ca text pe alb nu
 * s-ar citi, așa că se amestecă cu cerneala temei — închis pe fundal deschis,
 * deschis pe fundal întunecat.
 */
function culoareAleasa(hex: string): CuloarePersoana {
  return {
    fundal: 'bg-(--persoana)',
    text: 'text-(--persoana-text)',
    pastila: 'bg-(--persoana)/15 text-(--persoana-text)',
    chip: 'bg-(--persoana)/30 border-(--persoana)/70 text-ink',
    stil: {
      '--persoana': hex,
      '--persoana-text': `color-mix(in oklab, ${hex} 65%, var(--color-ink))`,
    } as React.CSSProperties,
    hex,
  }
}

/**
 * Culori cerute pe nume, care trec înaintea rotației.
 *
 * Cheia e primul cuvânt din nume, cu litere mici: contul se numește azi „Irina”,
 * dar un „Irina P.” de mâine trebuie să rămână tot bej.
 */
const CULORI_PE_NUME: Record<string, CuloarePersoana | undefined> = {
  irina: BEJ,
}

function prenumeMic(nume: string): string {
  return (nume.trim().split(/\s+/)[0] ?? '').toLowerCase()
}

export interface PersoanaColorata {
  id: Uuid
  nume: string
  culoare: CuloarePersoana
}

const Context = createContext<Map<Uuid, PersoanaColorata>>(new Map())

/**
 * Împarte paleta pe conturi.
 *
 * Ordonarea este după data creării contului, nu după nume și nu după `id`.
 * Motivul e stabilitatea: un cont nou se adaugă ÎNTOTDEAUNA la coadă și
 * primește următoarea culoare liberă, fără să le schimbe pe ale celorlalți.
 * După nume, un coleg pe litera A ar fi împins toată clinica pe altă culoare
 * peste noapte; după `id` — care e aleatoriu — la fel.
 *
 * Peste șase conturi culorile se reiau. Este o limită acceptată conștient: o
 * recepție cu șapte persoane simultan are oricum nevoie de filtrul pe persoană,
 * nu de încă o nuanță greu de deosebit de prima.
 *
 * Culorile cerute pe nume sar peste rotație, dar NU consumă locuri din ea:
 * poziția în listă rămâne poziția în paletă, așa că trecerea Irinei pe bej nu
 * schimbă culoarea nimănui altcuiva.
 */
export function FurnizorCulori({
  utilizatori,
  children,
}: {
  utilizatori: Utilizator[] | undefined
  children: ReactNode
}) {
  const harta = useMemo(() => {
    const m = new Map<Uuid, PersoanaColorata>()
    // Numele departajează data: cele două conturi de la deschidere au fost
    // create în aceeași instrucțiune, deci au `creat_la` identic la microsecundă.
    // Fără departajare, ordinea lor ar fi rămas cea în care le întoarce serverul,
    // iar culorile s-ar fi schimbat între ele la prima modificare a acelei liste.
    const ordonati = [...(utilizatori ?? [])].sort(
      (a, b) => a.creat_la.localeCompare(b.creat_la) || a.nume.localeCompare(b.nume),
    )
    ordonati.forEach((u, i) => {
      // Culoarea aleasă de persoană bate tot; altfel cea cerută pe nume, apoi paleta.
      const culoare = u.culoare
        ? culoareAleasa(u.culoare)
        : (CULORI_PE_NUME[prenumeMic(u.nume)] ?? PALETA[i % PALETA.length]!)
      m.set(u.id, { id: u.id, nume: u.nume, culoare })
    })
    return m
  }, [utilizatori])

  return <Context.Provider value={harta}>{children}</Context.Provider>
}

/**
 * Culoarea unei persoane, sau `null` dacă nu se știe.
 *
 * `null` este un răspuns legitim, nu o eroare: lista conturilor este rută de
 * administrator, iar un operator obișnuit nu o poate cere. Atunci calendarul
 * arată exact ca înainte — culoarea e un ajutor în plus, nu o condiție ca
 * ecranul să funcționeze.
 */
export function useCuloarePersoana(id: Uuid | null | undefined): CuloarePersoana | null {
  const harta = useContext(Context)
  if (!id) return null
  return harta.get(id)?.culoare ?? null
}

/** Toate persoanele colorate, în ordinea paletei — pentru legendă. */
export function usePersoaneColorate(): PersoanaColorata[] {
  const harta = useContext(Context)
  return useMemo(() => [...harta.values()], [harta])
}

/**
 * Legenda culorilor — și, în același timp, filtrul rapid pe persoană.
 *
 * Ar fi putut fi doar o listă de pătrățele explicative, dar atunci ar fi ocupat
 * un rând întreg ca să nu facă nimic. Apăsată, pastila filtrează calendarul pe
 * persoana ei; apăsată a doua oară, îl deschide la loc. Este exact drumul pe
 * care îl cere întrebarea „ce am eu azi?”, întrebarea pusă cel mai des.
 */
export function LegendaCulori({
  valoare,
  onSchimba,
}: {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
}) {
  const persoane = usePersoaneColorate()
  if (persoane.length === 0) return null

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filtrează după persoană">
      {persoane.map((p) => {
        const activa = valoare === p.id
        return (
          <span
            key={p.id}
            style={p.culoare.stil}
            className={cn(
              'inline-flex items-center rounded-full text-[12px] font-medium',
              'ring-1 ring-inset transition-colors',
              activa ? `${p.culoare.pastila} ring-current` : 'text-ink-soft ring-line',
            )}
          >
            {/* Punctul colorat deschide selectorul; numele filtrează calendarul. */}
            <AlegereCuloare persoana={p} className="rounded-l-full py-1 pr-1 pl-2" />
            <button
              type="button"
              onClick={() => onSchimba(activa ? null : p.id)}
              aria-pressed={activa}
              className={cn(
                'rounded-r-full py-1 pr-2.5 pl-1 transition-colors',
                !activa && 'hover:bg-muted',
              )}
            >
              {p.nume}
            </button>
          </span>
        )
      })}
    </div>
  )
}

/**
 * Culoarea unei persoane, de schimbat — pentru ecranul Utilizatori. Cere un
 * `FurnizorCulori` deasupra, cu TOATE conturile active: culoarea automată
 * depinde de locul fiecăruia în listă, nu de lista filtrată de pe ecran.
 * Un cont dezactivat nu apare în calendar, deci nu are ce culoare alege.
 */
export function SelectorCuloare({ id }: { id: Uuid }) {
  const persoana = useContext(Context).get(id)
  if (!persoana) return <span className="text-ink-faint">—</span>
  return <AlegereCuloare persoana={persoana} className="w-fit rounded-full p-1" clasaPunct="size-6" />
}

/**
 * Selectorul de culoare al unei persoane — punctul colorat din legendă.
 *
 * Selectorul nativ al sistemului: îl știe oricine, merge cu mouse-ul și cu
 * degetul. Se salvează la ÎNCHIDEREA lui (evenimentul nativ `change`), nu la
 * fiecare nuanță trecută cu mouse-ul — `onChange` din React ar fi trimis zeci
 * de cereri pe secundă cât timp se trage de cursor.
 */
function AlegereCuloare({
  persoana,
  className,
  clasaPunct = 'size-3',
}: {
  persoana: PersoanaColorata
  className?: string
  /** Mărimea punctului colorat. */
  clasaPunct?: string
}) {
  const modifica = useModificaUtilizator()
  const notificari = useNotificari()
  const camp = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const element = camp.current
    if (!element) return
    const salveaza = () => {
      const culoare = element.value.toLowerCase()
      if (culoare === persoana.culoare.hex) return
      modifica.mutate(
        { id: persoana.id, date: { culoare } },
        {
          onSuccess: () => notificari.succes('Culoare schimbată', `${persoana.nume} are acum culoarea nouă.`),
          onError: (err) => notificari.eroare('Culoarea nu a putut fi salvată', mesajEroare(err)),
        },
      )
    }
    element.addEventListener('change', salveaza)
    return () => element.removeEventListener('change', salveaza)
  }, [modifica, notificari, persoana])

  return (
    <label
      title={`Alege culoarea pentru ${persoana.nume}`}
      style={persoana.culoare.stil}
      className={cn('relative flex cursor-pointer items-center hover:bg-muted', className)}
    >
      <span
        aria-hidden
        className={cn(
          'shrink-0 rounded-full ring-1 ring-ink/15',
          clasaPunct,
          persoana.culoare.fundal,
          modifica.isPending && 'animate-pulse',
        )}
      />
      <input
        ref={camp}
        type="color"
        // Necontrolat: valoarea se schimbă liber cât e deschis selectorul.
        defaultValue={persoana.culoare.hex}
        key={persoana.culoare.hex}
        aria-label={`Culoarea pentru ${persoana.nume}`}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  )
}
