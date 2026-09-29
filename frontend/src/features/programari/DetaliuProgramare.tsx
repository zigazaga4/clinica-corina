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
import { useIncaseaza, useSchimbaStareProgramare, useServiciileProgramarii } from '@/app/queries'
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
import { pretulProgramarii } from './vizite'

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
 *
 * Fereastra arată programarea ÎNTREAGĂ, cu toate serviciile ei — fiecare cu
 * prețul, ședința din tratament și plata lui — oricare dintre ele ar fi fost
 * apăsat. Starea se schimbă pe toate deodată: clienta a venit sau nu a venit.
 */

const pictograme: Partial<Record<StareProgramare, typeof CheckCircle2>> = {
  onorat: CheckCircle2,
  anulat: XCircle,
  neprezentat: UserX,
}

export function DetaliuProgramare({
  programare: apasata,
  cunoscute,
  onInchide,
  onModifica,
}: {
  /** Oricare serviciu al programării — cel apăsat. */
  programare: ProgramareDetaliu | null
  /** Serviciile pe care apelantul le are deja (calendarul le are pe toate). */
  cunoscute?: ProgramareDetaliu[]
  onInchide: () => void
  /** Programarea de modificat: rândul apăsat și toate serviciile ei. */
  onModifica: (programare: ProgramareDetaliu, servicii: ProgramareDetaliu[]) => void
}) {
  const schimbaStarea = useSchimbaStareProgramare()
  const incasare = useIncaseaza()
  const notificari = useNotificari()
  const [confirmaOnorarea, setConfirmaOnorarea] = useState(false)
  const servicii = useServiciileProgramarii(apasata, cunoscute)

  if (!apasata) return null

  // Varianta proaspătă a rândului apăsat: ora, starea, clientul și nota sunt
  // aceleași pe toate serviciile, deci oricare le poate spune.
  const programare = servicii.find((s) => s.id === apasata.id) ?? servicii[0] ?? apasata
  const stariDisponibile = STARE_PROGRAMARE.filter((stare) => stare !== programare.stare)
  const maiMulte = servicii.length > 1
  const neachitate = servicii.filter((s) => !s.achitat)

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
      // Toate serviciile încă neplătite, cu o singură plată — un bon.
      await incasare.mutateAsync({
        client_id: programare.client_id,
        programare_ids: neachitate.map((s) => s.id),
      })
      notificari.succes(
        'Încasare înregistrată',
        `${formateazaBani(pretulProgramarii(neachitate))} de la ${programare.client_nume}.`,
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
        descriere={servicii.map((s) => s.articol_denumire).join(' + ')}
        subsol={
          <>
            <Buton onClick={onInchide} plin className="sm:w-auto">
              Închide
            </Buton>
            <Buton
              varianta="primar"
              onClick={() => onModifica(programare, servicii)}
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

          {/*
            Serviciile și banii lor, fiecare pe rândul lui: prețul, ședința din
            tratament (cu drum spre fișa lui) și plata. Însemnul de plată apare
            DOAR la programările onorate: una de joia viitoare nu este „de
            plată”, este neîntâmplată încă.
          */}
          <section aria-label="Servicii" className="overflow-hidden rounded-xl border border-line">
            <ul className="divide-y divide-line">
              {servicii.map((serviciu) => (
                <li key={serviciu.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{serviciu.articol_denumire}</p>
                    {serviciu.tratament_id !== null && (
                      <Link
                        to={`/tratamente?tratament=${serviciu.tratament_id}`}
                        onClick={onInchide}
                        className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary-600 hover:underline"
                      >
                        <Layers className="size-3.5 shrink-0" aria-hidden />
                        {etichetaSedinta(serviciu)}
                        <span aria-hidden>→</span>
                      </Link>
                    )}
                    {/* Când au intrat banii — plata se face adesea la altă dată. */}
                    {serviciu.achitat_la !== null && (
                      <p className="mt-0.5 text-[12px] text-ink-faint tabular-nums">
                        Încasat pe {formateazaData(serviciu.achitat_la)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {formateazaBani(serviciu.pret)}
                    </span>
                    {esteOnorata && <InsemnPlata achitat={serviciu.achitat} />}
                  </div>
                </li>
              ))}
            </ul>

            {(maiMulte || (esteOnorata && neachitate.length > 0)) && (
              <div className="flex items-center justify-between gap-3 border-t border-line bg-muted/60 px-3 py-2">
                <p className="text-[13px] text-ink-soft">
                  {maiMulte && (
                    <>
                      Total{' '}
                      <strong className="font-semibold text-ink tabular-nums">
                        {formateazaBani(pretulProgramarii(servicii))}
                      </strong>
                    </>
                  )}
                </p>
                {esteOnorata && neachitate.length > 0 && (
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
          </section>

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
        servicii={servicii}
        onOnorata={() => {
          setConfirmaOnorarea(false)
          onInchide()
        }}
      />
    </>
  )
}
