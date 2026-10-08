import { useEffect, useId, useState, type FormEvent } from 'react'
import { Layers } from 'lucide-react'
import {
  useArticole,
  useCreeazaTratament,
  useModificaTratament,
  usePretSugerat,
} from '@/app/queries'
import { SelectorArticol, SelectorClient } from '@/components/selectoare'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import { pretListaPentru } from '@/domain/reducere'
import type { TratamentDetaliu, Uuid } from '@/domain/types'
import { useEroriFormular } from '@/lib/formular'
import { formateazaBani, parseNumar } from '@/lib/money'
import { plural } from '@/lib/text'
import { Buton, Input, Modala, Textarea, useNotificari } from '@/ui'
import { ReducereAbonament } from './ReducereAbonament'

type CampFormular = 'client_id' | 'articol_id' | 'numar_sedinte' | 'pret_total'

/**
 * Deschiderea și corectarea unui tratament.
 *
 * Deschiderea de aici e drumul rar — clientul a cumpărat pachetul și vrea să-l
 * vadă în listă înainte de prima programare. Drumul obișnuit este prima
 * ședință din calendar, care îl deschide singură. Corectarea, în schimb, se
 * face doar de aici: mai multe ședințe, alt preț total, o notă.
 *
 * Se montează doar cât e deschis: starea pornește din `tratament` la fiecare
 * deschidere, fără efect de resincronizare.
 */
