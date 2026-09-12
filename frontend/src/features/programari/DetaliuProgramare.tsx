import { useState } from 'react'
import {
  BanknoteArrowUp,
  CalendarClock,
  CheckCircle2,
  Layers,
  PencilLine,
  UserX,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useIncaseaza, useSchimbaStareProgramare } from '@/app/queries'
import { InsemnPlata, InsemnStareProgramare } from '@/components/insemne'
import { etichetaSedinta } from '@/features/tratamente/ProgresTratament'
import { STARE_PROGRAMARE, type ProgramareDetaliu, type StareProgramare } from '@/domain/types'
import { etichetaStareProgramare } from '@/domain/labels'
import {
  formateazaData,
  formateazaDataOra,
  formateazaInterval,
  formateazaZiLunga,
} from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { Buton, Modala, Pereche, useNotificari } from '@/ui'
import { ModalaOnorare } from './ModalaOnorare'

/**
 * Detaliul unei programări, cu schimbarea stării.
 *
 * Ciclul de viață din specificație este programat → onorat / anulat /
 * neprezentat. Butoanele arată exact tranzacțiile permise din starea curentă,
 * în loc să afișeze toate cele patru stări și să lase serverul să refuze —
 * „Marchează ca programat” pe o programare deja onorată nu înseamnă nimic.
 *
 * Trecerea pe „onorat” este singura care nu se aplică direct: ea mișcă și bani,
 * deci trece prin `ModalaOnorare`, care întreabă dacă s-a plătit. Anularea,
 * neprezentarea și revenirea la „programat” nu ating încasările.
 */

const pictograme: Partial<Record<StareProgramare, typeof CheckCircle2>> = {
  onorat: CheckCircle2,
  anulat: XCircle,
  neprezentat: UserX,
}

