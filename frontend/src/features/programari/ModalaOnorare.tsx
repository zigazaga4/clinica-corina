import { useEffect, useState } from 'react'
import { BanknoteArrowUp, Clock3, ShieldCheck } from 'lucide-react'
import { useClient, useConsimtaminte, useSchimbaStareProgramare } from '@/app/queries'
import { ModalaAcordGdpr } from '@/features/consimtamant/ModalaAcordGdpr'
import type { ProgramareDetaliu } from '@/domain/types'
import { formateazaBani } from '@/lib/money'
import { Buton, Modala, Spinner, useNotificari } from '@/ui'

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

  const [acordRezolvat, setAcordRezolvat] = useState(false)
  useEffect(() => {
    if (deschisa) setAcordRezolvat(false)
  }, [deschisa])

  const seVerifica = acorduri.isPending || clientul.isPending
  const areAcord = (acorduri.data?.total ?? 0) > 0
  const cereAcord = deschisa && !seVerifica && !areAcord && !acordRezolvat

  const inCurs = schimbaStarea.isPending
  // Indicatorul de încărcare stă pe butonul apăsat, nu pe amândouă: variabilele
  // mutației în curs spun exact ce cale a ales operatoarea.
  const seAchita = inCurs && schimbaStarea.variables?.achitat === true

  const confirma = async (achitat: boolean) => {
    try {
      await schimbaStarea.mutateAsync({ id: programare.id, stare: 'onorat', achitat })
      notificari.succes(
        'Ședință marcată ca onorată',
        achitat
          ? `Încasare ${formateazaBani(programare.pret)}.`
          : `${formateazaBani(programare.pret)} rămân de plată.`,
      )
      onOnorata()
    } catch (err) {
      notificari.eroare(
        'Ședința nu a putut fi marcată ca onorată',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

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
            </p>
            {/* Suma este cea a ȘEDINȚEI, nu prețul din nomenclator: se citește
                o dată, cu voce tare, la casă. */}
            <p className="mt-2 text-2xl font-semibold text-ink tabular-nums">
              {formateazaBani(programare.pret)}
            </p>
          </div>

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
