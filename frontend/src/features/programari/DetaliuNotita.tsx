import { useState } from 'react'
import { CalendarClock, PencilLine, StickyNote, Trash2 } from 'lucide-react'
import { useStergeNotita } from '@/app/queries'
import type { NotitaDetaliu } from '@/domain/types'
import { formateazaDataOra, formateazaInterval, formateazaZiLunga } from '@/lib/dates'
import { Buton, Modala, ModalaConfirmare, Pereche, useNotificari } from '@/ui'
import { pentruCine } from './CardNotita'

/**
 * Detaliul unei notițe: ce scrie, când, pentru cine, cine a pus-o.
 *
 * Are buton de ștergere — singurul din tot calendarul. O programare nu se
 * șterge fiindcă a fost o ședință și a mișcat bani; o notiță „vine furnizorul”
 * de săptămâna trecută nu e nimic din toate acestea. Urma ei rămâne în jurnal.
 */
export function DetaliuNotita({
  notita,
  onInchide,
  onModifica,
}: {
  notita: NotitaDetaliu | null
  onInchide: () => void
  onModifica: (notita: NotitaDetaliu) => void
}) {
  const sterge = useStergeNotita()
  const notificari = useNotificari()
  const [confirmaStergerea, setConfirmaStergerea] = useState(false)

  if (!notita) return null

  const stergeNotita = async () => {
    try {
      await sterge.mutateAsync(notita.id)
      notificari.succes('Notiță ștearsă')
      setConfirmaStergerea(false)
      onInchide()
    } catch (err) {
      notificari.eroare(
        'Notița nu a putut fi ștearsă',
        err instanceof Error ? err.message : undefined,
      )
    }
  }

  return (
    <>
      <Modala
        deschisa={notita !== null}
        onInchide={onInchide}
        dimensiune="sm"
        titlu={
          <span className="flex items-center gap-2">
            <StickyNote className="size-4 shrink-0 text-warning" aria-hidden />
            {notita.titlu}
          </span>
        }
        descriere="Notiță în calendar"
        subsol={
          <>
            <Buton
              varianta="pericol"
              onClick={() => setConfirmaStergerea(true)}
              disabled={sterge.isPending}
              plin
              className="sm:mr-auto sm:w-auto"
            >
              <Trash2 className="size-4" />
              Șterge
            </Buton>
            <Buton onClick={onInchide} plin className="sm:w-auto">
              Închide
            </Buton>
            <Buton varianta="primar" onClick={() => onModifica(notita)} plin className="sm:w-auto">
              <PencilLine className="size-4" />
              Modifică
            </Buton>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-muted p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <CalendarClock className="size-4 shrink-0 text-ink-faint" aria-hidden />
              <span className="capitalize">{formateazaZiLunga(notita.incepe_la)}</span>
            </p>
            <p className="mt-0.5 text-[13px] text-ink-soft tabular-nums">
              {formateazaInterval(notita.incepe_la, notita.se_termina_la)}
            </p>
          </div>

          {notita.detalii && (
            <p className="text-sm whitespace-pre-line text-ink">{notita.detalii}</p>
          )}

          <dl className="grid grid-cols-2 gap-3">
            <Pereche eticheta="Pentru">{pentruCine(notita)}</Pereche>
            <Pereche eticheta="Adăugată de">{notita.creat_de_nume}</Pereche>
            <Pereche eticheta="Adăugată la">{formateazaDataOra(notita.creat_la)}</Pereche>
          </dl>
        </div>
      </Modala>

      <ModalaConfirmare
        deschisa={confirmaStergerea}
        onInchide={() => setConfirmaStergerea(false)}
        onConfirma={() => void stergeNotita()}
        titlu="Ștergi notița?"
        mesaj={`„${notita.titlu}” dispare din calendar. Operațiunea rămâne în jurnal.`}
        etichetaConfirmare="Șterge"
        periculoasa
        inCurs={sterge.isPending}
      />
    </>
  )
}
