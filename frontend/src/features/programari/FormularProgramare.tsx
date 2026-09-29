import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Layers, Plus, Trash2 } from 'lucide-react'
import {
  useArticole,
  useCreeazaProgramare,
  useModificaProgramare,
  usePreturiSugerate,
} from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import type { PretSugerat, ServiciuProgramare, SugestieTratament } from '@/api/contract'
import { SelectorArticol, SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import type { Articol, ProgramareDetaliu, Uuid } from '@/domain/types'
import { addMinutes, dinInputDatetime, laInputDatetime } from '@/lib/dates'
import { useEroriFormular } from '@/lib/formular'
import { uuid } from '@/lib/id'
import { formateazaBani, parseNumar, sumaTotal } from '@/lib/money'
import { plural } from '@/lib/text'
import { Buton, Input, Modala, Textarea, useNotificari } from '@/ui'
import { CampuriInterval, proximulSfertDeOra } from './CampuriInterval'
import type { LocAles } from './locAles'

/** Ce poate greși la un serviciu din listă. */
type CampServiciu = 'articol_id' | 'pret' | 'tratament_id' | 'id'

/**
 * Câmpurile care pot purta o eroare. Cele ale unui serviciu poartă și locul
 * lui în listă — `servicii.2.pret` —, exact cum le trimite serverul.
 */
type CampFormular =
  | 'client_id'
  | 'executant_id'
  | 'incepe_la'
  | 'se_termina_la'
  | 'servicii'
  | `servicii.${number}.${CampServiciu}`

/** Un serviciu, așa cum stă în formular. */
interface RandServiciu {
  /** Cheie locală, stabilă cât e deschis formularul — și după o ștergere. */
  cheie: string
  /** Rândul din bază, la modificare; null = serviciu nou. */
  existent: ProgramareDetaliu | null
  articolId: Uuid | null
  /**
   * Tratamentul în care intră EXPLICIT — ședința pentru care s-a deschis
   * formularul din fișa tratamentului. Serviciul ei nu se schimbă și nu se
   * scoate; celelalte servicii ale programării intră singure unde trebuie.
   */
  tratamentId: Uuid | null
  pret: string
  /**
   * Cât timp operatoarea nu a scris nimic în câmpul de preț, acesta oglindește
   * sugestia serverului. După prima tastare, rămâne ce a scris: o schimbare de
   * client sau de serviciu nu are voie să șteargă o sumă convenită deja.
   */
  pretAtins: boolean
}

/**
 * Ce se completează dinainte când formularul se deschide din fișa unui
 * tratament: clientul și serviciul sunt ale tratamentului și nu se mai aleg.
 */
export interface ProgramareInitiala {
  client_id: Uuid
  articol_id: Uuid
  tratament_id: Uuid
}

export function FormularProgramare({
  deschisa,
  onInchide,
  programare,
  servicii: serviciiExistente,
  loc,
  initial,
}: {
  deschisa: boolean
  onInchide: () => void
  programare?: ProgramareDetaliu | null
  /**
   * Toate serviciile programării de modificat, în ordinea lor. Lipsă = doar
   * `programare`. Formularul le arată pe toate: se pot schimba, scoate sau
   * completa cu altele.
   */
  servicii?: ProgramareDetaliu[]
  /** Locul apăsat în calendar: ziua, ora și ce se mai știe de acolo. */
  loc?: LocAles | null
  /** Ședința următoare a unui tratament — client și serviciu fixate. */
  initial?: ProgramareInitiala | null
}) {
  const esteModificare = Boolean(programare)
  const dinTratament = Boolean(initial) && !esteModificare
  const { utilizator, esteAdministrator } = useAutentificare()
  const notificari = useNotificari()
  const erori = useEroriFormular<CampFormular>()

  const creeaza = useCreeazaProgramare()
  const modifica = useModificaProgramare()
  const seTrimite = creeaza.isPending || modifica.isPending

  const { data: nomenclator } = useArticole({ tip: 'serviciu', activ: true })

  const [clientId, setClientId] = useState<Uuid | null>(null)
  const [randuri, setRanduri] = useState<RandServiciu[]>(() => [randGol()])
  const [executantId, setExecutantId] = useState<Uuid | null>(null)
  const [incepeLa, setIncepeLa] = useState('')
  const [seTerminaLa, setSeTerminaLa] = useState('')
  const [nota, setNota] = useState('')

  // Un interval TRAS în calendar este o alegere, nu o propunere: serviciul ales
  // după aceea nu-i mai mută sfârșitul. O simplă apăsare lasă durata serviciului.
  const intervalTras = useRef(false)

  const sugestii = usePreturiSugerate(clientId, randuri.map((r) => r.articolId))

  // Prețul afișat se DERIVĂ, nu se copiază într-un efect: altfel sugestia
  // sosită după o schimbare de client ar putea suprascrie câmpul cu o
  // întârziere de o randare, exact peste ce tocmai s-a tastat.
  const pretAfisat = (rand: RandServiciu, i: number) => {
    const sugestie = sugestii[i]
    return rand.pretAtins || !sugestie ? rand.pret : laText(sugestie.pret)
  }

  // Reîncărcarea valorilor la fiecare deschidere: dialogul rămâne montat, deci
  // fără asta o a doua deschidere ar arăta datele programării dinainte.
  useEffect(() => {
    if (!deschisa) return
    erori.goleste()
    // La fiecare deschidere, din nou: o corectură deschisă după un interval
    // tras nu are voie să moștenească regula lui.
    intervalTras.current = !programare && Boolean(loc?.sfarsit)

    if (programare) {
      setClientId(programare.client_id)
      setExecutantId(programare.executant_id)
      setIncepeLa(laInputDatetime(programare.incepe_la))
      setSeTerminaLa(laInputDatetime(programare.se_termina_la))
      setNota(programare.nota ?? '')
      // Prețul unui serviciu existent este deja convenit; sugestia nu are ce
      // să corecteze la el, deci câmpul pornește „atins”.
      setRanduri(
        (serviciiExistente?.length ? serviciiExistente : [programare]).map((s) => ({
          cheie: s.id,
          existent: s,
          articolId: s.articol_id,
          tratamentId: null,
          pret: laText(s.pret),
          pretAtins: true,
        })),
      )
      return
    }

    const inceput = loc?.inceput ?? proximulSfertDeOra()
    setClientId(initial?.client_id ?? loc?.clientId ?? null)
    // Cheia primului rând rămâne aceeași: altfel selectorul lui s-ar remonta
    // sub degetul cuiva care tocmai l-a deschis, iar lista s-ar închide singură.
    setRanduri((precedente) => [{
      ...randGol(),
      cheie: precedente[0]?.cheie ?? uuid(),
      ...(initial ? { articolId: initial.articol_id, tratamentId: initial.tratament_id } : {}),
    }])
    // Operatorul se programează cel mai des pe sine; e punctul de plecare cel
    // mai probabil, iar schimbarea costă un clic. Apăsat în coloana altei
    // persoane, locul e al ei — dar numai pentru administrator: un operator
    // obișnuit nu o poate alege (v. SelectorUtilizator), iar câmpul ar fi
    // arătat gol peste un executant pe care nu-l vede.
    setExecutantId(
      (esteAdministrator ? loc?.executantId : null) ?? utilizator?.id ?? null,
    )
    setIncepeLa(laInputDatetime(inceput))
    setSeTerminaLa(laInputDatetime(loc?.sfarsit ?? addMinutes(inceput, 60)))
    setNota('')
    // `erori` lipsește intenționat dintre dependențe: funcțiile lui sunt stabile
    // prin useCallback, iar obiectul se recreează la fiecare randare, deci
    // includerea lui ar reporni efectul și ar șterge ce tocmai s-a completat.
  }, [deschisa, programare, serviciiExistente, loc, initial, utilizator, esteAdministrator])

  /*
    Durata serviciului fixat dinainte.

    Efectul de mai sus nu trece prin `alegeServiciu`, iar nomenclatorul poate
    sosi după deschidere; ora de sfârșit ar rămâne la cele 60 de minute
    implicite. Se aplică o singură dată pe deschidere (`durataAplicata`), ca o
    reîncărcare a nomenclatorului să nu rescrie o oră deja mutată de mână.
  */
  const durataAplicata = useRef(false)
  useEffect(() => {
    if (!deschisa) durataAplicata.current = false
  }, [deschisa])
  useEffect(() => {
    if (!deschisa || !initial || !nomenclator || durataAplicata.current) return
    const serviciu = nomenclator.find((s) => s.id === initial.articol_id)
    if (!serviciu?.durata_minute) return
    durataAplicata.current = true
    if (intervalTras.current) return
    const inceput = loc?.inceput ?? proximulSfertDeOra()
    setSeTerminaLa(laInputDatetime(addMinutes(inceput, serviciu.durata_minute)))
  }, [deschisa, initial, nomenclator, loc])

  /**
   * Lista de servicii se schimbă — și, odată cu ea, ora de sfârșit: cât
   * durează TOATE serviciile, după `durata_minute` din nomenclator.
   *
   * Este singurul loc în care durata din nomenclator ajunge în programare:
   * `programare` nu are coloană de durată, ci două capete de interval. Ora de
   * sfârșit rămâne editabilă — o ședință poate dura mai mult decât standardul.
   * Un interval tras în calendar rămâne cum l-a tras recepția.
   */
  const schimbaServiciile = (urmatoarele: RandServiciu[]) => {
    setRanduri(urmatoarele)
    if (incepeLa === '' || intervalTras.current) return
    const durata = durataServiciilor(urmatoarele, nomenclator)
    if (durata > 0) setSeTerminaLa(laInputDatetime(addMinutes(new Date(incepeLa), durata)))
  }

  const alegeServiciu = (cheie: string, articolId: Uuid | null) =>
    schimbaServiciile(randuri.map((r) => (r.cheie === cheie ? { ...r, articolId } : r)))

  const scoateServiciu = (cheie: string) => {
    // Erorile poartă locul serviciului în listă; după o ștergere, locurile se mută.
    erori.goleste()
    schimbaServiciile(randuri.filter((r) => r.cheie !== cheie))
  }

  const schimbaPretul = (cheie: string, pret: string) =>
    setRanduri((precedente) =>
      precedente.map((r) => (r.cheie === cheie ? { ...r, pret, pretAtins: true } : r)),
    )

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    if (!clientId) return erori.setCamp('client_id', 'Alege clientul.')
    if (!executantId) return erori.setCamp('executant_id', 'Alege persoana care execută.')

    const servicii: ServiciuProgramare[] = []
    for (const [i, rand] of randuri.entries()) {
      if (!rand.articolId) return erori.setCamp(`servicii.${i}.articol_id`, 'Alege serviciul.')
      // Zero este o valoare validă: o ședință oferită gratuit rămâne o ședință
      // efectuată, care trebuie să apară în calendar și în istoric.
      const pret = parseNumar(pretAfisat(rand, i))
      if (pret === null) return erori.setCamp(`servicii.${i}.pret`, 'Completează prețul.')
      if (pret < 0) return erori.setCamp(`servicii.${i}.pret`, 'Prețul nu poate fi negativ.')
      servicii.push({
        ...(rand.existent ? { id: rand.existent.id } : {}),
        articol_id: rand.articolId,
        pret,
        // Din fișa tratamentului, ședința intră EXPLICIT în el; altfel,
        // serverul o pune singur în tratamentul în curs al clientului.
        ...(rand.tratamentId ? { tratament_id: rand.tratamentId } : {}),
      })
    }

    if (incepeLa === '') return erori.setCamp('incepe_la', 'Completează ora de început.')
    if (seTerminaLa === '') return erori.setCamp('se_termina_la', 'Completează ora de sfârșit.')
    if (new Date(seTerminaLa) <= new Date(incepeLa)) {
      return erori.setCamp('se_termina_la', 'Ora de sfârșit trebuie să fie după cea de început.')
    }

    const date = {
      client_id: clientId,
      executant_id: executantId,
      incepe_la: dinInputDatetime(incepeLa),
      se_termina_la: dinInputDatetime(seTerminaLa),
      nota: nota.trim() === '' ? null : nota.trim(),
      servicii,
    }

    try {
      if (programare) {
        await modifica.mutateAsync({ id: programare.id, date })
        notificari.succes('Programare modificată')
      } else {
        const creata = await creeaza.mutateAsync(date)
        notificari.succes(
          'Programare adăugată',
          servicii.length > 1
            ? `${servicii.length} servicii în aceeași programare.`
            : creata.sedinta_nr !== null && creata.tratament_numar_sedinte !== null
              ? `Ședința ${creata.sedinta_nr} din ${creata.tratament_numar_sedinte} a tratamentului.`
              : undefined,
        )
      }
      onInchide()
    } catch (err) {
      // Suprapunerea de interval vine ca 409 fără `camp`, deci ajunge în banda
      // generală — este o eroare despre relația dintre două câmpuri, nu despre
      // unul singur.
      erori.preia(err)
    }
  }

  // Erorile cu un câmp pe care formularul nu-l arată nicăieri — `servicii.0.id`,
  // de pildă — se spun în banda generală, nu se pierd în tăcere.
  const eroareNevazuta = Object.entries(erori.peCamp).find(
    ([camp]) => !CAMPURI_AFISATE.test(camp),
  )?.[1] as string | undefined
  const maiMulte = randuri.length > 1
  const total = sumaTotal(randuri.map((r, i) => parseNumar(pretAfisat(r, i)) ?? 0))

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={esteModificare ? 'Modifică programarea' : 'Programare nouă'}
      descriere={
        esteModificare
          ? 'Mutarea intervalului reprogramează clientul.'
          : 'Doar serviciile pot fi programate; produsele se înregistrează la vânzări.'
      }
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seTrimite} plin className="sm:w-auto">
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            form="formular-programare"
            type="submit"
            incarca={seTrimite}
            plin
            className="sm:w-auto"
          >
            {esteModificare ? 'Salvează' : 'Adaugă programarea'}
          </Buton>
        </>
      }
    >
      <form id="formular-programare" onSubmit={trimite} className="flex flex-col gap-4" noValidate>
        <GrilaFormular coloane={2}>
          {/*
            Clientul nou se face din același câmp, cu numele tastat în căutare.
            Recepția are omul la telefon și vrea să-l pună în calendar acum;
            telefonul, adresa și restul se completează pe fișă, mai târziu.
            Același drum și pentru un serviciu care nu e încă în nomenclator —
            dar acela cere administrator (§7), deci apare doar pentru el.
          */}
          <SelectorClient
            valoare={clientId}
            onSchimba={setClientId}
            obligatoriu
            cuCreare
            disabled={dinTratament}
            eroare={erori.peCamp.client_id ?? null}
          />
          <SelectorUtilizator
            valoare={executantId}
            onSchimba={setExecutantId}
            obligatoriu
            eroare={erori.peCamp.executant_id ?? null}
          />

          {/*
            Serviciile programării — unul sau mai multe, la aceeași venire: o
            manichiură și ședința 3 din 6 de IPL, două ședințe din abonamente
            diferite. Fiecare cu prețul lui și cu ședința lui din tratament;
            ora de sfârșit crește cu durata fiecăruia.
          */}
          <PeToataLatimea>
            <div className="flex flex-col gap-2.5">
              {randuri.map((rand, i) => (
                <RandServiciuFormular
                  key={rand.cheie}
                  rand={rand}
                  index={maiMulte ? i : null}
                  pret={pretAfisat(rand, i)}
                  sugestie={sugestii[i]}
                  // A câta ședință ar fi: sugestia nu știe de ședințele din
                  // același tratament puse mai sus, în aceeași programare.
                  maiDevreme={
                    randuri.slice(0, i).filter((r) => !r.existent && r.articolId === rand.articolId).length
                  }
                  poateFiScos={maiMulte && !rand.tratamentId && !rand.existent?.achitat}
                  eroareServiciu={erori.peCamp[`servicii.${i}.articol_id`] ?? null}
                  eroarePret={erori.peCamp[`servicii.${i}.pret`] ?? null}
                  eroareTratament={erori.peCamp[`servicii.${i}.tratament_id`] ?? null}
                  onServiciu={(articolId) => alegeServiciu(rand.cheie, articolId)}
                  onPret={(pret) => schimbaPretul(rand.cheie, pret)}
                  onScoate={() => scoateServiciu(rand.cheie)}
                />
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Buton
                  onClick={() => setRanduri((precedente) => [...precedente, randGol()])}
                  className="tinta-atingere"
                >
                  <Plus className="size-4" />
                  Adaugă încă un serviciu
                </Buton>
                {maiMulte && (
                  <span className="text-[13px] text-ink-soft">
                    Total{' '}
                    <strong className="font-semibold text-ink tabular-nums">{formateazaBani(total)}</strong>
                  </span>
                )}
              </div>

              {erori.peCamp.servicii && (
                <p role="alert" className="text-[13px] text-danger">
                  {erori.peCamp.servicii}
                </p>
              )}
            </div>
          </PeToataLatimea>

          <CampuriInterval
            incepeLa={incepeLa}
            seTerminaLa={seTerminaLa}
            onSchimba={(inceput, sfarsit) => {
              setIncepeLa(inceput)
              setSeTerminaLa(sfarsit)
            }}
            erori={{
              incepe_la: erori.peCamp.incepe_la ?? null,
              se_termina_la: erori.peCamp.se_termina_la ?? null,
            }}
          />

          <PeToataLatimea>
            <Textarea
              eticheta="Notă"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Detalii utile pentru ședință…"
              rows={2}
            />
          </PeToataLatimea>
        </GrilaFormular>

        {(erori.general ?? eroareNevazuta) && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erori.general ?? eroareNevazuta}
          </p>
        )}
      </form>
    </Modala>
  )
}

