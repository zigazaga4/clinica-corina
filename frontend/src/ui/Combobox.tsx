import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useInchidereExterna } from '@/lib/hooks'
import { contine } from '@/lib/text'
import { Camp } from './Field'
import { Spinner } from './Spinner'

/*
  Listă de selecție cu căutare.

  Un `<select>` obișnuit devine inutilizabil peste vreo douăzeci de opțiuni, iar
  aplicația are de ales un client dintre câteva sute și un serviciu dintre
  câteva zeci. Aici se scrie și lista se filtrează — exact gestul pe care îl
  face recepția când clientul își spune numele.

  Navigarea de la tastatură este obligatorie: săgeți pentru mutare, Enter pentru
  alegere, Escape pentru închidere. Operatoarea completează formularul fără să
  ia mâna de pe tastatură.
*/

export interface OptiuneCombobox<V extends string> {
  valoare: V
  eticheta: string
  /** Al doilea rând, discret: telefon, preț, durată. */
  descriere?: string
  /** Marcaj în dreapta: „inactiv”, tipul articolului. */
  insemn?: ReactNode
  dezactivata?: boolean
  /**
   * Titlul sub care stă opțiunea în listă — categoria produsului.
   *
   * Opțiunile cu același grup se strâng sub un singur titlu, grupurile în
   * ordinea în care apar prima dată. Căutarea găsește și după grup: „colab”
   * aduce toată lista colaboratorilor.
   */
  grup?: string
}

/**
 * Opțiunile, cu grupurile strânse laolaltă: fiecare grup unde apare prima
 * dată, iar în el ordinea primită. Fără grupuri, lista rămâne neatinsă.
 */
function strangeGrupurile<V extends string>(optiuni: OptiuneCombobox<V>[]): OptiuneCombobox<V>[] {
  if (!optiuni.some((o) => o.grup !== undefined)) return optiuni
  const grupuri = new Map<string | undefined, OptiuneCombobox<V>[]>()
  for (const o of optiuni) {
    const grup = grupuri.get(o.grup)
    if (grup) grup.push(o)
    else grupuri.set(o.grup, [o])
  }
  return [...grupuri.values()].flat()
}

export interface ComboboxProps<V extends string> {
  optiuni: OptiuneCombobox<V>[]
  valoare: V | null
  onSchimba: (valoare: V | null) => void
  eticheta?: ReactNode
  obligatoriu?: boolean
  ajutor?: ReactNode
  eroare?: string | null
  placeholder?: string
  /** Text când nu există nicio potrivire la căutare. */
  textFaraRezultate?: string
  disabled?: boolean
  /** Permite golirea selecției — pentru filtre opționale. */
  cuGolire?: boolean
  /**
   * Ridică textul căutat către apelant, pentru filtrare pe server.
   *
   * Când lipsește, filtrarea se face local peste `optiuni` — potrivit pentru
   * nomenclatoare de zeci de rânduri. Când este dat, apelantul răspunde de
   * filtrare (`optiuni` sosesc deja filtrate) și lista locală nu mai taie nimic;
   * altfel s-ar filtra de două ori, iar rezultatele serverului ar fi ascunse de
   * o a doua trecere care nu vede aceleași câmpuri.
   */
  onCautare?: (text: string) => void
  /** Indicator de încărcare în listă, cât timp sosesc opțiunile de pe server. */
  incarca?: boolean
  /**
   * Creează o opțiune nouă din textul tastat în căutare.
   *
   * Apare ca ultim rând al listei, de îndată ce s-a scris ceva: recepția are
   * clientul la telefon, îi caută numele, nu îl găsește și îl adaugă cu aceeași
   * mișcare, fără să părăsească formularul. Apelantul creează rândul și
   * cheamă apoi `onSchimba` cu identificatorul lui.
   */
  onCreare?: (text: string) => void
  /** Textul rândului de creare; implicit „Adaugă „<text>””. */
  etichetaCreare?: (text: string) => string
  /**
   * Numele câmpului pentru cititorul de ecran, când n-are etichetă vizibilă —
   * în barele de filtre, ca și căutarea de lângă el.
   */
  'aria-label'?: string
  className?: string
}

