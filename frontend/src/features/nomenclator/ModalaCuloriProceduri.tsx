import { useState } from 'react'
import { Palette } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useArticole, useModificaArticol } from '@/app/queries'
import type { Uuid } from '@/domain/types'
import { formateazaDurata } from '@/lib/dates'
import { Buton, Modala, PaletaCulori, PunctCuloare, StareEroare, useNotificari } from '@/ui'

/*
  Culoarea fiecărei proceduri, toate într-un singur loc.

  Culoarea unui serviciu se putea schimba și până acum, dar doar deschizând
  serviciul în Nomenclator, câte unul, în mijlocul altor câmpuri — greu de găsit
  pentru cine vrea doar „vreau tratamentele în albastru, ceaiul în verde”.
  Aici stau toate procedurile pe o singură listă, fiecare cu paleta ei.

  Se salvează pe loc, la apăsare: nu există „Salvează” de uitat. Programările din
  calendar își schimbă culoarea de îndată ce serverul confirmă, fiindcă citesc
  aceeași listă de servicii.

  Orice cont o poate folosi: PATCH /articole e rezervat administratorului,
  dar o cerere care schimbă doar `culoare` e lăsată și recepției — culoarea nu
  atinge prețul sau durata, ci doar felul în care se vede calendarul.
*/

/**
 * Se montează doar cât e deschisă (`{deschisa && <ModalaCuloriProceduri … />}`),
 * ca fiecare deschidere să pornească de la lista de pe server, fără culorile
 * „în așteptare” ale deschiderii precedente.
 */
export function ModalaCuloriProceduri({ onInchide }: { onInchide: () => void }) {
  // Aceeași cerere ca a calendarului și a Nomenclatorului: din memoria cache,
  // fără drum în plus la server.
  const servicii = useArticole({ tip: 'serviciu' })
  const modifica = useModificaArticol()
  const notificari = useNotificari()

  /*
    Culoarea aleasă și încă nesosită de la server.

    Fără ea, bulina ar rămâne pe culoarea veche o fracțiune de secundă după
    apăsare — pe o rețea de telefon, câteva secunde — și ar părea că apăsarea n-a
    mers. O culoare respinsă de server își scoate singură rândul de aici.
  */
  const [alese, setAlese] = useState<Record<Uuid, string | null>>({})

  const alege = async (id: Uuid, denumire: string, hex: string | null) => {
    setAlese((a) => ({ ...a, [id]: hex }))
    try {
      await modifica.mutateAsync({ id, date: { culoare: hex } })
    } catch (eroare) {
      setAlese((a) => {
        const { [id]: _, ...restul } = a
        return restul
      })
      notificari.eroare(`Nu am putut schimba culoarea pentru „${denumire}”`, mesajEroare(eroare))
    }
  }

  // Serviciile scoase din ofertă nu se mai programează: n-au ce culoare primi.
  const active = (servicii.data ?? []).filter((s) => s.activ)

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      titlu="Culorile procedurilor"
      descriere="Alege o culoare pentru fiecare procedură. Programările ei se văd în culoarea aleasă, în calendar. Se salvează pe loc."
      dimensiune="lg"
      subsol={
        <Buton varianta="primar" onClick={onInchide} className="sm:w-auto" plin>
          Gata
        </Buton>
      }
    >
      {servicii.isError ? (
        <StareEroare mesaj={mesajEroare(servicii.error)} onReincearca={() => void servicii.refetch()} />
      ) : active.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">
          {servicii.isPending
            ? 'Se încarcă procedurile…'
            : 'Nu ai încă nicio procedură în nomenclator. Adaug-o mai întâi, apoi îi alegi culoarea.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {active.map((serviciu) => {
            const culoare = serviciu.id in alese ? (alese[serviciu.id] ?? null) : serviciu.culoare
            return (
              <li key={serviciu.id} className="rounded-xl p-3 ring-1 ring-line ring-inset">
                <div className="mb-2.5 flex items-center gap-2">
                  {culoare ? (
                    <PunctCuloare hex={culoare} className="size-3" />
                  ) : (
                    <Palette className="size-3 text-ink-faint" aria-hidden />
                  )}
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {serviciu.denumire}
                  </p>
                  {serviciu.durata_minute != null && (
                    <span className="shrink-0 text-[13px] text-ink-faint">
                      {formateazaDurata(serviciu.durata_minute)}
                    </span>
                  )}
                </div>
                <PaletaCulori
                  eticheta={`Culoarea procedurii ${serviciu.denumire}`}
                  valoare={culoare}
                  onSchimba={(hex) => void alege(serviciu.id, serviciu.denumire, hex)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Modala>
  )
}