/** Câmpurile pe care formularul le arată sub căsuța lor; restul merg în banda generală. */
const CAMPURI_AFISATE =
  /^(client_id|executant_id|incepe_la|se_termina_la|servicii|servicii\.\d+\.(articol_id|pret|tratament_id))$/

function randGol(): RandServiciu {
  return { cheie: uuid(), existent: null, articolId: null, tratamentId: null, pret: '', pretAtins: false }
}

/** Cât durează toate serviciile alese, după nomenclator. */
function durataServiciilor(randuri: readonly RandServiciu[], nomenclator: Articol[] | undefined): number {
  return randuri.reduce(
    (total, r) => total + (nomenclator?.find((s) => s.id === r.articolId)?.durata_minute ?? 0),
    0,
  )
}

/**
 * Un serviciu al programării: serviciul, prețul lui și — dacă face parte
 * dintr-un tratament — ce ședință ar fi.
 *
 * Ce nu se mai poate schimba se arată blocat, nu se lasă pe seama unui refuz
 * de la server: serviciul unei ședințe de tratament (e al tratamentului) și
 * orice la un serviciu deja încasat (bonul nu se rescrie).
 */
function RandServiciuFormular({
  rand,
  index,
  pret,
  sugestie,
  maiDevreme,
  poateFiScos,
  eroareServiciu,
  eroarePret,
  eroareTratament,
  onServiciu,
  onPret,
  onScoate,
}: {
  rand: RandServiciu
  /** Locul în listă, pentru etichete — null când programarea are un singur serviciu. */
  index: number | null
  pret: string
  sugestie: PretSugerat | undefined
  /** Câte ședințe din același serviciu, noi, stau mai sus în listă. */
  maiDevreme: number
  poateFiScos: boolean
  eroareServiciu: string | null
  eroarePret: string | null
  eroareTratament: string | null
  onServiciu: (articolId: Uuid | null) => void
  onPret: (pret: string) => void
  onScoate: () => void
}) {
  const achitat = rand.existent?.achitat ?? false
  const serviciuBlocat = rand.tratamentId !== null || rand.existent?.tratament_id != null || achitat
  const nr = index === null ? '' : ` ${index + 1}`

  // Ce se întâmplă cu tratamentul dacă ședința se salvează acum — spus ÎNAINTE
  // de a salva: recepția trebuie să știe că pune „ședința 3 din 8”, nu o
  // programare oarecare, și că prețul este partea ei din tratament.
  const tratament = !rand.existent && sugestie?.tratament
    ? { ...sugestie.tratament, sedinta_nr: sugestie.tratament.sedinta_nr + maiDevreme }
    : null

  return (
    <div
      className={index === null ? 'flex flex-col gap-2.5' : 'flex flex-col gap-2.5 rounded-xl border border-line p-3'}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-2.5">
        <SelectorArticol
          tip="serviciu"
          valoare={rand.articolId}
          onSchimba={onServiciu}
          eticheta={index === null ? 'Serviciu' : `Serviciul${nr}`}
          obligatoriu
          cuCreare
          disabled={serviciuBlocat}
          eroare={eroareServiciu}
          className="min-w-0 sm:flex-1"
        />
        <div className="flex items-start gap-2.5">
          <Input
            eticheta={index === null ? 'Preț' : `Prețul${nr}`}
            inputMode="decimal"
            obligatoriu
            value={pret}
            onChange={(e) => onPret(e.target.value)}
            disabled={achitat}
            eroare={eroarePret}
            className="text-right tabular-nums"
            containerClassName="flex-1 sm:w-32 sm:flex-none"
          />
          {index !== null && (
            <Buton
              varianta="discret"
              dimensiune="icon"
              onClick={onScoate}
              disabled={!poateFiScos}
              aria-label={`Scoate serviciul${nr}`}
              title={achitat ? 'Serviciul e deja încasat și nu se mai scoate.' : undefined}
              className="tinta-atingere mt-6.5 text-ink-faint hover:text-danger"
            >
              <Trash2 className="size-4.5" />
            </Buton>
          )}
        </div>
      </div>

      {achitat ? (
        <p className="text-[13px] text-ink-faint">Încasat — serviciul și prețul nu se mai schimbă.</p>
      ) : (
        ajutorPret(sugestie) && <p className="text-[13px] text-ink-faint">{ajutorPret(sugestie)}</p>
      )}
      {tratament && <NotaTratament sugestie={tratament} />}
      {eroareTratament && (
        <p role="alert" className="text-[13px] text-danger">
          {eroareTratament}
        </p>
      )}
    </div>
  )
}

