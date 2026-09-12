import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Layers } from 'lucide-react'
import {
  useArticole,
  useCreeazaProgramare,
  useModificaProgramare,
  usePretSugerat,
} from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import type { PretSugerat, SugestieTratament } from '@/api/contract'
import { SelectorArticol, SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import type { ProgramareDetaliu, Uuid } from '@/domain/types'
import { addMinutes, dinInputDatetime, laInputDatetime } from '@/lib/dates'
import { useEroriFormular } from '@/lib/formular'
import { formateazaBani, parseNumar } from '@/lib/money'
import { plural } from '@/lib/text'
import { Buton, Input, Modala, Textarea, useNotificari } from '@/ui'
import { CampuriInterval, proximulSfertDeOra } from './CampuriInterval'

type CampFormular =
  | 'client_id'
  | 'articol_id'
  | 'executant_id'
  | 'pret'
  | 'incepe_la'
  | 'se_termina_la'

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
  /** Momentul pe care s-a apăsat în calendar, folosit ca oră de început. */
  momentInitial,
  initial,
}: {
  deschisa: boolean
  onInchide: () => void
  programare?: ProgramareDetaliu | null
  momentInitial?: Date
  /** Ședința următoare a unui tratament — client și serviciu fixate. */
  initial?: ProgramareInitiala | null
}) {
  const esteModificare = Boolean(programare)
  const dinTratament = Boolean(initial) && !esteModificare
  const { utilizator } = useAutentificare()
  const notificari = useNotificari()
  const erori = useEroriFormular<CampFormular>()

  const creeaza = useCreeazaProgramare()
  const modifica = useModificaProgramare()
  const seTrimite = creeaza.isPending || modifica.isPending

  const { data: servicii } = useArticole({ tip: 'serviciu', activ: true })

  const [clientId, setClientId] = useState<Uuid | null>(null)
  const [articolId, setArticolId] = useState<Uuid | null>(null)
  const [executantId, setExecutantId] = useState<Uuid | null>(null)
  const [incepeLa, setIncepeLa] = useState('')
  const [seTerminaLa, setSeTerminaLa] = useState('')
  const [nota, setNota] = useState('')
  const [pret, setPret] = useState('')
  // Cât timp operatoarea nu a scris nimic în câmpul de preț, acesta oglindește
  // sugestia serverului. După prima tastare, indicatorul rămâne ridicat: o
  // schimbare de client sau de serviciu nu are voie să șteargă o sumă convenită
  // deja cu clientul.
  const [pretAtins, setPretAtins] = useState(false)

  const { data: sugestie } = usePretSugerat(clientId, articolId)

  // Valoarea afișată se DERIVĂ, nu se copiază într-un efect: altfel sugestia
  // sosită după o schimbare de client ar putea suprascrie câmpul cu o
  // întârziere de o randare, exact peste ce tocmai s-a tastat.
  const pretAfisat = pretAtins || !sugestie ? pret : laText(sugestie.pret)

  // Reîncărcarea valorilor la fiecare deschidere: dialogul rămâne montat, deci
  // fără asta o a doua deschidere ar arăta datele programării dinainte.
  useEffect(() => {
    if (!deschisa) return
    erori.goleste()

    if (programare) {
      setClientId(programare.client_id)
      setArticolId(programare.articol_id)
      setExecutantId(programare.executant_id)
      setIncepeLa(laInputDatetime(programare.incepe_la))
      setSeTerminaLa(laInputDatetime(programare.se_termina_la))
      setNota(programare.nota ?? '')
      // Prețul unei programări existente este deja convenit; sugestia nu are ce
      // să corecteze la el, deci câmpul pornește „atins”.
      setPret(laText(programare.pret))
      setPretAtins(true)
      return
    }

    const inceput = momentInitial ?? proximulSfertDeOra()
    setClientId(initial?.client_id ?? null)
    setArticolId(initial?.articol_id ?? null)
    // Operatorul se programează cel mai des pe sine; e punctul de plecare cel
    // mai probabil, iar schimbarea costă un clic.
    setExecutantId(utilizator?.id ?? null)
    setIncepeLa(laInputDatetime(inceput))
    setSeTerminaLa(laInputDatetime(addMinutes(inceput, 60)))
    setNota('')
    setPret('')
    setPretAtins(false)
    // `erori` lipsește intenționat dintre dependențe: funcțiile lui sunt stabile
    // prin useCallback, iar obiectul se recreează la fiecare randare, deci
    // includerea lui ar reporni efectul și ar șterge ce tocmai s-a completat.
  }, [deschisa, programare, momentInitial, initial, utilizator])

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
    if (!deschisa || !initial || !servicii || durataAplicata.current) return
    const serviciu = servicii.find((s) => s.id === initial.articol_id)
    if (!serviciu?.durata_minute) return
    durataAplicata.current = true
    const inceput = momentInitial ?? proximulSfertDeOra()
    setSeTerminaLa(laInputDatetime(addMinutes(inceput, serviciu.durata_minute)))
  }, [deschisa, initial, servicii, momentInitial])

  /**
   * Alegerea serviciului mută ora de sfârșit după `durata_minute`.
   *
   * Este singurul loc în care durata din nomenclator ajunge în programare:
   * `programare` nu are coloană de durată, ci două capete de interval. Ora de
   * sfârșit rămâne editabilă — o ședință poate dura mai mult decât standardul.
   */
  const alegeServiciu = (id: Uuid | null) => {
    setArticolId(id)
    if (!id || incepeLa === '') return
    const serviciu = servicii?.find((s) => s.id === id)
    if (!serviciu?.durata_minute) return
    setSeTerminaLa(laInputDatetime(addMinutes(new Date(incepeLa), serviciu.durata_minute)))
  }

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    if (!clientId) return erori.setCamp('client_id', 'Alege clientul.')
    if (!articolId) return erori.setCamp('articol_id', 'Alege serviciul.')
    if (!executantId) return erori.setCamp('executant_id', 'Alege persoana care execută.')

    // Zero este o valoare validă: o ședință oferită gratuit rămâne o ședință
    // efectuată, care trebuie să apară în calendar și în istoric.
    const pretNumeric = parseNumar(pretAfisat)
    if (pretNumeric === null) return erori.setCamp('pret', 'Completează prețul ședinței.')
    if (pretNumeric < 0) return erori.setCamp('pret', 'Prețul nu poate fi negativ.')

    if (incepeLa === '') return erori.setCamp('incepe_la', 'Completează ora de început.')
    if (seTerminaLa === '') return erori.setCamp('se_termina_la', 'Completează ora de sfârșit.')
    if (new Date(seTerminaLa) <= new Date(incepeLa)) {
      return erori.setCamp('se_termina_la', 'Ora de sfârșit trebuie să fie după cea de început.')
    }

    const date = {
      client_id: clientId,
      articol_id: articolId,
      executant_id: executantId,
      incepe_la: dinInputDatetime(incepeLa),
      se_termina_la: dinInputDatetime(seTerminaLa),
      pret: pretNumeric,
      nota: nota.trim() === '' ? null : nota.trim(),
    }

    try {
      if (programare) {
        await modifica.mutateAsync({ id: programare.id, date })
        notificari.succes('Programare modificată')
      } else {
        // Din fișa tratamentului, ședința intră EXPLICIT în el; din calendar,
        // serverul o pune singur în tratamentul în curs al clientului.
        const creata = await creeaza.mutateAsync(
          initial ? { ...date, tratament_id: initial.tratament_id } : date,
        )
        notificari.succes(
          'Programare adăugată',
          creata.sedinta_nr !== null && creata.tratament_numar_sedinte !== null
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
          <SelectorArticol
            tip="serviciu"
            valoare={articolId}
            onSchimba={alegeServiciu}
            eticheta="Serviciu"
            obligatoriu
            cuCreare
            disabled={dinTratament}
            eroare={erori.peCamp.articol_id ?? null}
          />

          {/*
            Ce se întâmplă cu tratamentul dacă ședința se salvează acum — spus
            ÎNAINTE de a salva. Recepția trebuie să știe că pune „ședința 3 din
            8”, nu o programare oarecare, și că prețul de mai jos este partea
            ei din tratament, nu prețul din nomenclator.
          */}
          {!esteModificare && sugestie?.tratament && (
            <PeToataLatimea>
              <NotaTratament sugestie={sugestie.tratament} />
            </PeToataLatimea>
          )}

          <SelectorUtilizator
            valoare={executantId}
            onSchimba={setExecutantId}
            obligatoriu
            eroare={erori.peCamp.executant_id ?? null}
          />
          <Input
            eticheta="Preț"
            inputMode="decimal"
            obligatoriu
            value={pretAfisat}
            onChange={(e) => {
              setPretAtins(true)
              setPret(e.target.value)
            }}
            eroare={erori.peCamp.pret ?? null}
            ajutor={ajutorPret(sugestie)}
            className="text-right tabular-nums"
          />

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

        {erori.general && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erori.general}
          </p>
        )}
      </form>
    </Modala>
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