export function FormularTratament({
  tratament,
  onInchide,
}: {
  /** null = tratament nou. */
  tratament: TratamentDetaliu | null
  onInchide: () => void
}) {
  const idFormular = useId()
  const notificari = useNotificari()
  const erori = useEroriFormular<CampFormular>()
  const creeaza = useCreeazaTratament()
  const modifica = useModificaTratament()
  const seTrimite = creeaza.isPending || modifica.isPending

  const { data: servicii } = useArticole({ tip: 'serviciu', activ: true })

  const [clientId, setClientId] = useState<Uuid | null>(tratament?.client_id ?? null)
  const [articolId, setArticolId] = useState<Uuid | null>(tratament?.articol_id ?? null)
  const [numarSedinte, setNumarSedinte] = useState(
    tratament ? String(tratament.numar_sedinte) : '',
  )
  const [pretTotal, setPretTotal] = useState(
    tratament ? String(tratament.pret_total).replace('.', ',') : '',
  )
  const [nota, setNota] = useState(tratament?.nota ?? '')

  /*
    La un tratament nou, numărul de ședințe și prețul pornesc din nomenclator
    — și din memoria clientului, prin `pretSugerat` — dar rămân de corectat:
    tocmai de aceea există formularul. Câmpurile se completează la alegerea
    serviciului și nu se mai ating dacă recepția a scris deja ceva în ele.
  */
  const { data: sugestie } = usePretSugerat(tratament ? null : clientId, tratament ? null : articolId)
  const [pretAtins, setPretAtins] = useState(Boolean(tratament))
  const [sedinteAtinse, setSedinteAtinse] = useState(Boolean(tratament))

  useEffect(() => {
    if (tratament || !articolId) return
    const serviciu = servicii?.find((s) => s.id === articolId)
    if (!serviciu) return
    if (!sedinteAtinse) setNumarSedinte(String(sugestie?.tratament?.numar_sedinte ?? serviciu.numar_sedinte))
    if (!pretAtins) {
      setPretTotal(String(sugestie?.tratament?.pret_total ?? serviciu.pret_lista).replace('.', ','))
    }
  }, [tratament, articolId, servicii, sugestie, pretAtins, sedinteAtinse])

  // Clientul are deja unul în curs la acest serviciu: serverul ar refuza cu
  // 409, dar e mai bine spus înainte, cu drumul corect.
  const dejaInCurs = !tratament && sugestie?.tratament?.id != null

  /*
    Totalul abonamentului — prețul de listă față de care se citește reducerea
    (cerința clinicii, 8 oct. 2026). Cel ținut minte pe tratament; la unul
    deschis înainte de reducere (NULL), cel din nomenclator. La alt număr de
    ședințe, partea lui. 0 = nu se știe (serviciu scos din nomenclator).
  */
  const sedinteScrise = parseNumar(numarSedinte)
  const sedinteAbonament =
    sedinteScrise !== null && Number.isInteger(sedinteScrise) && sedinteScrise >= 1
      ? sedinteScrise
      : (tratament?.numar_sedinte ?? 1)
  const serviciul = servicii?.find((s) => s.id === (tratament?.articol_id ?? articolId))
  const lista =
    tratament?.pret_lista != null
      ? pretListaPentru(
          { pret_lista: tratament.pret_lista, numar_sedinte: tratament.numar_sedinte },
          sedinteAbonament,
        )
      : serviciul
        ? pretListaPentru(serviciul, sedinteAbonament)
        : 0

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    const sedinte = parseNumar(numarSedinte)
    const pret = parseNumar(pretTotal)
    const problemele: [CampFormular, string][] = []

    if (!tratament && !clientId) problemele.push(['client_id', 'Alege clientul.'])
    if (!tratament && !articolId) problemele.push(['articol_id', 'Alege serviciul.'])
    if (sedinte === null || !Number.isInteger(sedinte) || sedinte < 1) {
      problemele.push(['numar_sedinte', 'Numărul de ședințe trebuie să fie un întreg, cel puțin 1.'])
    } else if (tratament && sedinte < tratament.sedinte_programate + tratament.sedinte_onorate) {
      problemele.push([
        'numar_sedinte',
        `Tratamentul are deja ${tratament.sedinte_programate + tratament.sedinte_onorate} ședințe programate sau făcute.`,
      ])
    }
    if (pret === null) problemele.push(['pret_total', 'Completează prețul tratamentului.'])
    else if (pret < 0) problemele.push(['pret_total', 'Prețul nu poate fi negativ.'])

    if (problemele.length > 0 || sedinte === null || pret === null) {
      for (const [camp, mesaj] of problemele) erori.setCamp(camp, mesaj)
      return
    }

    const notaCurata = nota.trim() === '' ? null : nota.trim()

    try {
      if (tratament) {
        await modifica.mutateAsync({
          id: tratament.id,
          date: {
            numar_sedinte: sedinte,
            pret_total: pret,
            // Ținut minte de acum, ca reducerea să rămână cea de azi.
            ...(lista > 0 ? { pret_lista: lista } : {}),
            nota: notaCurata,
          },
        })
        notificari.succes('Tratament modificat', `${sedinte} ${plural(sedinte, 'ședință', 'ședințe')}, ${formateazaBani(pret)} în total.`)
      } else {
        await creeaza.mutateAsync({
          client_id: clientId!,
          articol_id: articolId!,
          numar_sedinte: sedinte,
          pret_total: pret,
          ...(lista > 0 ? { pret_lista: lista } : {}),
          nota: notaCurata,
        })
        notificari.succes('Tratament deschis', 'Programează ședințele din lista de tratamente.')
      }
      onInchide()
    } catch (err) {
      erori.preia(err)
    }
  }

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={tratament ? 'Modifică tratamentul' : 'Tratament nou'}
      descriere={
        tratament
          ? `${tratament.client_nume} · ${tratament.articol_denumire}`
          : 'Un serviciu făcut în mai multe ședințe. Prima programare din calendar îl deschide și singură.'
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
            disabled={dejaInCurs}
            plin
            className="sm:w-auto"
          >
            {tratament ? 'Salvează' : 'Deschide tratamentul'}
          </Buton>
        </>
      }
    >
      <form id={idFormular} onSubmit={trimite} className="flex flex-col gap-4" noValidate>
        <GrilaFormular coloane={2}>
          {!tratament && (
            <>
              <SelectorClient
                valoare={clientId}
                onSchimba={setClientId}
                obligatoriu
                cuCreare
                eroare={erori.peCamp.client_id ?? null}
              />
              <SelectorArticol
                tip="serviciu"
                valoare={articolId}
                onSchimba={setArticolId}
                eticheta="Serviciu"
                obligatoriu
                eroare={erori.peCamp.articol_id ?? null}
              />
            </>
          )}

          {dejaInCurs && (
            <PeToataLatimea>
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning"
              >
                <Layers className="mt-0.5 size-4 shrink-0" aria-hidden />
                Clientul are deja un tratament în curs la acest serviciu. Ședințele noi intră în el;
                dacă vrei altul, încheie-l întâi pe cel în curs.
              </p>
            </PeToataLatimea>
          )}

          <Input
            eticheta="Număr de ședințe"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            obligatoriu
            value={numarSedinte}
            onChange={(e) => {
              setSedinteAtinse(true)
              setNumarSedinte(e.target.value)
            }}
            eroare={erori.peCamp.numar_sedinte ?? null}
            ajutor={
              tratament
                ? `${tratament.sedinte_onorate} făcute, ${tratament.sedinte_programate} programate.`
                : undefined
            }
          />
          {/* Totalul abonamentului, reducerea și totalul de plată. */}
          <PeToataLatimea>
            <ReducereAbonament
              lista={lista}
              total={pretTotal}
              onTotal={(text) => {
                setPretAtins(true)
                setPretTotal(text)
              }}
              numarSedinte={sedinteAbonament}
              disabled={seTrimite}
              eroare={erori.peCamp.pret_total ?? null}
              ajutor={
                tratament
                  ? tratament.sedinte_programate > 0
                    ? 'Ședințele programate primesc noua parte; cele făcute rămân cum au fost.'
                    : 'Ședințele făcute rămân cum au fost; restul se împarte la cele rămase.'
                  : sugestie?.din_istoric
                    ? `Prețul convenit data trecută cu acest client. Preț de listă: ${formateazaBani(sugestie.pret_lista)}`
                    : 'Se împarte pe ședințe la programarea fiecăreia.'
              }
            />
          </PeToataLatimea>

          <PeToataLatimea>
            <Textarea
              eticheta="Notă"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ce s-a convenit cu clientul…"
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
