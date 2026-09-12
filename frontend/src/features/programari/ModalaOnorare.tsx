import { useEffect, useState } from 'react'
import { BanknoteArrowUp, Clock3, ShieldCheck } from 'lucide-react'
import { esteDesktopNativ } from '@/app/platforma'
import {
  useClient,
  useConsimtaminte,
  useSchimbaStareProgramare,
  useTratament,
} from '@/app/queries'
import { ModalaAcordGdpr } from '@/features/consimtamant/ModalaAcordGdpr'
import { BaniTratament, etichetaSedinta, ProgresSedinte } from '@/features/tratamente/ProgresTratament'
import type { ProgramareDetaliu } from '@/domain/types'
import { formateazaBani, parseNumar } from '@/lib/money'
import { Buton, Input, Modala, Spinner, useNotificari } from '@/ui'

/**
 * Închiderea unei ședințe: a avut loc, iar acum se răspunde la „s-a plătit?”.
 *
 * Marcarea ca „onorat” a fost până acum o simplă schimbare de stare, iar banii
 * se pierdeau: nimeni nu mai știa, a doua zi, cine a plecat fără să achite.
 * Întrebarea se pune AICI, în momentul în care clienta e încă la recepție —
 * singurul moment în care răspunsul se știe cu certitudine.
 *
 * Cele două căi sunt deopotrivă legitime, de aceea sunt două butoane, nu o
 * bifă lângă un „Confirmă”: „rămâne de plată” nu este anularea acțiunii, este
 * cazul obișnuit al clientei care vine de trei ori și plătește la final.
 *
 * ÎNAINTEA banilor se cere acordul GDPR, din același motiv de moment: clientul
 * este de față, cu tableta la îndemână. Cerut mai târziu, nu s-ar mai cere
 * niciodată. Dacă ședința are deja un acord semnat, pasul se sare de la sine.
 *
 * Suma se poate corecta AICI, nu doar în formularul de modificare: la casă se
 * află cât s-a luat de fapt — o ședință mai scurtă, un extra — iar la un
 * tratament partea ședințelor următoare se reface singură din ce a rămas.
 */
