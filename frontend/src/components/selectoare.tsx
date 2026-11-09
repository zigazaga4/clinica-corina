import { useMemo, useState } from 'react'
import {
  useClienti,
  useArticole,
  useCreeazaArticol,
  useCreeazaClient,
  useUtilizatori,
} from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import { functii } from '@/config/functii'
import { aceeasiCategorie, comparaCategorii, FARA_CATEGORIE } from '@/domain/categorii'
import { etichetaTipArticol, tonTipArticol } from '@/domain/labels'
import type { TipArticol, Utilizator, Uuid } from '@/domain/types'
import { useIntarziat } from '@/lib/hooks'
import { formateazaDurata } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { Badge, Combobox, useNotificari, type OptiuneCombobox } from '@/ui'

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

  Clientul și articolul se pot și CREA din selector (`cuCreare`), cu numele
  tastat în căutare. Rândul nou intră în listă și rămâne ales, iar restul
  datelor se completează mai târziu, acolo unde le e locul: pe fișă, în
  nomenclator.
*/

/** Durata cu care pornește un serviciu făcut din selector, până o corectează cineva. */
const DURATA_SERVICIU_IMPLICITA = 60

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

/**
 * Ce s-a creat chiar acum, ținut în selector până ajunge și în lista de pe
 * server.
 *
 * `onSchimba(id)` pleacă imediat după creare, dar lista reîncărcată sosește
 * cu o cerere mai târziu; fără rândul acesta, câmpul ar fi arătat o clipă
 * substituentul în locul numelui tocmai adăugat — și recepția ar fi apăsat
 * din nou.
 */
