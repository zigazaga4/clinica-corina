import { useConturiAlese } from '@/components/selectoare'
import type { Uuid } from '@/domain/types'
import { ButonGrup, GrupButoane } from '@/ui'

/**
 * Pe cine privim: toată clinica sau câte o persoană, ca butoane la vedere.
 *
 * Proprietara a cerut „o statistică și pentru Anda” și n-a găsit-o în lista
 * ascunsă a unui selector (4 nov. 2026): cu două conturi, butoanele se văd dintr-o
 * privire și un clic duce de la „Toată clinica” la fiecare. `valoare` este
 * `null` pentru toată clinica, altfel id-ul contului ales.
 */
export function AlegerePersoana({
  valoare,
  onSchimba,
  eticheta = 'Persoana',
  toti = 'Toată clinica',
}: {
  valoare: Uuid | null
  onSchimba: (id: Uuid | null) => void
  eticheta?: string
  /** Textul butonului care înseamnă „nimeni anume”; `null` = ecranul nu are așa ceva, doar persoane. */
  toti?: string | null
}) {
  const { conturi } = useConturiAlese()

  return (
    // `max-w-full`: bara de filtre nu-și lasă copiii să se strângă, iar fără el
    // butoanele nu mai treceau pe rândul următor pe un telefon.
    <div className="flex max-w-full flex-col gap-1">
      <span className="text-[12px] font-medium text-ink-soft">{eticheta}</span>
      <GrupButoane eticheta={eticheta} className="flex-wrap">
        {toti !== null && (
          <ButonGrup activ={valoare === null} onClick={() => onSchimba(null)}>
            {toti}
          </ButonGrup>
        )}
        {conturi.map((cont) => (
          <ButonGrup key={cont.id} activ={valoare === cont.id} onClick={() => onSchimba(cont.id)}>
            {cont.nume}
          </ButonGrup>
        ))}
      </GrupButoane>
    </div>
  )
}
