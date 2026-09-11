import { useEffect, useState, type FormEvent } from 'react'
import { useCreeazaNotita, useModificaNotita } from '@/app/queries'
import { SelectorUtilizator } from '@/components/selectoare'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import type { NotitaDetaliu, Uuid } from '@/domain/types'
import { addMinutes, dinInputDatetime, laInputDatetime } from '@/lib/dates'
import { useEroriFormular } from '@/lib/formular'
import { Buton, Input, Modala, Textarea, useNotificari } from '@/ui'
import { CampuriInterval, DURATE_NOTITA, proximulSfertDeOra } from './CampuriInterval'

type CampFormular = 'titlu' | 'executant_id' | 'incepe_la' | 'se_termina_la'

/**
 * Notița din calendar: titlu, interval, opțional o persoană.
 *
 * Seamănă dinadins cu formularul de programare — aceleași câmpuri de zi, oră
 * și durată, același selector de persoană — ca recepția să nu învețe două
 * gesturi. Se deosebește prin ce NU are: client, serviciu, preț. Pentru „vine
 * furnizorul la 15” nu există niciunul dintre ele.
 */
export function FormularNotita({
  deschisa,
  onInchide,
  notita,
  /** Momentul pe care s-a apăsat în calendar, folosit ca oră de început. */
  momentInitial,
}: {
  deschisa: boolean
  onInchide: () => void
  notita?: NotitaDetaliu | null
  momentInitial?: Date
}) {
  const esteModificare = Boolean(notita)
  const notificari = useNotificari()
  const erori = useEroriFormular<CampFormular>()

  const creeaza = useCreeazaNotita()
  const modifica = useModificaNotita()
  const seTrimite = creeaza.isPending || modifica.isPending

  const [titlu, setTitlu] = useState('')
  const [detalii, setDetalii] = useState('')
  const [executantId, setExecutantId] = useState<Uuid | null>(null)
  const [incepeLa, setIncepeLa] = useState('')
  const [seTerminaLa, setSeTerminaLa] = useState('')

  // Reîncărcarea valorilor la fiecare deschidere: dialogul rămâne montat, deci
  // fără asta o a doua deschidere ar arăta datele notiței dinainte.
  useEffect(() => {
    if (!deschisa) return
    erori.goleste()

    if (notita) {
      setTitlu(notita.titlu)
      setDetalii(notita.detalii ?? '')
      setExecutantId(notita.executant_id)
      setIncepeLa(laInputDatetime(notita.incepe_la))
      setSeTerminaLa(laInputDatetime(notita.se_termina_la))
      return
    }

    const inceput = momentInitial ?? proximulSfertDeOra()
    setTitlu('')
    setDetalii('')
    // Implicit pentru toată clinica: o notiță e, de obicei, despre loc și zi,
    // nu despre o persoană. Alegerea persoanei este gestul deliberat.
    setExecutantId(null)
    setIncepeLa(laInputDatetime(inceput))
    setSeTerminaLa(laInputDatetime(addMinutes(inceput, 60)))
    // `erori` lipsește intenționat dintre dependențe — v. FormularProgramare.
  }, [deschisa, notita, momentInitial])

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    if (titlu.trim() === '') return erori.setCamp('titlu', 'Scrie un titlu.')
    if (incepeLa === '') return erori.setCamp('incepe_la', 'Completează ora de început.')
    if (seTerminaLa === '') return erori.setCamp('se_termina_la', 'Completează ora de sfârșit.')
    if (new Date(seTerminaLa) <= new Date(incepeLa)) {
      return erori.setCamp('se_termina_la', 'Ora de sfârșit trebuie să fie după cea de început.')
    }

    const date = {
      titlu: titlu.trim(),
      detalii: detalii.trim() === '' ? null : detalii.trim(),
      executant_id: executantId,
      incepe_la: dinInputDatetime(incepeLa),
      se_termina_la: dinInputDatetime(seTerminaLa),
    }

    try {
      if (notita) {
        await modifica.mutateAsync({ id: notita.id, date })
        notificari.succes('Notiță modificată')
      } else {
        await creeaza.mutateAsync(date)
        notificari.succes('Notiță adăugată')
      }
      onInchide()
    } catch (err) {
      erori.preia(err)
    }
  }

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={esteModificare ? 'Modifică notița' : 'Notiță nouă'}
      descriere="O însemnare în calendar, fără client și fără preț. Nu blochează intervalul."
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seTrimite} plin className="sm:w-auto">
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            form="formular-notita"
            type="submit"
            incarca={seTrimite}
            plin
            className="sm:w-auto"
          >
            {esteModificare ? 'Salvează' : 'Adaugă notița'}
          </Buton>
        </>
      }
    >
      <form id="formular-notita" onSubmit={trimite} className="flex flex-col gap-4" noValidate>
        <GrilaFormular coloane={2}>
          <PeToataLatimea>
            <Input
              eticheta="Titlu"
              obligatoriu
              value={titlu}
              onChange={(e) => setTitlu(e.target.value)}
              placeholder="Concediu, vine furnizorul, curățenie…"
              eroare={erori.peCamp.titlu ?? null}
              autoFocus
            />
          </PeToataLatimea>

          <PeToataLatimea>
            <SelectorUtilizator
              valoare={executantId}
              onSchimba={setExecutantId}
              eticheta="Pentru"
              placeholder="Toată clinica"
              cuGolire
              eroare={erori.peCamp.executant_id ?? null}
            />
          </PeToataLatimea>

          <CampuriInterval
            incepeLa={incepeLa}
            seTerminaLa={seTerminaLa}
            onSchimba={(inceput, sfarsit) => {
              setIncepeLa(inceput)
              setSeTerminaLa(sfarsit)
            }}
            durate={DURATE_NOTITA}
            erori={{
              incepe_la: erori.peCamp.incepe_la ?? null,
              se_termina_la: erori.peCamp.se_termina_la ?? null,
            }}
          />

          <PeToataLatimea>
            <Textarea
              eticheta="Detalii"
              value={detalii}
              onChange={(e) => setDetalii(e.target.value)}
              placeholder="Ce trebuie știut…"
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