function cuRandulNou<V extends string>(
  lista: OptiuneCombobox<V>[],
  nou: OptiuneCombobox<V> | null,
): OptiuneCombobox<V>[] {
  if (!nou || lista.some((o) => o.valoare === nou.valoare)) return lista
  return [nou, ...lista]
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export function SelectorClient({
  valoare,
  onSchimba,
  eticheta = 'Client',
  placeholder = 'Caută după nume sau telefon…',
  cuCreare = false,
  ...comune
}: ProprietatiComune & {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
  /**
   * Permite crearea unei fișe noi doar cu numele, din textul căutat.
   *
   * Pentru formularul de programare: omul e la telefon și trebuie pus în
   * calendar acum. Telefonul, adresa, data nașterii se completează pe fișă.
   */
  cuCreare?: boolean
}) {
  const [cautare, setCautare] = useState('')
  const cautareIntarziata = useIntarziat(cautare, 250)
  const [creatRecent, setCreatRecent] = useState<OptiuneCombobox<Uuid> | null>(null)

  const creeaza = useCreeazaClient()
  const notificari = useNotificari()

  const creeazaClient = async (nume: string) => {
    try {
      const client = await creeaza.mutateAsync({ nume })
      setCreatRecent({ valoare: client.id, eticheta: client.nume })
      onSchimba(client.id)
      notificari.succes(
        'Client adăugat',
        'Deocamdată doar numele. Telefonul și restul se completează pe fișa lui.',
      )
    } catch (err) {
      notificari.eroare(
        'Clientul nu a putut fi adăugat',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

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

    return cuRandulNou(lista, creatRecent)
  }, [data, dateSelectat, valoare, creatRecent])

  return (
    <Combobox
      optiuni={optiuni}
      valoare={valoare}
      onSchimba={onSchimba}
      eticheta={eticheta}
      placeholder={placeholder}
      onCautare={setCautare}
      incarca={isFetching || creeaza.isPending}
      textFaraRezultate="Niciun client găsit"
      {...(cuCreare
        ? {
            onCreare: (nume: string) => void creeazaClient(nume),
            etichetaCreare: (nume: string) => `Client nou: „${nume}”`,
          }
        : {})}
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
  categorie,
  cuCreare = false,
  ...comune
}: ProprietatiComune & {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
  /** Restrânge la un singur tip. Programările cer 'serviciu'. */
  tip?: TipArticol
  /** Articolele scoase din ofertă rămân alese pe vânzările vechi, dar nu se pot adăuga. */
  doarActive?: boolean
  /**
   * Restrânge la o singură listă de prețuri — vânzarea, la lista din care
   * vinde. `null` = produsele fără categorie; lipsă = toate, grupate.
   *
   * Articolul deja ales rămâne în listă chiar dacă e din alta: o vânzare veche
   * se corectează fără ca linia ei să apară goală. Produsul creat de aici intră
   * direct în această listă, altfel n-ar mai putea fi ales.
   */
  categorie?: string | null
  /**
   * Permite crearea unui articol nou din textul căutat.
   *
   * Cere `tip` — un articol fără tip nu se poate scrie în bază — și rol de
   * administrator, fiindcă POST /articole îi este rezervat (§7). Pentru
   * ceilalți, rândul de creare nu apare deloc: mai bine lipsă decât un buton
   * care răspunde 403.
   */
  cuCreare?: boolean
}) {
  const { esteAdministrator } = useAutentificare()
  const { data, isPending } = useArticole({
    ...(tip ? { tip } : {}),
    ...(doarActive ? { activ: true } : {}),
  })
  const [creatRecent, setCreatRecent] = useState<OptiuneCombobox<Uuid> | null>(null)

  const creeaza = useCreeazaArticol()
  const notificari = useNotificari()
  const poateCrea = cuCreare && tip !== undefined && esteAdministrator

  const creeazaArticol = async (denumire: string) => {
    if (!tip) return
    try {
      // Preț de listă zero și durată standard: nomenclatorul primește rândul,
      // iar valorile adevărate se pun acolo când sunt cunoscute. Prețul unei
      // ședințe se scrie oricum pe programare, deci recepția nu este blocată.
      const articol = await creeaza.mutateAsync({
        tip,
        denumire,
        durata_minute: tip === 'serviciu' ? DURATA_SERVICIU_IMPLICITA : null,
        pret_lista: 0,
        // Doar produsele au categorie (articol_categorie_ck).
        ...(tip === 'produs' && categorie ? { categorie } : {}),
      })
      setCreatRecent({
        valoare: articol.id,
        eticheta: articol.denumire,
        descriere: descriereArticol(articol.tip, articol.durata_minute, articol.pret_lista),
      })
      onSchimba(articol.id)
      notificari.succes(
        `${etichetaTipArticol[tip]} adăugat`,
        !functii.costuri
          ? `Cu durata de ${formateazaDurata(DURATA_SERVICIU_IMPLICITA)} — se corectează în Nomenclator.`
          : tip === 'serviciu'
            ? `Cu ${formateazaDurata(DURATA_SERVICIU_IMPLICITA)} și preț de listă ${formateazaBani(0)} — se corectează în Nomenclator.`
            : `Cu preț de listă ${formateazaBani(0)} — se corectează în Nomenclator.`,
      )
    } catch (err) {
      notificari.eroare(
        'Articolul nu a putut fi adăugat',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

  const optiuni = useMemo<OptiuneCombobox<Uuid>[]>(() => {
    const articole = (data ?? []).filter(
      (a) => categorie === undefined || a.id === valoare || aceeasiCategorie(a.categorie, categorie),
    )
    /*
      Produsele, pe listele lor de prețuri. Aceeași cremă stă și la „Produse
      clienți”, și la „Produse colaboratori”, cu alt preț: fără titlul grupului,
      recepția ar vedea două rânduri identice și ar alege la noroc. Fără nicio
      categorie folosită, lista rămâne simplă, fără titluri. Doar în listele
      de produse: în cele mixte (filtrul din „Încasări”) serviciile își țin
      locul, iar prețul de pe al doilea rând deosebește cele două variante.
      Restrânsă la o singură listă (`categorie`), nu are ce grupa.
    */
    const peCategorii =
      tip === 'produs' && categorie === undefined && articole.some((a) => a.categorie !== null)
    const ordonate = peCategorii
      ? [...articole].sort((a, b) => comparaCategorii(a.categorie, b.categorie))
      : articole
    return cuRandulNou(
      ordonate.map((a) => ({
        valoare: a.id,
        eticheta: a.denumire,
        descriere: descriereArticol(a.tip, a.durata_minute, a.pret_lista),
        // Insemnul de tip apare doar în listele mixte; într-una filtrată pe tip
        // ar repeta aceeași informație pe fiecare rând.
        insemn: tip ? undefined : (
          <Badge ton={tonTipArticol[a.tip]}>{etichetaTipArticol[a.tip]}</Badge>
        ),
        ...(peCategorii ? { grup: a.categorie ?? FARA_CATEGORIE } : {}),
      })),
      creatRecent,
    )
  }, [data, tip, categorie, valoare, creatRecent])

  return (
    <Combobox
      optiuni={optiuni}
      valoare={valoare}
      onSchimba={onSchimba}
      eticheta={eticheta ?? (tip === 'serviciu' ? 'Serviciu' : 'Serviciu sau produs')}
      placeholder={placeholder}
      incarca={isPending || creeaza.isPending}
      textFaraRezultate="Niciun articol găsit"
      {...(poateCrea
        ? {
            onCreare: (denumire: string) => void creeazaArticol(denumire),
            etichetaCreare: (denumire: string) =>
              `${etichetaTipArticol[tip]} nou: „${denumire}”`,
          }
        : {})}
      {...comune}
    />
  )
}

/** Al doilea rând al unui articol în listă: durata și prețul, sau doar prețul. */
function descriereArticol(tip: TipArticol, durata_minute: number | null, pret_lista: number) {
  // Fără costuri (fork-ul simplu) lista nu arată prețuri, doar durata.
  if (!functii.costuri) return tip === 'serviciu' ? formateazaDurata(durata_minute) : ''
  return tip === 'serviciu'
    ? `${formateazaDurata(durata_minute)} · ${formateazaBani(pret_lista)}`
    : formateazaBani(pret_lista)
}

// ---------------------------------------------------------------------------
// Utilizator (executant / operator)
// ---------------------------------------------------------------------------

/**
 * Conturile active pe care persoana autentificată le poate alege.
 *
 * GET /utilizatori este rută de administrator (§7). Pentru ceilalți nu o
 * pornim: ar întoarce 403 și ar umple ecranul cu o eroare inutilă. Numele
 * executanților le au oricum din programările hidratate.
 *
 * Un operator obișnuit se vede pe sine, și numai pe sine: nu poate cere lista
 * conturilor, dar își cunoaște propriul cont — și e singurul pe care are de ce
 * să-l aleagă (programările și le face lui, iar o notiță o pune fie pe numele
 * lui, fie pe toată clinica). Fără rândul acesta, câmpul afișa substituentul
 * chiar și când valoarea era el însuși.
 *
 * Folosit de selectorul de mai jos și de butoanele „pe persoană” din Statistici.
 */
export function useConturiAlese(): { conturi: Utilizator[]; incarca: boolean } {
  const { esteAdministrator, utilizator } = useAutentificare()
  const { data, isPending } = useUtilizatori({ activ: true }, esteAdministrator)
  const conturi = esteAdministrator ? (data ?? []) : utilizator ? [utilizator] : []
  return {
    conturi,
    // O interogare oprită rămâne „pending” la nesfârșit; fără condiție,
    // operatorul ar vedea un indicator de încărcare care nu se termină.
    incarca: esteAdministrator && isPending,
  }
}

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
  const { conturi, incarca } = useConturiAlese()

  const optiuni = useMemo<OptiuneCombobox<Uuid>[]>(
    () =>
      conturi.map((u) => ({
        valoare: u.id,
        eticheta: u.nume,
        descriere: u.email,
      })),
    [conturi],
  )

  return (
    <Combobox
      optiuni={optiuni}
      valoare={valoare}
      onSchimba={onSchimba}
      eticheta={eticheta}
      placeholder={placeholder}
      incarca={incarca}
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