export function DetaliuProgramare({
  programare,
  onInchide,
  onModifica,
}: {
  programare: ProgramareDetaliu | null
  onInchide: () => void
  onModifica: (programare: ProgramareDetaliu) => void
}) {
  const schimbaStarea = useSchimbaStareProgramare()
  const incasare = useIncaseaza()
  const notificari = useNotificari()
  const [confirmaOnorarea, setConfirmaOnorarea] = useState(false)

  if (!programare) return null

  const stariDisponibile = STARE_PROGRAMARE.filter((stare) => stare !== programare.stare)

  const schimba = async (stare: StareProgramare) => {
    try {
      await schimbaStarea.mutateAsync({ id: programare.id, stare })
      notificari.succes(`Programare marcată ca ${etichetaStareProgramare[stare].toLowerCase()}`)
      onInchide()
    } catch (err) {
      // Reactivarea unei programări anulate poate eșua: între timp, intervalul
      // executantului putea fi ocupat de altcineva.
      notificari.eroare(
        'Starea nu a putut fi schimbată',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

  const incaseaza = async () => {
    try {
      await incasare.mutateAsync({
        client_id: programare.client_id,
        programare_ids: [programare.id],
      })
      notificari.succes(
        'Încasare înregistrată',
        `${formateazaBani(programare.pret)} de la ${programare.client_nume}.`,
      )
      // Fereastra se închide după încasare: programarea de aici este o copie
      // luată la deschidere, iar lăsată pe ecran ar continua să arate „De
      // plată” pentru o ședință tocmai stinsă.
      onInchide()
    } catch (err) {
      notificari.eroare(
        'Încasarea nu a putut fi înregistrată',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

  const esteOnorata = programare.stare === 'onorat'

  return (
    <>
      <Modala
        deschisa={programare !== null}
        onInchide={onInchide}
        dimensiune="sm"
        titlu={programare.client_nume}
        descriere={programare.articol_denumire}
        subsol={
          <>
            <Buton onClick={onInchide} plin className="sm:w-auto">
              Închide
            </Buton>
            <Buton
              varianta="primar"
              onClick={() => onModifica(programare)}
              plin
              className="sm:w-auto"
            >
              <PencilLine className="size-4" />
              Modifică
            </Buton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted p-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <CalendarClock className="size-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="capitalize">{formateazaZiLunga(programare.incepe_la)}</span>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-soft tabular-nums">
                {formateazaInterval(programare.incepe_la, programare.se_termina_la)}
              </p>
            </div>
            <InsemnStareProgramare stare={programare.stare} />
          </div>

          {/* Locul ședinței în tratament, cu drum spre fișa lui. */}
          {programare.tratament_id !== null && (
            <Link
              to={`/tratamente?tratament=${programare.tratament_id}`}
              onClick={onInchide}
              className="flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-2 text-[13px] font-medium text-primary-700 hover:bg-primary-100"
            >
              <Layers className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{etichetaSedinta(programare)}</span>
              <span aria-hidden>→</span>
            </Link>
          )}

          {/*
            Banii ședinței. Însemnul de plată apare DOAR la ședințele onorate:
            una de joia viitoare nu este „de plată”, este neîntâmplată încă.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
            <div>
              <p className="text-[12px] font-medium tracking-wide text-ink-faint uppercase">
                Preț ședință
              </p>
              <p className="mt-0.5 text-base font-semibold text-ink tabular-nums">
                {formateazaBani(programare.pret)}
              </p>
              {/* Când au intrat banii — plata se face adesea la altă dată. */}
              {programare.achitat_la !== null && (
                <p className="mt-0.5 text-[12px] text-ink-faint tabular-nums">
                  Încasat pe {formateazaData(programare.achitat_la)}
                </p>
              )}
            </div>

            {esteOnorata && (
              <div className="flex items-center gap-2">
                <InsemnPlata achitat={programare.achitat} />
                {!programare.achitat && (
                  <Buton
                    dimensiune="sm"
                    varianta="primar"
                    onClick={() => void incaseaza()}
                    incarca={incasare.isPending}
                  >
                    <BanknoteArrowUp className="size-4" />
                    Încasează
                  </Buton>
                )}
              </div>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <Pereche eticheta="Execută">{programare.executant_nume}</Pereche>
            <Pereche eticheta="Telefon client">{programare.client_telefon}</Pereche>
            <Pereche eticheta="Creată la">{formateazaDataOra(programare.creat_la)}</Pereche>
            {programare.nota && (
              <div className="col-span-2">
                <Pereche eticheta="Notă">{programare.nota}</Pereche>
              </div>
            )}
          </dl>

          <div>
            <p className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
              Schimbă starea
            </p>
            <div className="flex flex-wrap gap-2">
              {stariDisponibile.map((stare) => {
                const Pictograma = pictograme[stare]
                return (
                  <Buton
                    key={stare}
                    dimensiune="sm"
                    varianta={stare === 'anulat' ? 'pericol' : 'secundar'}
                    disabled={schimbaStarea.isPending || incasare.isPending}
                    // „Onorat” înseamnă și bani, deci întreabă întâi dacă s-a
                    // plătit; celelalte stări se aplică direct.
                    onClick={() => {
                      if (stare === 'onorat') setConfirmaOnorarea(true)
                      else void schimba(stare)
                    }}
                  >
                    {Pictograma && <Pictograma className="size-4" />}
                    {etichetaStareProgramare[stare]}
                  </Buton>
                )
              })}
            </div>
          </div>

          <Link
            to={`/clienti/${programare.client_id}`}
            onClick={onInchide}
            className="text-[13px] font-medium text-primary-600 underline-offset-4 hover:underline"
          >
            Deschide fișa clientului →
          </Link>
        </div>
      </Modala>

      <ModalaOnorare
        deschisa={confirmaOnorarea}
        onInchide={() => setConfirmaOnorarea(false)}
        programare={programare}
        onOnorata={() => {
          setConfirmaOnorarea(false)
          onInchide()
        }}
      />
    </>
  )
}
