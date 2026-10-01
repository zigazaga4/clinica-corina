import { useState } from 'react'
import { CalendarPlus, CheckCircle2, PencilLine, RotateCcw, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { mesajEroare } from '@/api/errors'
import { useAutentificare } from '@/app/auth'
import { useIncheieTratament, useProgramari, useStergeTratament } from '@/app/queries'
import { InsemnPlata, InsemnStareProgramare } from '@/components/insemne'
import type { ProgramareDetaliu, TratamentDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaData, formateazaDataOra, formateazaOra } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { Buton, Modala, ModalaConfirmare, Pereche, Schelet, StareEroare, useNotificari } from '@/ui'
import { BaniTratament, InsemnTratament, ProgresSedinte, stareaTratamentului } from './ProgresTratament'

/**
 * Fișa unui tratament: unde s-a ajuns, ce ședințe s-au făcut și cu ce bani.
 *
 * Ședințele sunt programări obișnuite, citite cu `tratament_id`; apăsată, una
 * se deschide în detaliul de programare, de unde se marchează onorată sau se
 * încasează — nu există un al doilea drum al banilor doar pentru tratamente.
 */
export function DetaliuTratament({
  tratament,
  onInchide,
  onProgrameaza,
  onModifica,
  onDeschideSedinta,
}: {
  tratament: TratamentDetaliu
  onInchide: () => void
  /** Următoarea ședință, cu clientul și serviciul fixate. */
  onProgrameaza: (tratament: TratamentDetaliu) => void
  onModifica: (tratament: TratamentDetaliu) => void
  onDeschideSedinta: (programare: ProgramareDetaliu) => void
}) {
  const sedinte = useProgramari({ tratament_id: tratament.id })
  const incheie = useIncheieTratament()
  const notificari = useNotificari()
  const [confirmaIncheierea, setConfirmaIncheierea] = useState(false)
  const { esteAdministrator } = useAutentificare()
  const sterge = useStergeTratament()
  const [confirmaStergerea, setConfirmaStergerea] = useState(false)

  const stergeTratamentul = async () => {
    try {
      await sterge.mutateAsync(tratament)
      notificari.succes('Tratament șters, cu ședințele și banii lui')
      setConfirmaStergerea(false)
      onInchide()
    } catch (err) {
      setConfirmaStergerea(false)
      notificari.eroare('Tratamentul nu a putut fi șters', mesajEroare(err))
    }
  }

  const inCurs = tratament.incheiat_la === null
  const stare = stareaTratamentului(tratament)

  const comuta = async (spreIncheiat: boolean) => {
    try {
      await incheie.mutateAsync({ id: tratament.id, incheie: spreIncheiat })
      notificari.succes(spreIncheiat ? 'Tratament încheiat' : 'Tratament redeschis')
      setConfirmaIncheierea(false)
      onInchide()
    } catch (err) {
      setConfirmaIncheierea(false)
      notificari.eroare(
        spreIncheiat ? 'Tratamentul nu a putut fi încheiat' : 'Tratamentul nu a putut fi redeschis',
        mesajEroare(err),
      )
    }
  }

  return (
    <>
      <Modala
        deschisa
        onInchide={onInchide}
        titlu={tratament.client_nume}
        descriere={tratament.articol_denumire}
        subsol={
          <>
            {esteAdministrator && (
              <Buton
                varianta="discret"
                onClick={() => setConfirmaStergerea(true)}
                disabled={sterge.isPending}
                className="text-danger hover:text-danger sm:mr-auto"
              >
                <Trash2 className="size-4" />
                Șterge
              </Buton>
            )}
            <Buton onClick={onInchide} plin className="sm:w-auto">
              Închide
            </Buton>
            <Buton onClick={() => onModifica(tratament)} plin className="sm:w-auto">
              <PencilLine className="size-4" />
              Modifică
            </Buton>
            {inCurs && tratament.sedinte_ramase > 0 && (
              <Buton
                varianta="primar"
                onClick={() => onProgrameaza(tratament)}
                plin
                className="sm:w-auto"
              >
                <CalendarPlus className="size-4" />
                Programează ședința
              </Buton>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl bg-muted p-3">
            <div className="min-w-48 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <InsemnTratament tratament={tratament} />
                {tratament.incheiat_la !== null && (
                  <span className="text-[12px] text-ink-faint">
                    {stare === 'complet' ? 'toate ședințele făcute' : `încheiat pe ${formateazaData(tratament.incheiat_la)}`}
                  </span>
                )}
              </div>
              <ProgresSedinte tratament={tratament} />
            </div>
            <BaniTratament tratament={tratament} className="text-right" />
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Pereche eticheta="Preț total">{formateazaBani(tratament.pret_total)}</Pereche>
            <Pereche eticheta="Următoarea ședință">
              {tratament.urmatoarea_la ? (
                formateazaDataOra(tratament.urmatoarea_la)
              ) : inCurs && tratament.sedinte_ramase > 0 ? (
                <span className="text-warning">neprogramată</span>
              ) : null}
            </Pereche>
            <Pereche eticheta="Partea ședinței următoare">
              {inCurs && tratament.sedinte_ramase > 0 ? formateazaBani(tratament.pret_urmatoarea) : null}
            </Pereche>
            {tratament.nota && (
              <div className="col-span-2 sm:col-span-3">
                <Pereche eticheta="Notă">{tratament.nota}</Pereche>
              </div>
            )}
          </dl>

          <div>
            <p className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
              Ședințele
            </p>
            {sedinte.isPending ? (
              <div className="flex flex-col gap-2">
                <Schelet className="h-12" />
                <Schelet className="h-12" />
              </div>
            ) : sedinte.isError ? (
              <StareEroare mesaj={mesajEroare(sedinte.error)} onReincearca={() => void sedinte.refetch()} />
            ) : sedinte.data.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-faint">
                Nicio ședință programată încă.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {sedinte.data.map((p) => (
                  <li key={p.id}>
                    <RandSedinta programare={p} onClick={onDeschideSedinta} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to={`/clienti/${tratament.client_id}`}
              onClick={onInchide}
              className="text-[13px] font-medium text-primary-600 underline-offset-4 hover:underline"
            >
              Deschide fișa clientului →
            </Link>
            {inCurs ? (
              <Buton
                dimensiune="sm"
                varianta="secundar"
                onClick={() => setConfirmaIncheierea(true)}
                disabled={incheie.isPending}
              >
                <CheckCircle2 className="size-4" />
                Încheie tratamentul
              </Buton>
            ) : (
              <Buton
                dimensiune="sm"
                varianta="secundar"
                onClick={() => void comuta(false)}
                incarca={incheie.isPending}
              >
                <RotateCcw className="size-4" />
                Redeschide
              </Buton>
            )}
          </div>
        </div>
      </Modala>

      <ModalaConfirmare
        deschisa={confirmaIncheierea}
        onInchide={() => setConfirmaIncheierea(false)}
        onConfirma={() => void comuta(true)}
        inCurs={incheie.isPending}
        titlu="Închei tratamentul?"
        etichetaConfirmare="Încheie"
        mesaj={
          tratament.sedinte_ramase > 0
            ? `Mai erau ${tratament.sedinte_ramase} ședințe de programat. Cele făcute și banii încasați rămân la locul lor; o programare nouă la acest serviciu va deschide alt tratament.`
            : 'Ședințele făcute și banii încasați rămân la locul lor.'
        }
      />

      <ModalaConfirmare
        deschisa={confirmaStergerea}
        onInchide={() => setConfirmaStergerea(false)}
        onConfirma={() => void stergeTratamentul()}
        inCurs={sterge.isPending}
        titlu="Ștergi tratamentul?"
        etichetaConfirmare="Șterge tot"
        periculoasa
        mesaj={`${tratament.client_nume}, ${tratament.articol_denumire}. Se șterg și toate ședințele lui din calendar, iar banii încasați pe ele (${formateazaBani(tratament.incasat)}) ies din Statistici. Nu se poate anula; ștergerea rămâne în jurnal.`}
      />
    </>
  )
}

/** O ședință din listă: când, cu cine, în ce stare, cu ce bani. */
function RandSedinta({
  programare,
  onClick,
}: {
  programare: ProgramareDetaliu
  onClick: (programare: ProgramareDetaliu) => void
}) {
  const anulata = programare.stare === 'anulat'
  return (
    <button
      type="button"
      onClick={() => onClick(programare)}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <span className="w-7 shrink-0 text-center text-[12px] font-semibold text-ink-faint tabular-nums">
        {programare.sedinta_nr ?? '—'}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium text-ink tabular-nums', anulata && 'line-through')}>
          {formateazaData(programare.incepe_la)}, {formateazaOra(programare.incepe_la)}
        </span>
        <span className="block truncate text-[12px] text-ink-soft">{programare.executant_nume}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1.5">
          {programare.stare === 'onorat' && <InsemnPlata achitat={programare.achitat} />}
          <InsemnStareProgramare stare={programare.stare} />
        </span>
        <span className={cn('text-[12px] text-ink-soft tabular-nums', anulata && 'line-through')}>
          {formateazaBani(programare.pret)}
        </span>
      </span>
    </button>
  )
}