export function ModalaOnorare({
  deschisa,
  onInchide,
  programare,
  onOnorata,
}: {
  deschisa: boolean
  onInchide: () => void
  programare: ProgramareDetaliu
  /** Ședința a fost închisă cu succes — apelantul poate închide și detaliul. */
  onOnorata: () => void
}) {
  const schimbaStarea = useSchimbaStareProgramare()
  const notificari = useNotificari()

  /*
    Acordul se caută după ȘEDINȚĂ, nu după client.

    Cerința este să se semneze la fiecare venire, deci un acord de luna trecută
    nu ține locul celui de azi. Legat de programare, pasul se sare exact în
    singurul caz în care trebuie sărit: fereastra a fost deja deschisă o dată,
    s-a semnat, iar recepția o redeschide.
  */
  const acorduri = useConsimtaminte({ programare_id: programare.id, pe_pagina: 1 }, deschisa)
  const clientul = useClient(deschisa ? programare.client_id : null)
  // Tratamentul din care face parte ședința, pentru context: cât s-a încasat
  // până acum din cât — ca suma de mai jos să se hotărască în cunoștință.
  const tratament = useTratament(deschisa ? programare.tratament_id : null)

  const [acordRezolvat, setAcordRezolvat] = useState(false)
  // Suma pleacă de la prețul ședinței și se poate corecta; pe o ședință deja
  // încasată câmpul nu apare — bonul nu se rescrie.
  const [suma, setSuma] = useState('')
  const [eroareSuma, setEroareSuma] = useState<string | null>(null)
  useEffect(() => {
    if (!deschisa) return
    setAcordRezolvat(false)
    setSuma(String(programare.pret).replace('.', ','))
    setEroareSuma(null)
  }, [deschisa, programare.pret])

  const sumaNumerica = parseNumar(suma)
  const sumaSchimbata = sumaNumerica !== null && sumaNumerica !== programare.pret

  const seVerifica = acorduri.isPending || clientul.isPending
  const areAcord = (acorduri.data?.total ?? 0) > 0
  /*
    Acordul se cere doar acolo unde poate fi semnat.

    Semnătura se ia pe tableta signotec, legată prin USB de calculatorul din
    recepție și ajunsă la noi printr-un serviciu care ascultă pe `localhost`.
    De pe telefon nu există acel serviciu: fereastra ar fi căutat tableta vreo
    douăsprezece secunde și ar fi sfârșit într-o eroare roșie, la fiecare
    ședință închisă.

    Condiția stă AICI, nu pe fereastra de mai jos: cât timp `cereAcord` este
    adevărat, fereastra de încasare se ascunde singură (v. `deschisa` la
    `ModalaAcordGdpr` / `Modala` de mai jos). Ascunsă doar semnarea, ecranul ar
    fi rămas gol și fără niciun buton.
  */
  const cereAcord =
    deschisa && esteDesktopNativ() && !seVerifica && !areAcord && !acordRezolvat

  const inCurs = schimbaStarea.isPending
  // Indicatorul de încărcare stă pe butonul apăsat, nu pe amândouă: variabilele
  // mutației în curs spun exact ce cale a ales operatoarea.
  const seAchita = inCurs && schimbaStarea.variables?.achitat === true

  const confirma = async (achitat: boolean) => {
    // Zero este o sumă validă — o ședință oferită gratuit — dar lipsa sau un
    // minus nu sunt.
    if (sumaNumerica === null) return setEroareSuma('Completează suma ședinței.')
    if (sumaNumerica < 0) return setEroareSuma('Suma nu poate fi negativă.')
    setEroareSuma(null)

    try {
      await schimbaStarea.mutateAsync({
        id: programare.id,
        stare: 'onorat',
        achitat,
        // Se trimite doar când s-a schimbat: pe o ședință deja încasată,
        // prețul retrimis neschimbat nu trebuie să cadă pe „nu se mai poate”.
        ...(sumaSchimbata ? { pret: sumaNumerica } : {}),
      })
      notificari.succes(
        'Ședință marcată ca onorată',
        achitat
          ? `Încasare ${formateazaBani(sumaNumerica)}.`
          : `${formateazaBani(sumaNumerica)} rămân de plată.`,
      )
      onOnorata()
    } catch (err) {
      notificari.eroare(
        'Ședința nu a putut fi marcată ca onorată',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

  const sedinta = etichetaSedinta(programare)

  return (
    <>
      <Modala
        // Cât se semnează, fereastra cu banii se dă la o parte: două ferestre
        // suprapuse, cu clientul în față, ar fi însemnat o întrebare în plus
        // pusă peste una la care nu s-a răspuns încă.
        deschisa={deschisa && !cereAcord}
        onInchide={onInchide}
        dimensiune="sm"
        blocata={inCurs}
        titlu="Ședință efectuată"
        subsol={
          <>
            <Buton
              onClick={() => void confirma(false)}
              disabled={inCurs || seVerifica}
              incarca={inCurs && !seAchita}
              plin
              className="sm:w-auto"
            >
              <Clock3 className="size-4" />
              Rămâne de plată
            </Buton>
            <Buton
              varianta="primar"
              onClick={() => void confirma(true)}
              disabled={inCurs || seVerifica}
              incarca={seAchita}
              plin
              className="sm:w-auto"
            >
              <BanknoteArrowUp className="size-4" />
              Achitat acum
            </Buton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-muted p-4 text-center">
            <p className="truncate text-sm font-medium text-ink">{programare.client_nume}</p>
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">
              {programare.articol_denumire}
              {sedinta && <span className="text-primary-600"> · {sedinta}</span>}
            </p>
            {/*
              Suma este cea a ȘEDINȚEI, nu prețul din nomenclator, și se poate
              corecta pe loc — cât s-a luat de fapt. Pe o ședință deja
              încasată rămâne doar de citit: bonul nu se rescrie.
            */}
            {programare.achitat ? (
              <p className="mt-2 text-2xl font-semibold text-ink tabular-nums">
                {formateazaBani(programare.pret)}
              </p>
            ) : (
              <Input
                eticheta="Suma ședinței"
                inputMode="decimal"
                value={suma}
                onChange={(e) => setSuma(e.target.value)}
                eroare={eroareSuma}
                sufix="RON"
                containerClassName="mx-auto mt-3 max-w-48 text-left"
                className="text-right text-lg font-semibold tabular-nums"
                ajutor={
                  sumaSchimbata
                    ? `Prețul convenit era ${formateazaBani(programare.pret)}.`
                    : undefined
                }
              />
            )}
          </div>

          {/* Tratamentul: unde s-a ajuns și cât s-a încasat până acum din el. */}
          {tratament.data && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-line px-3 py-2.5">
              <ProgresSedinte tratament={tratament.data} className="flex-1" />
              <BaniTratament tratament={tratament.data} className="shrink-0 text-right" />
            </div>
          )}

          {seVerifica ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-faint">
              <Spinner dimensiune="sm" />
              Se verifică acordul GDPR…
            </p>
          ) : areAcord || acordRezolvat ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-faint">
              <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
              {areAcord ? 'Acordul GDPR este semnat pentru această ședință.' : 'Ședința se închide fără acord semnat.'}
            </p>
          ) : null}

          <p className="text-[13px] leading-relaxed text-ink-faint">
            Ce rămâne de plată apare pe fișa clientului și se poate încasa mai târziu, împreună cu
            alte ședințe.
          </p>
        </div>
      </Modala>

      {clientul.data && (
        <ModalaAcordGdpr
          deschisa={cereAcord}
          onInchide={onInchide}
          client={clientul.data}
          programareId={programare.id}
          onSemnat={() => {
            setAcordRezolvat(true)
            notificari.succes('Acord GDPR semnat', 'Documentul a fost păstrat pe fișa clientului.')
          }}
          onSare={() => setAcordRezolvat(true)}
        />
      )}
    </>
  )
}
