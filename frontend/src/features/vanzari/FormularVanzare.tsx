import { useId, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { DateLinieVanzare } from '@/api/contract'
import { useAutentificare, useUtilizator } from '@/app/auth'
import { useArticole, useCreeazaVanzare, useModificaVanzare } from '@/app/queries'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import { SelectorArticol, SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import { CATEGORIE_CLIENTI, seVindeClientilor } from '@/domain/categorii'
import type { Articol, Uuid, VanzareDetaliu } from '@/domain/types'
import { dinInputDatetime, formateazaData, laInputDatetime } from '@/lib/dates'
import { useEroriFormular } from '@/lib/formular'
import { uuid } from '@/lib/id'
import { formateazaBani, numarInCamp, parseNumar, sumaTotal, totalLinie } from '@/lib/money'
import { Buton, Camp, Input, Modala, Textarea, useNotificari } from '@/ui'
import { AlegerePlata, starePlata, type StarePlata } from './PlataVanzarii'

/*
  Vânzarea de produse de la recepție — și corectarea uneia existente.

  Aici se vând DOAR produse. Serviciile se încasează din programare, după ce
  ședința e marcată ca efectuată: prețul convenit atunci este singurul adevăr,
  iar o a doua cale de a vinde același serviciu ar produce ședințe plătite de
  două ori și programări rămase veșnic „de plată”.

  Și doar produsele din „Produse clienți” (cerința clinicii, 5 oct. 2026):
  aceeași cremă stă și pe lista colaboratorilor, mai ieftină, iar pe bonul unei
  cliente nu are ce căuta prețul acela. Serverul refuză oricum restul.

  Drumul este cel desenat de clinică: clientul („Maria”), produsele cu prețul
  lor, câte vrei, totalul la final — și „Achitat” sau „Neachitat”. Neachitată,
  suma ajunge la „De plată” pe fișa clientei și se bifează când plătește.

  Aceeași fereastră servește și corecția, pentru că este exact aceeași hârtie
  completată din nou: antetul (cui, când, de cine) și liniile (ce). PATCH-ul
  înlocuiește integral setul de linii, deci formularul trimite ce se vede pe
  ecran, nu o diferență calculată în interfață.
*/

type CampVanzare =
  | 'client_id'
  | 'efectuat_la'
  | 'operator_id'
  | 'nota'
  | 'linii'
  | 'achitat'
  | 'metoda_plata'
  // Erorile venite de la server pentru o linie nu spun CARE linie (§7 întoarce
  // un singur `camp`), așa că le afișăm deasupra editorului de linii.
  | 'cantitate'
  | 'pret_unitar'
  // Validările locale, în schimb, se leagă de cheia liniei — indexul s-ar
  // deplasa la prima ștergere și mesajul ar rămâne pe rândul greșit.
  | `${string}:articol_id`
  | `${string}:cantitate`
  | `${string}:pret_unitar`

interface LinieFormular {
  /** Cheie stabilă de randare: liniile capătă `id` abia după salvare. */
  cheie: string
  articol_id: Uuid | null
  cantitate: string
  pret_unitar: string
  /**
   * Ședința stinsă de linie, la o încasare venită din programare.
   *
   * Formularul nu o poate alege, dar o CARĂ mai departe: PATCH-ul înlocuiește
   * integral liniile, iar fără ea o simplă corecție de preț ar rupe legătura și
   * ar readuce ședința pe lista celor de plată.
   */
  programare_id: Uuid | null
  /**
   * Denumirea și data ședinței, doar pentru afișare.
   *
   * Liniile venite dintr-o ședință se arată blocate, iar selectorul de produse
   * nu le-ar putea reprezenta: el conține numai produse, deci un serviciu ar
   * apărea ca un câmp gol, ca și cum s-ar fi pierdut ceva.
   */
  descriere?: { denumire: string; sedintaDin: string | null }
}

export function FormularVanzare({
  vanzare,
  clientInitial,
  produsInitial,
  onInchide,
}: {
  /** Prezentă = se corectează o vânzare existentă; absentă = una nouă. */
  vanzare?: VanzareDetaliu
  /** Clientul deja ales la o vânzare nouă — deschisă de pe fișa lui. */
  clientInitial?: Uuid
  /** Produsul de pe primul rând — vânzarea pornită din butonul „Vinde” al lui. */
  produsInitial?: Articol
  onInchide: () => void
}) {
  const utilizator = useUtilizator()
  const { esteAdministrator } = useAutentificare()
  const notificari = useNotificari()
  const idFormular = useId()

  const creeaza = useCreeazaVanzare()
  const modifica = useModificaVanzare()
  const seTrimite = creeaza.isPending || modifica.isPending

  const { peCamp, general, goleste, preia, setCamp } = useEroriFormular<CampVanzare>()

  const [clientId, setClientId] = useState<Uuid | null>(
    vanzare?.client_id ?? clientInitial ?? null,
  )
  // Numerar, card sau neachitat. La o vânzare nouă nu e nimic ales: recepția
  // trebuie să spună cum s-a plătit (cerința clinicii, 2026-10-01).
  const [plata, setPlata] = useState<StarePlata | null>(vanzare ? starePlata(vanzare) : null)
  const achitat = plata !== 'neachitat'
  // Un bon care stinge ședințe este chiar plata lor: nu poate rămâne datorie.
  const stingeSedinte = vanzare?.linii.some((l) => l.programare_id !== null) ?? false
  const [operatorId, setOperatorId] = useState<Uuid | null>(vanzare?.operator_id ?? utilizator.id)
  // `efectuat_la` este momentul REAL al încasării, nu al introducerii ei: o
  // plată de dimineață trecută în registru seara trebuie să rămână la ora ei.
  const [efectuatLa, setEfectuatLa] = useState(() =>
    laInputDatetime(vanzare?.efectuat_la ?? new Date()),
  )
  const [nota, setNota] = useState(vanzare?.nota ?? '')
  const [linii, setLinii] = useState<LinieFormular[]>(() =>
    vanzare && vanzare.linii.length > 0
      ? vanzare.linii.map((l) => ({
          cheie: uuid(),
          articol_id: l.articol_id,
          cantitate: numarInCamp(l.cantitate),
          pret_unitar: numarInCamp(l.pret_unitar),
          programare_id: l.programare_id,
          ...(l.programare_id
            ? {
                descriere: {
                  denumire: l.articol_denumire,
                  sedintaDin: l.programare_incepe_la,
                },
              }
            : {}),
        }))
      : [produsInitial && seVindeClientilor(produsInitial) ? linieCuProdus(produsInitial) : linieGoala()],
  )

  // Aceleași opțiuni pe care le încarcă și `SelectorArticol`, deci fără cerere
  // suplimentară; aici sunt necesare doar pentru prețul de listă.
  const { data: articole } = useArticole({ tip: 'produs', activ: true })
  const preturi = useMemo(
    () => new Map((articole ?? []).map((a) => [a.id, a.pret_lista])),
    [articole],
  )

  const total = sumaTotal(linii.map(totalulLiniei))

  const schimbaLinie = (cheie: string, modificari: Partial<LinieFormular>) => {
    setLinii((precedente) =>
      precedente.map((l) => (l.cheie === cheie ? { ...l, ...modificari } : l)),
    )
  }

  const alegeArticol = (cheie: string, articolId: Uuid | null) => {
    const pret = articolId === null ? undefined : preturi.get(articolId)
    // Prețul se COPIAZĂ acum din nomenclator și rămâne editabil. Încasarea
    // păstrează prețul practicat atunci; o actualizare ulterioară a listei de
    // prețuri nu are voie să rescrie încasările deja înregistrate.
    schimbaLinie(cheie, {
      articol_id: articolId,
      ...(pret === undefined ? {} : { pret_unitar: numarInCamp(pret) }),
    })
  }

  const stergeLinie = (cheie: string) => {
    setLinii((precedente) => precedente.filter((l) => l.cheie !== cheie))
  }

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    goleste()

    let valid = true
    if (!clientId) {
      setCamp('client_id', 'Alege clientul.')
      valid = false
    }
    if (efectuatLa === '') {
      setCamp('efectuat_la', 'Completează data și ora încasării.')
      valid = false
    }

    const pregatite: DateLinieVanzare[] = []
    for (const linie of linii) {
      const cantitate = parseNumar(linie.cantitate)
      const pret = parseNumar(linie.pret_unitar)

      if (!linie.articol_id) {
        setCamp(`${linie.cheie}:articol_id`, 'Alege produsul.')
        valid = false
      }
      if (cantitate === null || cantitate <= 0) {
        setCamp(`${linie.cheie}:cantitate`, 'Cantitatea trebuie să fie mai mare ca zero.')
        valid = false
      }
      if (pret === null || pret < 0) {
        setCamp(`${linie.cheie}:pret_unitar`, 'Prețul nu poate fi negativ.')
        valid = false
      }

      if (linie.articol_id && cantitate !== null && cantitate > 0 && pret !== null && pret >= 0) {
        pregatite.push({
          articol_id: linie.articol_id,
          cantitate,
          pret_unitar: pret,
          // Ședința stinsă de linie merge înapoi neatinsă; vezi `LinieFormular`.
          ...(linie.programare_id ? { programare_id: linie.programare_id } : {}),
        })
      }
    }

    if (pregatite.length === 0) {
      setCamp('linii', 'Adaugă cel puțin un produs.')
      valid = false
    }
    if (plata === null) {
      setCamp(
        'metoda_plata',
        stingeSedinte
          ? 'Alege cum s-a plătit: numerar sau card.'
          : 'Alege cum s-a plătit: numerar, card sau neachitat.',
      )
      valid = false
    }
    if (!valid || !clientId || plata === null) return

    const dePlata =
      plata === 'neachitat'
        ? { achitat: false }
        : stingeSedinte
          ? { metoda_plata: plata }
          : { achitat: true, metoda_plata: plata }

    try {
      if (vanzare) {
        await modifica.mutateAsync({
          id: vanzare.id,
          date: {
            client_id: clientId,
            ...(operatorId ? { operator_id: operatorId } : {}),
            efectuat_la: dinInputDatetime(efectuatLa),
            nota: nota.trim() === '' ? null : nota.trim(),
            ...dePlata,
            linii: pregatite,
          },
        })
        notificari.succes('Vânzare corectată', `Total ${formateazaBani(total)}.`)
      } else {
        await creeaza.mutateAsync({
          client_id: clientId,
          ...(operatorId ? { operator_id: operatorId } : {}),
          efectuat_la: dinInputDatetime(efectuatLa),
          nota: nota.trim() === '' ? null : nota.trim(),
          ...dePlata,
          linii: pregatite,
        })
        notificari.succes(
          achitat ? 'Vânzare achitată' : 'Vânzare neachitată',
          achitat
            ? `Total ${formateazaBani(total)} · ${plata === 'card' ? 'card' : 'numerar'}.`
            : `${formateazaBani(total)} rămân de plată, pe fișa clientului.`,
        )
      }
      onInchide()
    } catch (err) {
      preia(err)
    }
  }

  const eroareLinii = peCamp.linii ?? peCamp.cantitate ?? peCamp.pret_unitar ?? null

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      blocata={seTrimite}
      dimensiune="lg"
      titlu={vanzare ? 'Corectează vânzarea' : 'Vânzare de produse'}
      descriere={
        vanzare
          ? 'Corecția înlocuiește integral liniile vânzării și rămâne în jurnalul operațiunilor.'
          : 'Clientul, produsele cu prețul lor și, la final, dacă s-a plătit.'
      }
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seTrimite} plin className="sm:w-auto">
            Renunță
          </Buton>
          <Buton
            type="submit"
            form={idFormular}
            varianta="primar"
            incarca={seTrimite}
            plin
            className="sm:w-auto"
          >
            {vanzare ? 'Salvează corecția' : 'Salvează vânzarea'}
          </Buton>
        </>
      }
    >
      <form id={idFormular} onSubmit={trimite} className="flex flex-col gap-5" noValidate>
        <GrilaFormular>
          {/* „Maria” nouă se adaugă de aici, doar cu numele — ca la programare. */}
          <SelectorClient
            valoare={clientId}
            onSchimba={setClientId}
            obligatoriu
            cuCreare
            eroare={peCamp.client_id ?? null}
          />
          <Input
            type="datetime-local"
            eticheta="Vândută la"
            obligatoriu
            value={efectuatLa}
            onChange={(e) => setEfectuatLa(e.target.value)}
            eroare={peCamp.efectuat_la ?? null}
            ajutor="Momentul real al vânzării, nu cel al introducerii."
          />
          {esteAdministrator ? (
            <SelectorUtilizator
              valoare={operatorId}
              onSchimba={setOperatorId}
              eticheta="Operator"
              eroare={peCamp.operator_id ?? null}
            />
          ) : (
            // Lista de conturi este rută de administrator (§7): pentru ceilalți
            // arătăm operatorul, fără să cerem o listă care ar întoarce 403.
            <Input
              eticheta="Operator"
              value={vanzare?.operator_nume ?? utilizator.nume}
              readOnly
              disabled
              ajutor="Vânzarea se înregistrează pe contul tău."
            />
          )}
          <PeToataLatimea>
            <Textarea
              eticheta="Notă"
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Observații despre vânzare (opțional)"
            />
          </PeToataLatimea>
        </GrilaFormular>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold tracking-wide text-ink-faint uppercase">
              {stingeSedinte ? 'Servicii și produse' : 'Produse vândute'}
            </h3>
            <span className="text-[13px] text-ink-faint tabular-nums">
              {linii.length} {linii.length === 1 ? 'linie' : 'linii'}
            </span>
          </div>

          {eroareLinii && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {eroareLinii}
            </p>
          )}

          {linii.map((linie) => (
            <RandLinie
              key={linie.cheie}
              linie={linie}
              poateSterge={linii.length > 1}
              eroareArticol={peCamp[`${linie.cheie}:articol_id`] ?? null}
              eroareCantitate={peCamp[`${linie.cheie}:cantitate`] ?? null}
              eroarePret={peCamp[`${linie.cheie}:pret_unitar`] ?? null}
              onArticol={(id) => alegeArticol(linie.cheie, id)}
              onCantitate={(valoare) => schimbaLinie(linie.cheie, { cantitate: valoare })}
              onPret={(valoare) => schimbaLinie(linie.cheie, { pret_unitar: valoare })}
              onSterge={() => stergeLinie(linie.cheie)}
            />
          ))}

          <Buton
            onClick={() => setLinii((precedente) => [...precedente, linieGoala()])}
            className="tinta-atingere self-start"
          >
            <Plus className="size-4" />
            Adaugă produs
          </Buton>

          {/*
            Întrebarea „unde sunt serviciile?” apare exact aici, în fața listei
            de produse. Răspunsul stă lângă ea, nu într-un manual pe care nu-l
            citește nimeni la recepție.
          */}
          <p className="text-[13px] text-ink-faint">
            Se vând doar produsele din „{CATEGORIE_CLIENTI}”. Serviciile se încasează din
            programare, după ce ședința e marcată ca efectuată.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted px-3.5 py-3">
          <span className="text-sm font-medium text-ink-soft">Total de plată</span>
          <span className="text-base font-semibold text-ink tabular-nums">
            {formateazaBani(total)}
          </span>
        </div>

        <Camp
          eticheta="Cum s-a plătit?"
          obligatoriu
          eroare={peCamp.metoda_plata ?? peCamp.achitat ?? null}
          ajutor={
            plata === 'neachitat'
              ? 'Suma apare la „De plată” pe fișa clientului. Când plătește, apeși „Numerar” sau „Card”.'
              : undefined
          }
        >
          {() => (
            <AlegerePlata
              valoare={plata}
              onSchimba={setPlata}
              cuNeachitat={!stingeSedinte}
              disabled={seTrimite}
            />
          )}
        </Camp>

        {general && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {general}
          </p>
        )}
      </form>
    </Modala>
  )
}

