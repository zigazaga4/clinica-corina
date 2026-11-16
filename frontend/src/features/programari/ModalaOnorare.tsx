import { useEffect, useRef, useState } from 'react'
import { Banknote, Clock3, CreditCard, ShieldCheck } from 'lucide-react'
import { esteDesktopNativ } from '@/app/platforma'
import { functii } from '@/config/functii'
import {
  useClient,
  useConsimtaminte,
  useSchimbaStareProgramare,
  useTratament,
} from '@/app/queries'
import { ModalaAcordGdpr } from '@/features/consimtamant/ModalaAcordGdpr'
import { BaniTratament, etichetaSedinta, ProgresSedinte } from '@/features/tratamente/ProgresTratament'
import { seStingeDinAvans } from '@/domain/avans'
import type { MetodaPlata, ProgramareDetaliu, Uuid } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaBani, numarInCamp, parseNumar, sumaTotal } from '@/lib/money'
import { Buton, Input, Modala, Spinner, useNotificari } from '@/ui'

/**
 * Închiderea unei ședințe: a avut loc, iar acum se răspunde la „s-a plătit?”.
 *
 * Marcarea ca „onorat” a fost până acum o simplă schimbare de stare, iar banii
 * se pierdeau: nimeni nu mai știa, a doua zi, cine a plecat fără să achite.
 * Întrebarea se pune AICI, în momentul în care clienta e încă la recepție —
 * singurul moment în care răspunsul se știe cu certitudine.
 *
 * Căile sunt deopotrivă legitime, de aceea sunt butoane, nu o bifă lângă un
 * „Confirmă”: „rămâne de plată” nu este anularea acțiunii, este cazul obișnuit
 * al clientei care vine de trei ori și plătește la final. Plata pe loc are
 * DOUĂ butoane, „Numerar” și „Card” (cerința clinicii, 2026-10-01): cum s-a
 * plătit se spune în aceeași apăsare, nu se poate uita.
 *
 * ÎNAINTEA banilor se cere acordul GDPR, din același motiv de moment: clientul
 * este de față, cu tableta la îndemână. Cerut mai târziu, nu s-ar mai cere
 * niciodată. Dacă ședința are deja un acord semnat, pasul se sare de la sine.
 *
 * Suma se poate corecta AICI, nu doar în formularul de modificare: la casă se
 * află cât s-a luat de fapt — o ședință mai scurtă, un extra — iar la un
 * tratament partea ședințelor următoare se reface singură din ce a rămas.
 *
 * O programare cu mai multe servicii se închide o singură dată: câte o sumă pe
 * serviciu, iar „Achitat acum” le plătește pe toate, pe un singur bon. Nu se
 * poate „achita manichiura, dar nu și IPL-ul” de aici — ce rămâne neplătit se
 * încasează după aceea de pe fișă, unde se aleg ședințele una câte una.
 *
 * Fără bani (`functii.costuri` oprit — fork-ul Corinei) rămâne DOAR acordul:
 * fereastra de încasare nu are ce întreba, deci nu se mai arată, iar ședința
 * se închide singură îndată ce acordul s-a semnat, s-a sărit sau exista deja.
 */
