import { useEffect, useState, type FormEvent } from 'react'
import {
  useArticole,
  useCreeazaProgramare,
  useModificaProgramare,
  usePretSugerat,
} from '@/app/queries'
import { useAutentificare } from '@/app/auth'
import { SelectorArticol, SelectorClient, SelectorUtilizator } from '@/components/selectoare'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import type { ProgramareDetaliu, Uuid } from '@/domain/types'
import {
  addMinutes,
  differenceInMinutes,
  dinInputDatetime,
  formateazaDurata,
  laInputDatetime,
} from '@/lib/dates'
import { useEroriFormular } from '@/lib/formular'
import { formateazaBani, parseNumar } from '@/lib/money'
import { Buton, Input, Modala, Textarea, useNotificari } from '@/ui'

type CampFormular =
  | 'client_id'
  | 'articol_id'
  | 'executant_id'
  | 'pret'
  | 'incepe_la'
  | 'se_termina_la'

export function FormularProgramare({
  deschisa,
  onInchide,
  programare,
  /** Momentul pe care s-a apăsat în calendar, folosit ca oră de început. */
  momentInitial,
}: {
  deschisa: boolean
  onInchide: () => void
  programare?: ProgramareDetaliu | null
  momentInitial?: Date
}) {
  const esteModificare = Boolean(programare)
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

    const inceput = momentInitial ?? proximaJumatateDeOra()
    setClientId(null)
    setArticolId(null)
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
  }, [deschisa, programare, momentInitial, utilizator])

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

  /** Mutarea începutului păstrează durata deja stabilită. */
  const schimbaInceputul = (valoare: string) => {
    if (incepeLa !== '' && seTerminaLa !== '') {
      const durata = differenceInMinutes(new Date(seTerminaLa), new Date(incepeLa))
      if (durata > 0) setSeTerminaLa(laInputDatetime(addMinutes(new Date(valoare), durata)))
    }
    setIncepeLa(valoare)
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
        await creeaza.mutateAsync(date)
        notificari.succes('Programare adăugată')
      }
      onInchide()
    } catch (err) {
      // Suprapunerea de interval vine ca 409 fără `camp`, deci ajunge în banda
      // generală — este o eroare despre relația dintre două câmpuri, nu despre
      // unul singur.
      erori.preia(err)
    }
  }

  const durata =
    incepeLa !== '' && seTerminaLa !== ''
      ? differenceInMinutes(new Date(seTerminaLa), new Date(incepeLa))
      : 0

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
          <SelectorClient
            valoare={clientId}
            onSchimba={setClientId}
            obligatoriu
            eroare={erori.peCamp.client_id ?? null}
          />
          <SelectorArticol
            tip="serviciu"
            valoare={articolId}
            onSchimba={alegeServiciu}
            eticheta="Serviciu"
            obligatoriu
            eroare={erori.peCamp.articol_id ?? null}
          />
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
            ajutor={
              sugestie?.din_istoric
                ? `Prețul reținut pentru acest client. Preț de listă: ${formateazaBani(sugestie.pret_lista)}`
                : undefined
            }
            className="text-right tabular-nums"
          />

          <Input
            eticheta="Începe la"
            type="datetime-local"
            obligatoriu
            value={incepeLa}
            onChange={(e) => schimbaInceputul(e.target.value)}
            eroare={erori.peCamp.incepe_la ?? null}
          />
          <Input
            eticheta="Se termină la"
            type="datetime-local"
            obligatoriu
            value={seTerminaLa}
            onChange={(e) => setSeTerminaLa(e.target.value)}
            eroare={erori.peCamp.se_termina_la ?? null}
            ajutor={durata > 0 ? `Durată: ${formateazaDurata(durata)}` : undefined}
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

/** Următorul sfert de oră rotund — punctul de pornire firesc la recepție. */
function proximaJumatateDeOra(): Date {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15)
  return d
}