/**
 * O linie din editor.
 *
 * Pe telefon câmpurile se așază pe rânduri, nu într-un tabel derulabil lateral:
 * recepția completează încasarea cu o singură mână, ținând telefonul.
 */
function RandLinie({
  linie,
  poateSterge,
  eroareArticol,
  eroareCantitate,
  eroarePret,
  onArticol,
  onCantitate,
  onPret,
  onSterge,
}: {
  linie: LinieFormular
  poateSterge: boolean
  eroareArticol: string | null
  eroareCantitate: string | null
  eroarePret: string | null
  onArticol: (id: Uuid | null) => void
  onCantitate: (valoare: string) => void
  onPret: (valoare: string) => void
  onSterge: () => void
}) {
  /*
    Linia venită dintr-o ședință: serviciul și ședința rămân fixe, dar PREȚUL
    se corectează (cerința clinicii, 2026-10-01: 300 → 250). Serverul mută
    același preț și pe programare, ca tratamentul, fișa și Statisticile să
    spună aceeași sumă. Linia nu se șterge de aici: ar readuce ședința pe
    lista celor de plată fără ca nimeni să fi cerut asta.
  */
  if (linie.descriere) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-muted p-3 sm:flex-row sm:items-start sm:gap-2.5">
        <div className="min-w-0 sm:flex-1 sm:pt-1">
          <p className="truncate text-sm font-medium text-ink">{linie.descriere.denumire}</p>
          <p className="mt-0.5 text-[12px] text-ink-faint tabular-nums">
            {linie.descriere.sedintaDin
              ? `Ședința din ${formateazaData(linie.descriere.sedintaDin)}`
              : 'Ședință încasată'}
          </p>
        </div>
        <Input
          eticheta="Preț"
          inputMode="decimal"
          value={linie.pret_unitar}
          onChange={(e) => onPret(e.target.value)}
          eroare={eroarePret}
          sufix={<span className="text-[13px] text-ink-faint">RON</span>}
          className="text-right tabular-nums"
          containerClassName="sm:w-36"
        />
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-2.5">
        {/*
          Doar produsele clienților: serviciile intră în încasare din
          programarea efectuată. Un produs care lipsește din nomenclator
          („Cremă 50 ml”) se adaugă de aici, de administrator, direct pe lista
          clienților; prețul se scrie apoi pe linie.
        */}
        <SelectorArticol
          valoare={linie.articol_id}
          onSchimba={onArticol}
          tip="produs"
          categorie={CATEGORIE_CLIENTI}
          cuCreare
          eticheta="Produs"
          eroare={eroareArticol}
          className="min-w-0 sm:flex-1"
        />

        <div className="flex gap-3 sm:gap-2.5">
          <Input
            eticheta="Cantitate"
            inputMode="decimal"
            value={linie.cantitate}
            onChange={(e) => onCantitate(e.target.value)}
            eroare={eroareCantitate}
            className="text-right tabular-nums"
            containerClassName="flex-1 sm:w-22 sm:flex-none"
          />
          <Input
            eticheta="Preț unitar"
            inputMode="decimal"
            value={linie.pret_unitar}
            onChange={(e) => onPret(e.target.value)}
            eroare={eroarePret}
            className="text-right tabular-nums"
            containerClassName="flex-1 sm:w-28 sm:flex-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3 sm:items-start">
          <div className="flex flex-col gap-1.5 sm:w-28">
            <span className="text-[13px] font-medium text-ink-soft">Total linie</span>
            <span className="flex h-9.5 items-center text-sm font-medium text-ink tabular-nums sm:justify-end">
              {formateazaBani(totalulLiniei(linie))}
            </span>
          </div>
          <Buton
            varianta="discret"
            dimensiune="icon"
            onClick={onSterge}
            disabled={!poateSterge}
            aria-label="Șterge linia"
            className="tinta-atingere text-ink-faint hover:text-danger sm:mt-6.5"
          >
            <Trash2 className="size-4.5" />
          </Buton>
        </div>
      </div>
    </div>
  )
}

function linieGoala(): LinieFormular {
  return { cheie: uuid(), articol_id: null, cantitate: '1', pret_unitar: '', programare_id: null }
}

/** Primul rând deja completat: produsul apăsat, o bucată, la prețul de listă. */
function linieCuProdus(produs: Articol): LinieFormular {
  return {
    ...linieGoala(),
    articol_id: produs.id,
    pret_unitar: numarInCamp(produs.pret_lista),
  }
}

/** Totalul liniei, cu aceeași formulă ca a coloanei generate din bază. */
function totalulLiniei(linie: LinieFormular): number {
  return totalLinie(parseNumar(linie.cantitate) ?? 0, parseNumar(linie.pret_unitar) ?? 0)
}