export function ModalaOnorare({
  deschisa,
  onInchide,
  programare,
  servicii = [programare],
  onOnorata,
}: {
  deschisa: boolean
  onInchide: () => void
  programare: ProgramareDetaliu
  /** Toate serviciile programării; implicit doar `programare`. */
  servicii?: ProgramareDetaliu[]
  /** Ședința a fost închisă cu succes — apelantul poate închide și detaliul. */
  onOnorata: () => void
}) {
  const schimbaStarea = useSchimbaStareProgramare()
  const notificari = useNotificari()
  const maiMulte = servicii.length > 1

  /*
    Acordul se caută după ȘEDINȚĂ, nu după client.

    Cerința este să se semneze la fiecare venire, deci un acord de luna trecută
    nu ține locul celui de azi. Legat de programare, pasul se sare exact în
    singurul caz în care trebuie sărit: fereastra a fost deja deschisă o dată,
    s-a semnat, iar recepția o redeschide.

    O venire, un acord: se leagă de PRIMUL serviciu al programării, oricare ar
    fi fost apăsat în calendar — altfel aceeași venire l-ar fi cerut din nou.
  */
  const primul = servicii[0] ?? programare
  const acorduri = useConsimtaminte({ programare_id: primul.id, pe_pagina: 1 }, deschisa)
  const clientul = useClient(deschisa ? programare.client_id : null)

  const [acordRezolvat, setAcordRezolvat] = useState(false)
  // Sumele pleacă de la prețul fiecărui serviciu și se pot corecta; pe unul
  // deja încasat câmpul nu apare — bonul nu se rescrie.
  const [sume, setSume] = useState<Record<Uuid, string>>({})
  const [eroriSume, setEroriSume] = useState<Record<Uuid, string>>({})
  // Cheia pe care se reîncarcă sumele: ce servicii și cu ce prețuri — nu
  // identitatea listei, care se reface la fiecare citire a programării.
  const cheiePreturi = servicii.map((s) => `${s.id}:${s.pret}`).join()
  useEffect(() => {
    if (!deschisa) return
    setAcordRezolvat(false)
    setSume(Object.fromEntries(servicii.map((s) => [s.id, numarInCamp(s.pret)])))
    setEroriSume({})
    // `servicii` se citește prin `cheiePreturi`, care o rezumă exact.
  }, [deschisa, cheiePreturi])

  const sumaDe = (s: ProgramareDetaliu) => parseNumar(sume[s.id] ?? numarInCamp(s.pret))
  /*
    Ședința unui abonament cu avans se plătește singură din avans: banii au
    intrat deja, când s-a încasat abonamentul. Ea nu mai întreabă „s-a plătit?”
    și nu are sumă de corectat — doar ce NU acoperă avansul ajunge la plată.
  */
  const dinAvans = servicii.filter(seStingeDinAvans)
  const deIncasat = servicii.filter((s) => !s.achitat && !seStingeDinAvans(s))
  const totalDeIncasat = sumaTotal(deIncasat.map((s) => sumaDe(s) ?? 0))

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

  const faraBani = !functii.costuri

  const inCurs = schimbaStarea.isPending
  // Indicatorul de încărcare stă pe butonul apăsat, nu pe toate: variabilele
  // mutației în curs spun exact ce cale a ales operatoarea.
  const metodaInCurs = inCurs && schimbaStarea.variables?.achitat === true
    ? (schimbaStarea.variables.metoda_plata ?? null)
    : null

  /** `metoda` = achitat acum, cu numerar sau card; `null` = rămâne de plată. */
  const confirma = async (metoda: MetodaPlata | null) => {
    const achitat = metoda !== null
    // Zero este o sumă validă — o ședință oferită gratuit — dar lipsa sau un
    // minus nu sunt.
    const erori: Record<Uuid, string> = {}
    const preturi: Record<Uuid, number> = {}
    for (const s of deIncasat) {
      const suma = sumaDe(s)
      if (suma === null) erori[s.id] = 'Completează suma.'
      else if (suma < 0) erori[s.id] = 'Suma nu poate fi negativă.'
      // Se trimite doar ce s-a schimbat: pe o ședință deja încasată, prețul
      // retrimis neschimbat nu trebuie să cadă pe „nu se mai poate”.
      else if (suma !== s.pret) preturi[s.id] = suma
    }
    setEroriSume(erori)
    if (Object.keys(erori).length > 0) return

    try {
      await schimbaStarea.mutateAsync({
        id: programare.id,
        stare: 'onorat',
        achitat,
        ...(metoda ? { metoda_plata: metoda } : {}),
        ...(Object.keys(preturi).length > 0 ? { preturi } : {}),
      })
      notificari.succes(
        maiMulte ? 'Programare marcată ca onorată' : 'Ședință marcată ca onorată',
        faraBani
          ? undefined
          : deIncasat.length === 0
            ? dinAvans.length > 0
              ? 'Plătită din avansul abonamentului.'
              : undefined
            : achitat
              ? `Încasare ${formateazaBani(totalDeIncasat)} · ${metoda === 'card' ? 'card' : 'numerar'}.`
              : `${formateazaBani(totalDeIncasat)} rămân de plată.`,
      )
      onOnorata()
    } catch (err) {
      notificari.eroare(
        maiMulte ? 'Programarea nu a putut fi marcată ca onorată' : 'Ședința nu a putut fi marcată ca onorată',
        err instanceof Error ? err.message : undefined,
      )
      // Fără bani nu se vede nicio fereastră de unde s-ar putea reîncerca:
      // se închide, ca un nou „Onorat” să pornească totul de la capăt.
      if (faraBani) onInchide()
    }
  }

  /*
    Fără bani, ședința se închide singură, o singură dată pe deschidere, când
    nu mai e nimic de așteptat: acordul s-a verificat și nu se mai cere.
  */
  const inchisaSingura = useRef(false)
  const gataDeInchis = deschisa && faraBani && !seVerifica && !cereAcord
  useEffect(() => {
    if (!deschisa) inchisaSingura.current = false
    if (!gataDeInchis || inchisaSingura.current) return
    inchisaSingura.current = true
    void confirma(null)
    // `confirma` se reface la fiecare randare; contează doar momentul.
  }, [deschisa, gataDeInchis])

  return (
    <>
      <Modala
        // Cât se semnează, fereastra cu banii se dă la o parte: două ferestre
        // suprapuse, cu clientul în față, ar fi însemnat o întrebare în plus
        // pusă peste una la care nu s-a răspuns încă. Fără bani nu se arată
        // deloc: nu are ce întreba.
        deschisa={deschisa && !cereAcord && !faraBani}
        onInchide={onInchide}
        dimensiune="sm"
        blocata={inCurs}
        titlu={maiMulte ? 'Programare efectuată' : 'Ședință efectuată'}
        subsol={
          <>
            {/* Fără nimic de încasat (totul plătit deja), plata nu are ce întreba. */}
            {deIncasat.length === 0 ? (
              <Buton
                varianta="primar"
                onClick={() => void confirma(null)}
                disabled={inCurs || seVerifica}
                incarca={inCurs}
                plin
                className="sm:w-auto"
              >
                Confirmă
              </Buton>
            ) : (
              <>
                <Buton
                  onClick={() => void confirma(null)}
                  disabled={inCurs || seVerifica}
                  incarca={inCurs && metodaInCurs === null}
                  plin
                  className="sm:w-auto"
                >
                  <Clock3 className="size-4" />
                  Rămâne de plată
                </Buton>
                <Buton
                  varianta="primar"
                  onClick={() => void confirma('numerar')}
                  disabled={inCurs || seVerifica}
                  incarca={metodaInCurs === 'numerar'}
                  aria-label="Achitat acum, numerar"
                  plin
                  className="sm:w-auto"
                >
                  <Banknote className="size-4" />
                  Numerar
                </Buton>
                <Buton
                  varianta="primar"
                  onClick={() => void confirma('card')}
                  disabled={inCurs || seVerifica}
                  incarca={metodaInCurs === 'card'}
                  aria-label="Achitat acum, card"
                  plin
                  className="sm:w-auto"
                >
                  <CreditCard className="size-4" />
                  Card
                </Buton>
              </>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/*
            Suma este cea a ȘEDINȚEI, nu prețul din nomenclator, și se poate
            corecta pe loc — cât s-a luat de fapt. Pe o ședință deja încasată
            rămâne doar de citit: bonul nu se rescrie.
          */}
          {maiMulte ? (
            <div className="rounded-xl bg-muted p-3">
              <p className="truncate text-center text-sm font-medium text-ink">{programare.client_nume}</p>
              <ul className="mt-2 flex flex-col gap-2">
                {servicii.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-[13px] text-ink">
                      <span className="block truncate font-medium">{s.articol_denumire}</span>
                      {etichetaSedinta(s) && (
                        <span className="block truncate text-[12px] text-primary-600">{etichetaSedinta(s)}</span>
                      )}
                    </span>
                    <SumaServiciului
                      serviciu={s}
                      valoare={sume[s.id] ?? ''}
                      onSchimba={(v) => setSume((p) => ({ ...p, [s.id]: v }))}
                      eroare={eroriSume[s.id] ?? null}
                      eticheta={`Suma: ${s.articol_denumire}`}
                      ascundeEticheta
                      containerClassName="w-36 shrink-0 text-left"
                      // Loc pentru „RON”: altfel cifrele se lipesc de el.
                      className="pr-12 text-right font-semibold tabular-nums"
                    />
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex items-baseline justify-between border-t border-line pt-2 text-[13px] text-ink-soft">
                {deIncasat.length < servicii.length ? 'De încasat acum' : 'Total'}
                <span className="text-lg font-semibold text-ink tabular-nums">
                  {formateazaBani(totalDeIncasat)}
                </span>
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-muted p-4 text-center">
              <p className="truncate text-sm font-medium text-ink">{programare.client_nume}</p>
              <p className="mt-0.5 truncate text-[13px] text-ink-soft">
                {primul.articol_denumire}
                {etichetaSedinta(primul) && (
                  <span className="text-primary-600"> · {etichetaSedinta(primul)}</span>
                )}
              </p>
              <SumaServiciului
                serviciu={primul}
                valoare={sume[primul.id] ?? ''}
                onSchimba={(v) => setSume((p) => ({ ...p, [primul.id]: v }))}
                eroare={eroriSume[primul.id] ?? null}
                eticheta="Suma ședinței"
                containerClassName="mx-auto mt-3 max-w-48 text-left"
                className="text-right text-lg font-semibold tabular-nums"
                clasaAchitat="mt-2 text-2xl"
              />
            </div>
          )}

          {/* Tratamentele: unde s-a ajuns și cât s-a încasat până acum din fiecare. */}
          {servicii.map((s) =>
            s.tratament_id === null ? null : (
              <ContextTratament
                key={s.id}
                tratament_id={deschisa ? s.tratament_id : null}
                cuNume={maiMulte}
              />
            ),
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
            {dinAvans.length > 0 && (
              <>
                {deIncasat.length > 0 ? 'O parte din ședințe' : 'Ședința'} se plătește din avansul
                abonamentului, deja încasat — nu se cere încă o dată.{' '}
              </>
            )}
            {deIncasat.length > 0 && (
              <>
                A plătit acum? Apasă <strong className="font-medium text-ink-soft">Numerar</strong> sau{' '}
                <strong className="font-medium text-ink-soft">Card</strong>, după cum a plătit.{' '}
              </>
            )}
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
          programareId={primul.id}
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

/**
 * Suma unui serviciu: câmp de corectat — sau, dacă e deja încasat, doar de
 * citit: bonul nu se rescrie. Sub câmp, prețul convenit, cât timp suma
 * tastată e alta.
 */
function SumaServiciului({
  serviciu,
  valoare,
  onSchimba,
  eroare,
  eticheta,
  ascundeEticheta = false,
  containerClassName,
  className,
  clasaAchitat,
}: {
  serviciu: ProgramareDetaliu
  valoare: string
  onSchimba: (valoare: string) => void
  eroare: string | null
  eticheta: string
  /** Eticheta rămâne doar pentru cititoarele de ecran — rândul își spune serviciul. */
  ascundeEticheta?: boolean
  containerClassName?: string
  className?: string
  clasaAchitat?: string
}) {
  if (serviciu.achitat || seStingeDinAvans(serviciu)) {
    return (
      <p className={cn('font-semibold text-ink tabular-nums', clasaAchitat)}>
        {formateazaBani(serviciu.pret)}
        {/* Banii au intrat când s-a încasat abonamentul: aici doar se consumă. */}
        {!serviciu.achitat && (
          <span className="block text-[12px] font-normal text-success">din avansul abonamentului</span>
        )}
      </p>
    )
  }
  const suma = parseNumar(valoare)
  return (
    <Input
      {...(ascundeEticheta ? { 'aria-label': eticheta } : { eticheta })}
      inputMode="decimal"
      value={valoare}
      onChange={(e) => onSchimba(e.target.value)}
      eroare={eroare}
      sufix="RON"
      containerClassName={containerClassName}
      className={className}
      ajutor={
        suma !== null && suma !== serviciu.pret
          ? `Prețul convenit era ${formateazaBani(serviciu.pret)}.`
          : undefined
      }
    />
  )
}

/**
 * Tratamentul unui serviciu, pentru context: unde s-a ajuns și cât s-a încasat
 * până acum din el — ca suma să se hotărască în cunoștință. Câte unul pe
 * serviciu: o programare poate avea ședințe din două tratamente.
 */
function ContextTratament({ tratament_id, cuNume }: { tratament_id: Uuid | null; cuNume: boolean }) {
  const tratament = useTratament(tratament_id)
  if (!tratament.data) return null
  return (
    <div className="rounded-xl border border-line px-3 py-2.5">
      {cuNume && (
        <p className="mb-1 text-[12px] font-medium text-ink-soft">{tratament.data.articol_denumire}</p>
      )}
      <div className="flex items-start justify-between gap-4">
        <ProgresSedinte tratament={tratament.data} className="flex-1" />
        <BaniTratament tratament={tratament.data} className="shrink-0 text-right" />
      </div>
    </div>
  )
}
