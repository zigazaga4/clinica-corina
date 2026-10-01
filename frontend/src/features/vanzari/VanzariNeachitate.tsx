import { Link } from 'react-router-dom'
import { Clock3 } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useVanzari } from '@/app/queries'
import { formateazaData } from '@/lib/dates'
import { formateazaBani, sumaTotal } from '@/lib/money'
import { Card } from '@/ui'
import { PlataVanzarii } from './PlataVanzarii'

/*
  Produsele luate pe datorie — cine, ce, cât — cu bifa „Achitat” pe fiecare.

  Așa a cerut clinica: produsele vândute se notează pe numele clientei, iar
  când vine cu banii, recepția intră pe vânzarea aceea și bifează „Achitat”.
  Lista stă în Nomenclator → Produse, chiar sub produse, fiindcă acolo se fac
  vânzările; fiecare datorie apare și pe fișa clientei, la „De plată”.

  Bifată, vânzarea iese din listă: nu mai e nimic de așteptat de la ea. Rămâne
  pe fișa clientei, cu data la care a plătit.

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
          <li
            key={vanzare.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to={`/clienti/${vanzare.client_id}`}
                  className="font-medium text-ink hover:underline"
                >
                  {vanzare.client_nume}
                </Link>
                <span className="text-[13px] text-ink-faint tabular-nums">
                  {formateazaData(vanzare.efectuat_la)}
                </span>
              </p>
              <ul className="mt-1 text-[13px] text-ink-soft">
                {vanzare.linii.map((linie) => (
                  <li key={linie.id} className="tabular-nums">
                    {linie.articol_denumire}
                    {linie.cantitate !== 1 && ` × ${linie.cantitate}`} ·{' '}
                    {formateazaBani(linie.cantitate * linie.pret_unitar)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm font-semibold text-ink tabular-nums">
                Total: {formateazaBani(vanzare.total)}
              </p>
            </div>

            <PlataVanzarii vanzare={vanzare} compact className="shrink-0" />
          </li>
        ))}
      </ul>
    </Card>
  )
}