/** Sumele intră în câmp cu virgulă zecimală, forma pe care o tastează recepția. */
function laText(valoare: number): string {
  return String(valoare).replace('.', ',')
}

/** De unde vine prețul propus — ca operatoarea să știe de ce nu e cel din nomenclator. */
function ajutorPret(sugestie: PretSugerat | undefined): string | undefined {
  if (!sugestie) return undefined
  if (sugestie.tratament) {
    const { pret_total, numar_sedinte } = sugestie.tratament
    return `Partea ședinței din tratamentul de ${formateazaBani(pret_total)} în ${numar_sedinte} ședințe. Se poate corecta și la închiderea ședinței.`
  }
  if (sugestie.din_istoric) {
    return `Prețul reținut pentru acest client. Preț de listă: ${formateazaBani(sugestie.pret_lista)}`
  }
  return undefined
}

function NotaTratament({ sugestie }: { sugestie: SugestieTratament }) {
  const plin = sugestie.sedinta_nr > sugestie.numar_sedinte
  return (
    <div
      role={plin ? 'alert' : 'note'}
      className={
        plin
          ? 'flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning'
          : 'flex items-start gap-2 rounded-lg bg-primary-50 px-3 py-2 text-[13px] text-primary-700'
      }
    >
      <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {plin ? (
          <>
            Tratamentul are deja toate cele {sugestie.numar_sedinte} ședințe programate sau făcute.
            Mărește numărul de ședințe din fișa tratamentului sau încheie-l și începe altul.
          </>
        ) : sugestie.id === null ? (
          <>
            Începe un <strong>tratament nou</strong> de {sugestie.numar_sedinte}{' '}
            {plural(sugestie.numar_sedinte, 'ședință', 'ședințe')}, {formateazaBani(sugestie.pret_total)} în
            total. Următoarele ședințe se programează din fila „Tratamente”.
          </>
        ) : (
          <>
            <strong>
              Ședința {sugestie.sedinta_nr} din {sugestie.numar_sedinte}
            </strong>{' '}
            a tratamentului în curs ({formateazaBani(sugestie.pret_total)} în total).
          </>
        )}
      </span>
    </div>
  )
}
