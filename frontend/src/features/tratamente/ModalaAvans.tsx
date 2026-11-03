import { useEffect, useState } from 'react'
import { campVinovat, mesajEroare } from '@/api/errors'
import { useIncaseazaPeAbonament } from '@/app/queries'
import { incasatPeAbonament, maiDeIncasatPeAbonament } from '@/domain/avans'
import type { MetodaPlata, TratamentDetaliu } from '@/domain/types'
import { AlegerePlata } from '@/features/vanzari/PlataVanzarii'
import { formateazaBani, numarInCamp, parseNumar } from '@/lib/money'
import { Buton, Camp, Input, Modala, useNotificari } from '@/ui'

/**
 * Încasarea pe abonament, FĂRĂ ca vreo ședință să fi avut loc (3 nov. 2026).
 *
 * „I-am pus unei paciente un abonament, 1.000 de lei, 4 ședințe. Ea n-a făcut
 * ședința și vreau să pot să-i dau încasare. Dacă o programez și o închid, mi
 * se scade din abonament.” Până acum banii intrau doar pe o ședință onorată, iar
 * o ședință „închisă” numai ca să se poată încasa ar fi consumat-o.
 *
 * Banii rămân pe abonament ca AVANS. Nu se atinge nicio ședință: fiecare, când
 * este onorată, se plătește singură din avans — fără să mai ceară bani.
 *
 * Suma pornește de la tot ce a mai rămas de încasat, ca încasarea abonamentului
 * întreg să fie o singură apăsare; se poate scrie mai puțin (o rată).
 */
export function ModalaAvans({
  deschisa,
  onInchide,
  tratament,
}: {
  deschisa: boolean
  onInchide: () => void
  tratament: TratamentDetaliu
}) {
  const incaseaza = useIncaseazaPeAbonament()
  const notificari = useNotificari()

  const maiDeIncasat = maiDeIncasatPeAbonament(tratament)
  const [suma, setSuma] = useState(numarInCamp(maiDeIncasat))
  // Nimic ales dinainte: cum a plătit se spune de fiecare dată.
  const [metoda, setMetoda] = useState<MetodaPlata | null>(null)
  const [eroareSuma, setEroareSuma] = useState<string | null>(null)
  const [eroareMetoda, setEroareMetoda] = useState<string | null>(null)
  const [eroare, setEroare] = useState<string | null>(null)

  // Se reface la DESCHIDERE, nu la fiecare citire a tratamentului: fișa se
  // reîmprospătează în fundal, iar o resincronizare ar rescrie suma tastată.
  useEffect(() => {
    if (!deschisa) return
    setSuma(numarInCamp(maiDeIncasatPeAbonament(tratament)))
    setMetoda(null)
    setEroareSuma(null)
    setEroareMetoda(null)
    setEroare(null)
    // `tratament` se citește la deschidere; schimbările de după nu o refac.
  }, [deschisa, tratament.id])

  const valoare = parseNumar(suma)
  const ramasDupa = valoare !== null && valoare > 0 ? Math.max(maiDeIncasat - valoare, 0) : null

  const trimite = async () => {
    setEroare(null)
    if (valoare === null || valoare <= 0) {
      setEroareSuma('Scrie suma încasată, mai mare ca zero.')
      return
    }
    if (valoare > maiDeIncasat) {
      setEroareSuma(`Din abonament au mai rămas de încasat ${formateazaBani(maiDeIncasat)}.`)
      return
    }
    setEroareSuma(null)
    if (metoda === null) {
      setEroareMetoda('Alege cum a plătit: numerar sau card.')
      return
    }

    try {
      await incaseaza.mutateAsync({ id: tratament.id, date: { suma: valoare, metoda_plata: metoda } })
      notificari.succes(
        `Încasare de ${formateazaBani(valoare)} · ${metoda === 'card' ? 'card' : 'numerar'}`,
        `${tratament.client_nume} · ${tratament.articol_denumire}. Rămâne pe abonament; ședințele făcute o consumă.`,
      )
      onInchide()
    } catch (err) {
      // Eroarea apare lângă câmpul vinovat; restul — în fereastră, nu într-o notificare.
      const camp = campVinovat(err)
      if (camp === 'suma') setEroareSuma(mesajEroare(err))
      else if (camp === 'metoda_plata') setEroareMetoda(mesajEroare(err))
      else setEroare(mesajEroare(err))
    }
  }

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      dimensiune="sm"
      blocata={incaseaza.isPending}
      titlu="Încasează abonamentul"
      descriere={`${tratament.client_nume} · ${tratament.articol_denumire}`}
      subsol={
        <>
          <Buton onClick={onInchide} disabled={incaseaza.isPending} className="tinta-atingere sm:w-auto" plin>
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            onClick={() => void trimite()}
            incarca={incaseaza.isPending}
            disabled={maiDeIncasat <= 0}
            className="tinta-atingere sm:w-auto"
            plin
          >
            Încasează{valoare !== null && valoare > 0 ? ` ${formateazaBani(valoare)}` : ''}
          </Buton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted p-3 text-center">
          <div>
            <dt className="text-[12px] text-ink-faint">Preț abonament</dt>
            <dd className="text-sm font-semibold text-ink tabular-nums">{formateazaBani(tratament.pret_total)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-faint">Încasat</dt>
            <dd className="text-sm font-semibold text-ink tabular-nums">
              {formateazaBani(incasatPeAbonament(tratament))}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-faint">De încasat</dt>
            <dd className="text-sm font-semibold text-ink tabular-nums">{formateazaBani(maiDeIncasat)}</dd>
          </div>
        </dl>

        {maiDeIncasat <= 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-faint">
            Abonamentul este încasat în întregime.
          </p>
        ) : (
          <>
            <Input
              eticheta="Suma încasată"
              inputMode="decimal"
              value={suma}
              onChange={(e) => {
                setSuma(e.target.value)
                setEroareSuma(null)
              }}
              eroare={eroareSuma}
              sufix="RON"
              disabled={incaseaza.isPending}
              ajutor={
                ramasDupa !== null && ramasDupa > 0
                  ? `Rămân de încasat ${formateazaBani(ramasDupa)}.`
                  : 'Tot ce a mai rămas din abonament.'
              }
              // Loc pentru „RON”: altfel cifrele se lipesc de el.
              className="pr-12 text-right text-lg font-semibold tabular-nums"
            />

            <Camp eticheta="Cum a plătit?" obligatoriu eroare={eroareMetoda}>
              {() => (
                <AlegerePlata
                  valoare={metoda}
                  onSchimba={(noua) => {
                    if (noua === 'neachitat') return
                    setMetoda(noua)
                    setEroareMetoda(null)
                  }}
                  cuNeachitat={false}
                  disabled={incaseaza.isPending}
                />
              )}
            </Camp>
          </>
        )}

        {eroare && (
          <p role="alert" className="text-[13px] text-danger">
            {eroare}
          </p>
        )}

        <p className="text-[13px] leading-relaxed text-ink-faint">
          Banii intră acum în Statistici și rămân pe abonament. Nu se consumă nicio ședință: când una este
          marcată onorată, se plătește singură din avans.
        </p>
      </div>
    </Modala>
  )
}