export function Combobox<V extends string>({
  optiuni,
  valoare,
  onSchimba,
  eticheta,
  obligatoriu,
  ajutor,
  eroare,
  placeholder = 'Alege…',
  textFaraRezultate = 'Nicio potrivire',
  disabled = false,
  cuGolire = false,
  onCautare,
  incarca = false,
  onCreare,
  etichetaCreare = (text) => `Adaugă „${text}”`,
  'aria-label': etichetaAccesibila,
  className,
}: ComboboxProps<V>) {
  const [deschis, setDeschis] = useState(false)
  const [cautare, setCautare] = useState('')
  const [indexActiv, setIndexActiv] = useState(0)

  const textDeCreat = cautare.trim()
  const poateCrea = Boolean(onCreare) && textDeCreat !== ''

  const creeaza = () => {
    if (!poateCrea) return
    onCreare?.(textDeCreat)
    setDeschis(false)
  }

  const ref = useInchidereExterna<HTMLDivElement>(deschis, () => setDeschis(false))
  const refCautare = useRef<HTMLInputElement>(null)
  const refLista = useRef<HTMLUListElement>(null)

  const selectata = optiuni.find((o) => o.valoare === valoare) ?? null

  const filtrate = useMemo(() => {
    // Filtrarea pe server exclude filtrarea locală — vezi `onCautare`.
    if (onCautare || cautare.trim() === '') return strangeGrupurile(optiuni)
    return strangeGrupurile(
      optiuni.filter(
        (o) =>
          contine(o.eticheta, cautare) ||
          contine(o.descriere ?? '', cautare) ||
          contine(o.grup ?? '', cautare),
      ),
    )
  }, [optiuni, cautare, onCautare])

  /*
    La deschidere: golim căutarea și mutăm focalizarea în câmp.

    Efectul depinde NUMAI de `deschis`. Cu `optiuni` printre dependențe, cum
    era, rula și de fiecare dată când soseau rezultate de pe server — adică
    exact după ce s-a tastat ceva — și ștergea textul din câmp în timp ce
    lista arăta rezultatele lui. Căutarea de pe server (`onCautare`) se golește
    și ea: altfel lista s-ar deschide filtrată după ce s-a tastat data trecută,
    cu câmpul gol deasupra.

    `onCautare` lipsește intenționat dintre dependențe: e de obicei un
    `setState` sau o funcție nouă la fiecare randare, iar includerea ei ar
    reporni efectul la orice randare a părintelui.
  */
  useEffect(() => {
    if (!deschis) return
    setCautare('')
    onCautare?.('')
    const cronometru = setTimeout(() => refCautare.current?.focus(), 10)
    return () => clearTimeout(cronometru)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deschis])

  // Evidențierea pornește de pe opțiunea deja aleasă, nu de pe prima din
  // listă, și se reașază când lista se schimbă sub ea.
  useEffect(() => {
    if (!deschis) return
    // Poziția din lista AFIȘATĂ, cu grupurile strânse — nu din cea primită.
    const pozitie = strangeGrupurile(optiuni).findIndex((o) => o.valoare === valoare)
    setIndexActiv(pozitie >= 0 ? pozitie : 0)
  }, [deschis, optiuni, valoare])

  // Ține opțiunea evidențiată în câmpul vizibil la navigarea cu săgeți. După
  // `data-index`, nu după poziția în listă: titlurile de grup și rândul de
  // golire sunt și ele copii ai listei.
  useEffect(() => {
    if (!deschis) return
    const element = refLista.current?.querySelector(`[data-index="${indexActiv}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [indexActiv, deschis])

  const alege = (optiune: OptiuneCombobox<V>) => {
    if (optiune.dezactivata) return
    onSchimba(optiune.valoare)
    setDeschis(false)
  }

  const laTasta = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndexActiv((i) => Math.min(i + 1, filtrate.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndexActiv((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const optiune = filtrate[indexActiv]
      // Fără nicio potrivire, Enter face ce ar face și clicul pe ultimul rând:
      // creează ce s-a tastat. Operatoarea nu ia mâna de pe tastatură.
      if (optiune) alege(optiune)
      else creeaza()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDeschis(false)
    }
  }

  return (
    <Camp
      eticheta={eticheta}
      obligatoriu={obligatoriu}
      ajutor={ajutor}
      eroare={eroare}
      className={className}
    >
      {(id, descrisDe) => (
        <div ref={ref} className="relative">
          <button
            id={id}
            type="button"
            role="combobox"
            aria-label={etichetaAccesibila}
            aria-expanded={deschis}
            aria-haspopup="listbox"
            aria-describedby={descrisDe}
            aria-invalid={eroare ? true : undefined}
            disabled={disabled}
            onClick={() => setDeschis((d) => !d)}
            className={cn(
              'flex h-9.5 w-full items-center gap-2 rounded-(--radius-camp) bg-surface px-3',
              'text-left text-sm ring-1 ring-inset ring-line transition-shadow',
              'focus:ring-2 focus:ring-primary-500 focus:outline-none',
              'disabled:cursor-not-allowed disabled:bg-muted disabled:text-ink-faint',
              eroare && 'ring-danger focus:ring-danger',
            )}
          >
            <span
              className={cn('flex-1 truncate', selectata ? 'text-ink' : 'text-ink-faint')}
            >
              {selectata?.eticheta ?? placeholder}
            </span>
            {selectata?.insemn}
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-ink-faint transition-transform',
                deschis && 'rotate-180',
              )}
              aria-hidden
            />
          </button>

          {deschis && (
            <div
              className={cn(
                'absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line',
                'bg-elevated shadow-(--umbra-ridicat) anim-intrare-modala',
              )}
            >
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search className="size-4 shrink-0 text-ink-faint" aria-hidden />
                <input
                  ref={refCautare}
                  value={cautare}
                  onChange={(e) => {
                    setCautare(e.target.value)
                    setIndexActiv(0)
                    onCautare?.(e.target.value)
                  }}
                  onKeyDown={laTasta}
                  placeholder="Caută…"
                  aria-label="Caută în listă"
                  className="h-9 w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
                />
                {incarca && <Spinner dimensiune="xs" className="shrink-0 text-ink-faint" />}
              </div>

              <ul ref={refLista} role="listbox" className="max-h-64 overflow-y-auto p-1">
                {cuGolire && cautare === '' && (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        onSchimba(null)
                        setDeschis(false)
                      }}
                      className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-ink-faint hover:bg-muted"
                    >
                      {placeholder}
                    </button>
                  </li>
                )}

                {filtrate.length === 0 && (
                  <li className="px-2.5 py-6 text-center text-[13px] text-ink-faint">
                    {incarca ? 'Se caută…' : textFaraRezultate}
                  </li>
                )}

                {filtrate.map((optiune, index) => {
                  const aleasa = optiune.valoare === valoare
                  const grupNou =
                    optiune.grup !== undefined && optiune.grup !== filtrate[index - 1]?.grup
                  return (
                    <Fragment key={optiune.valoare}>
                      {grupNou && (
                        <li
                          role="presentation"
                          className={cn(
                            'px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase',
                            index > 0 && 'mt-1 border-t border-line pt-2.5',
                          )}
                        >
                          {optiune.grup}
                        </li>
                      )}
                      <li data-index={index}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={aleasa}
                          disabled={optiune.dezactivata}
                          onClick={() => alege(optiune)}
                          onMouseEnter={() => setIndexActiv(index)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                            'transition-colors disabled:pointer-events-none disabled:opacity-40',
                            index === indexActiv && 'bg-muted',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            {/*
                              Pe două rânduri, nu tăiată: „Antiage Cremă … 250 ml”
                              și „… 50 ml” ar fi arătat la fel, cu capătul ascuns.
                            */}
                            <span className="line-clamp-2 text-sm text-ink">
                              {optiune.eticheta}
                            </span>
                            {optiune.descriere && (
                              <span className="block truncate text-[12px] text-ink-faint">
                                {optiune.descriere}
                              </span>
                            )}
                          </span>
                          {optiune.insemn}
                          {aleasa && (
                            <Check className="size-4 shrink-0 text-primary-600" aria-hidden />
                          )}
                        </button>
                      </li>
                    </Fragment>
                  )
                })}

                {poateCrea && (
                  <li className={cn(filtrate.length > 0 && 'mt-1 border-t border-line pt-1')}>
                    <button
                      type="button"
                      onClick={creeaza}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
                        'font-medium text-primary-600 transition-colors hover:bg-primary-50',
                      )}
                    >
                      <Plus className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{etichetaCreare(textDeCreat)}</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </Camp>
  )
}
