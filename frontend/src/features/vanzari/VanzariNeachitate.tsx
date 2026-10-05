import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, Pencil } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useAchitaLinii, useVanzari } from '@/app/queries'
import type { MetodaPlata, Uuid, VanzareDetaliu } from '@/domain/types'
import { formateazaData } from '@/lib/dates'
import { formateazaBani, sumaTotal, totalLinie } from '@/lib/money'
import { Buton, Card, Checkbox, useNotificari } from '@/ui'
import { FormularVanzare } from './FormularVanzare'
import { AlegerePlata, PlataVanzarii } from './PlataVanzarii'

/*
  Produsele luate pe datorie — cine, ce, cât — cu bifa „Achitat” pe fiecare.

  Așa a cerut clinica: produsele vândute se notează pe numele clientei, iar
  când vine cu banii, recepția intră pe vânzarea aceea și bifează „Achitat”.
  Lista stă în Nomenclator → Produse, chiar sub produse, fiindcă acolo se fac
  vânzările; fiecare datorie apare și pe fișa clientei, la „De plată”.

  Bifată, vânzarea iese din listă: nu mai e nimic de așteptat de la ea. Rămâne
  pe fișa clientei, cu data la care a plătit.

  Plata pe bucăți (cerința clinicii, 5 oct. 2026): clienta plătește azi doar
  două din cele cinci creme. Se bifează produsele plătite, apoi „Numerar” sau
  „Card”: ele trec pe un bon achitat, iar vânzarea rămâne în listă doar cu ce
  mai e de plată. „Modifică” deschide toată vânzarea — produse, prețuri,
  clientă, dată — în același formular ca la vânzare.

  Lista NU cere parola statisticilor: spune cine mai are de plătit, nu cât a
  intrat (v. `GET /vanzari` pe server).
*/
export function VanzariNeachitate() {
  const { data, isPending, error } = useVanzari({ achitat: false, pe_pagina: 100 })

  // Fără datorii, panoul nu ocupă loc: nu are ce cere de la nimeni.
  if (isPending) return null
  if (error) {
    return (
      <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
        Vânzările neachitate nu s-au putut încărca: {mesajEroare(error)}
      </p>
    )
  }

  const vanzari = data?.randuri ?? []
  if (vanzari.length === 0) return null

  const total = sumaTotal(vanzari.map((v) => v.total))

  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warning-soft px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
          <Clock3 className="size-4" aria-hidden />
          Produse neachitate
        </h2>
        <p className="text-sm font-semibold text-warning tabular-nums">
          De încasat: {formateazaBani(total)}
        </p>
      </div>

      <ul className="divide-y divide-line">
        {vanzari.map((vanzare) => (
          <RandDatorie key={vanzare.id} vanzare={vanzare} />
        ))}
      </ul>
    </Card>
  )
}

/**
 * O vânzare neachitată: produsele ei, cu bifă pe fiecare când sunt mai multe,
 * plata întregii vânzări sau doar a celor bifate, și „Modifică”.
 */
function RandDatorie({ vanzare }: { vanzare: VanzareDetaliu }) {
  const achita = useAchitaLinii()
  const notificari = useNotificari()
  const [bifate, setBifate] = useState<Uuid[]>([])
  const [deModificat, setDeModificat] = useState(false)

  // Cu un singur produs, bifa ar spune exact ce spun butoanele întregii vânzări.
  const peBucati = vanzare.linii.length > 1
  // Doar liniile încă pe vânzare: după o plată, cele mutate nu mai sunt aici.
  const alese = vanzare.linii.filter((l) => bifate.includes(l.id))
  const sumaAleasa = sumaTotal(alese.map((l) => totalLinie(l.cantitate, l.pret_unitar)))

  const comuta = (id: Uuid) =>
    setBifate((precedente) =>
      precedente.includes(id) ? precedente.filter((x) => x !== id) : [...precedente, id],
    )

  const achitaAlese = async (metoda_plata: MetodaPlata) => {
    if (alese.length === 0 || achita.isPending) return
    try {
      await achita.mutateAsync({
        id: vanzare.id,
        date: { linie_ids: alese.map((l) => l.id), metoda_plata },
      })
      setBifate([])
      const ramane = sumaTotal([vanzare.total, -sumaAleasa])
      notificari.succes(
        alese.length === vanzare.linii.length ? 'Vânzare achitată' : 'Produse achitate',
        alese.length === vanzare.linii.length
          ? `${vanzare.client_nume} · ${formateazaBani(sumaAleasa)} · ${metoda_plata}.`
          : `${vanzare.client_nume} · ${formateazaBani(sumaAleasa)} · ${metoda_plata}. Rămân de plată ${formateazaBani(ramane)}.`,
      )
    } catch (err) {
      notificari.eroare('Plata nu a putut fi înregistrată', mesajEroare(err))
    }
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Link to={`/clienti/${vanzare.client_id}`} className="font-medium text-ink hover:underline">
            {vanzare.client_nume}
          </Link>
          <span className="text-[13px] text-ink-faint tabular-nums">
            {formateazaData(vanzare.efectuat_la)}
          </span>
        </p>
        <ul className={peBucati ? 'mt-1.5 flex flex-col gap-1.5' : 'mt-1 text-[13px] text-ink-soft'}>
          {vanzare.linii.map((linie) => {
            const text = (
              <span className="text-[13px] text-ink-soft tabular-nums">
                {linie.articol_denumire}
                {linie.cantitate !== 1 && ` × ${linie.cantitate}`} ·{' '}
                {formateazaBani(totalLinie(linie.cantitate, linie.pret_unitar))}
              </span>
            )
            return (
              <li key={linie.id} className="tabular-nums">
                {peBucati ? (
                  <Checkbox
                    checked={bifate.includes(linie.id)}
                    onChange={() => comuta(linie.id)}
                    disabled={achita.isPending}
                    eticheta={text}
                  />
                ) : (
                  text
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-1.5 text-sm font-semibold text-ink tabular-nums">
          Total: {formateazaBani(vanzare.total)}
          {alese.length > 0 && (
            <span className="ml-2 font-medium text-success">
              · bifate {formateazaBani(sumaAleasa)} · rămân{' '}
              {formateazaBani(sumaTotal([vanzare.total, -sumaAleasa]))}
            </span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        {alese.length > 0 ? (
          <>
            <p className="text-[13px] text-ink-soft">
              {alese.length === 1
                ? 'Cum s-a plătit produsul bifat?'
                : `Cum s-au plătit cele ${alese.length} produse bifate?`}
            </p>
            <AlegerePlata
              valoare={null}
              onSchimba={(metoda) => {
                if (metoda !== 'neachitat') void achitaAlese(metoda)
              }}
              cuNeachitat={false}
              disabled={achita.isPending}
              compact
            />
            <Buton
              varianta="legatura"
              dimensiune="sm"
              onClick={() => setBifate([])}
              disabled={achita.isPending}
            >
              Renunță la bife
            </Buton>
          </>
        ) : (
          <PlataVanzarii vanzare={vanzare} compact />
        )}
        <Buton
          varianta="discret"
          dimensiune="sm"
          onClick={() => setDeModificat(true)}
          disabled={achita.isPending}
        >
          <Pencil className="size-4" aria-hidden />
          Modifică
        </Buton>
      </div>

      {deModificat && <FormularVanzare vanzare={vanzare} onInchide={() => setDeModificat(false)} />}
    </li>
  )
}
