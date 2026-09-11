import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Utilizator, Uuid } from '@/domain/types'
import { cn } from '@/lib/cn'

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
}

/*
  Clasele sunt scrise ÎNTREGI, niciodată compuse (`bg-persoana-${n}`).

  Tailwind își adună utilitarele citind codul sursă la compilare. Un nume de
  clasă construit la execuție nu apare nicăieri în sursă, deci nu ajunge în
  CSS-ul final, iar culoarea ar fi lipsit — exact în producție, unde nimeni nu
  se mai uită cu inspectorul deschis.
*/
const PALETA: CuloarePersoana[] = [
  { fundal: 'bg-persoana-1', text: 'text-persoana-1', pastila: 'bg-persoana-1/12 text-persoana-1' },
  { fundal: 'bg-persoana-2', text: 'text-persoana-2', pastila: 'bg-persoana-2/12 text-persoana-2' },
  { fundal: 'bg-persoana-3', text: 'text-persoana-3', pastila: 'bg-persoana-3/12 text-persoana-3' },
  { fundal: 'bg-persoana-4', text: 'text-persoana-4', pastila: 'bg-persoana-4/12 text-persoana-4' },
  { fundal: 'bg-persoana-5', text: 'text-persoana-5', pastila: 'bg-persoana-5/12 text-persoana-5' },
  { fundal: 'bg-persoana-6', text: 'text-persoana-6', pastila: 'bg-persoana-6/12 text-persoana-6' },
]

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
    const ordonati = [...(utilizatori ?? [])].sort((a, b) => a.creat_la.localeCompare(b.creat_la))
    ordonati.forEach((u, i) => {
      m.set(u.id, { id: u.id, nume: u.nume, culoare: PALETA[i % PALETA.length]! })
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
          <button
            key={p.id}
            type="button"
            onClick={() => onSchimba(activa ? null : p.id)}
            aria-pressed={activa}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
              'ring-1 ring-inset transition-colors',
              activa ? `${p.culoare.pastila} ring-current` : 'text-ink-soft ring-line hover:bg-muted',
            )}
          >
            <span className={cn('size-2 shrink-0 rounded-full', p.culoare.fundal)} aria-hidden />
            {p.nume}
          </button>
        )
      })}
    </div>
  )
}
