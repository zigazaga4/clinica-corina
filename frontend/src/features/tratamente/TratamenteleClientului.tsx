import { CalendarPlus, Layers } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTratamente } from '@/app/queries'
import type { TratamentDetaliu, Uuid } from '@/domain/types'
import { formateazaDataOra } from '@/lib/dates'
import { AntetCard, Buton, Card } from '@/ui'
import { BaniTratament, ProgresSedinte } from './ProgresTratament'

/**
 * Tratamentele în curs ale unui client, pe fișa lui.
 *
 * Fișa e locul unde recepția are omul în față sau la telefon: „mai aveți trei
 * ședințe, următoarea nu e programată — când puteți veni?”. Cardul apare doar
 * când există ceva de spus; un client fără tratamente nu are nevoie de o
 * secțiune goală. Fișa întreagă a tratamentului stă în ecranul „Tratamente”.
 */
export function TratamenteleClientului({
  clientId,
  onProgrameaza,
}: {
  clientId: Uuid
  onProgrameaza: (tratament: TratamentDetaliu) => void
}) {
  const { data } = useTratamente({ client_id: clientId, in_curs: true, pe_pagina: 20 })
  const tratamente = data?.randuri ?? []
  if (tratamente.length === 0) return null

  return (
    <Card>
      <AntetCard
        titlu="Tratamente în curs"
        actiuni={
          <Link
            to={`/tratamente?client=${clientId}`}
            className="text-[13px] font-medium text-primary-600 underline-offset-4 hover:underline"
          >
            Toate tratamentele →
          </Link>
        }
      />
      <ul className="divide-y divide-line">
        {tratamente.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="flex min-w-48 flex-1 items-start gap-2">
              <Layers className="mt-0.5 size-4 shrink-0 text-primary-600" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{t.articol_denumire}</span>
                <ProgresSedinte tratament={t} className="mt-1" />
              </span>
            </span>
            <span className="min-w-36 text-[12px] text-ink-faint">
              {t.urmatoarea_la ? (
                <>Următoarea: <span className="text-ink-soft tabular-nums">{formateazaDataOra(t.urmatoarea_la)}</span></>
              ) : t.sedinte_ramase > 0 ? (
                <span className="font-medium text-warning">Următoarea ședință nu e programată</span>
              ) : (
                'Toate ședințele programate'
              )}
            </span>
            <BaniTratament tratament={t} className="min-w-28 text-right" />
            {t.sedinte_ramase > 0 && (
              <Buton dimensiune="sm" varianta="primar" onClick={() => onProgrameaza(t)}>
                <CalendarPlus className="size-4" />
                Programează
              </Buton>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
