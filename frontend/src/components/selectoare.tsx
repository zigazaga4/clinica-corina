import { useMemo, useState } from 'react'
import { useClienti, useArticole, useUtilizatori } from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import { etichetaTipArticol, tonTipArticol } from '@/domain/labels'
import type { TipArticol, Uuid } from '@/domain/types'
import { useIntarziat } from '@/lib/hooks'
import { formateazaDurata } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { Badge, Combobox, type OptiuneCombobox } from '@/ui'

/*
  Selectoarele de entități.

  Programarea, încasarea și filtrele au nevoie de aceleași trei alegeri: un
  client, un articol, o persoană. Definite aici, fiecare aduce cu ea și regulile
  care nu se văd la prima vedere:

    - clienții arhivați nu se pot programa;
    - conturile dezactivate nu pot fi executanți;
    - doar articolele de tip 'serviciu' se pot programa (CHECK articol_tip).

  Dacă fiecare formular ar chema `useClienti` direct, una dintre reguli ar lipsi
  undeva, iar eroarea ar apărea abia la salvare.
*/

interface ProprietatiComune {
  /**
   * Eticheta câmpului. `null` o suprimă — în barele de filtre, unde
   * substituentul („Toată clinica”) spune deja despre ce filtru este vorba, iar
   * o etichetă deasupra ar dubla înălțimea rândului fără să adauge nimic.
   */
  eticheta?: React.ReactNode
  eroare?: string | null
  obligatoriu?: boolean
  disabled?: boolean
  /** Adaugă opțiunea „toate” — pentru bare de filtre. */
  cuGolire?: boolean
  placeholder?: string
  className?: string
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function SelectorClient({
  valoare,
  onSchimba,
  eticheta = 'Client',
  placeholder = 'Caută după nume sau telefon…',
  ...comune
}: ProprietatiComune & {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
}) {
  const [cautare, setCautare] = useState('')
  const cautareIntarziata = useIntarziat(cautare, 250)

  // Căutarea merge pe server (`q`), nu în listă: clientela unei clinici crește
  // continuu, iar aducerea tuturor fișelor ca să filtrăm local ar fi o cerere
  // tot mai scumpă cu fiecare lună de folosire.
  const { data, isFetching } = useClienti({
    q: cautareIntarziata,
    pe_pagina: 50,
    sortare: 'nume',
  })

  // Clientul deja ales trebuie să rămână vizibil chiar dacă nu apare în
  // rezultatele căutării curente — altfel câmpul s-ar goli vizual la scriere.
  const { data: dateSelectat } = useClienti(
    valoare ? { q: '', pe_pagina: 500 } : {},
  )

  const optiuni = useMemo<OptiuneCombobox<Uuid>[]>(() => {
    const randuri = data?.randuri ?? []
    const lista = randuri.map(
      (c): OptiuneCombobox<Uuid> => ({
        valoare: c.id,
        eticheta: c.nume,
        descriere: c.telefon ?? c.email ?? undefined,
        insemn: c.arhivat_la ? <Badge ton="neutral">arhivat</Badge> : undefined,
      }),
    )

    if (valoare && !lista.some((o) => o.valoare === valoare)) {
      const gasit = dateSelectat?.randuri.find((c) => c.id === valoare)
      if (gasit) {
        lista.unshift({
          valoare: gasit.id,
          eticheta: gasit.nume,
          descriere: gasit.telefon ?? undefined,
        })
      }
    }

    return lista
  }, [data, dateSelectat, valoare])

  return (
    <Combobox
      optiuni={optiuni}
      valoare={valoare}
      onSchimba={onSchimba}
      eticheta={eticheta}
      placeholder={placeholder}
      onCautare={setCautare}
      incarca={isFetching}
      textFaraRezultate="Niciun client găsit"
      {...comune}
    />
  )
}

// ---------------------------------------------------------------------------
// Articol (serviciu / produs)
// ---------------------------------------------------------------------------

export function SelectorArticol({
  valoare,
  onSchimba,
  tip,
  eticheta,
  placeholder = 'Alege…',
  doarActive = true,
  ...comune
}: ProprietatiComune & {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
  /** Restrânge la un singur tip. Programările cer 'serviciu'. */
  tip?: TipArticol
  /** Articolele scoase din ofertă rămân alese pe vânzările vechi, dar nu se pot adăuga. */
  doarActive?: boolean
}) {
  const { data, isPending } = useArticole({
    ...(tip ? { tip } : {}),
    ...(doarActive ? { activ: true } : {}),
  })

  const optiuni = useMemo<OptiuneCombobox<Uuid>[]>(
    () =>
      (data ?? []).map((a) => ({
        valoare: a.id,
        eticheta: a.denumire,
        descriere:
          a.tip === 'serviciu'
            ? `${formateazaDurata(a.durata_minute)} · ${formateazaBani(a.pret_lista)}`
            : formateazaBani(a.pret_lista),
        // Insemnul de tip apare doar în listele mixte; într-una filtrată pe tip
        // ar repeta aceeași informație pe fiecare rând.
        insemn: tip ? undefined : (
          <Badge ton={tonTipArticol[a.tip]}>{etichetaTipArticol[a.tip]}</Badge>
        ),
      })),
    [data, tip],
  )

  return (
    <Combobox
      optiuni={optiuni}
      valoare={valoare}
      onSchimba={onSchimba}
      eticheta={eticheta ?? (tip === 'serviciu' ? 'Serviciu' : 'Serviciu sau produs')}
      placeholder={placeholder}
      incarca={isPending}
      textFaraRezultate="Niciun articol găsit"
      {...comune}
    />
  )
}

// ---------------------------------------------------------------------------
// Utilizator (executant / operator)
// ---------------------------------------------------------------------------

export function SelectorUtilizator({
  valoare,
  onSchimba,
  eticheta = 'Persoana care execută',
  placeholder = 'Alege persoana…',
  ...comune
}: ProprietatiComune & {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
}) {
  const { esteAdministrator } = useAutentificare()

  // GET /utilizatori este rută de administrator (§7). Pentru ceilalți nu o
  // pornim: ar întoarce 403 și ar umple ecranul cu o eroare inutilă. Numele
  // executanților le au oricum din programările hidratate.
  const { data, isPending } = useUtilizatori({ activ: true }, esteAdministrator)

  const optiuni = useMemo<OptiuneCombobox<Uuid>[]>(
    () =>
      (data ?? []).map((u) => ({
        valoare: u.id,
        eticheta: u.nume,
        descriere: u.email,
      })),
    [data],
  )

  return (
    <Combobox
      optiuni={optiuni}
      valoare={valoare}
      onSchimba={onSchimba}
      eticheta={eticheta}
      placeholder={esteAdministrator ? placeholder : 'Disponibil administratorului'}
      disabled={comune.disabled || !esteAdministrator}
      incarca={isPending}
      textFaraRezultate="Niciun cont activ"
      {...comune}
    />
  )
}

/*
  Nu există selector de punct de lucru.

  Clinica are o singură locație, deci nu se alege niciodată una: serverul
  completează punctul implicit la programări și la încasări. Vezi comentariul de
  pe `PunctLucru` în @/domain/types.
*/
