import { useState } from 'react'
import { KeyRound, Lock } from 'lucide-react'
import type { AccesStatistici } from '@/api/contract'
import { useAutentificare } from '@/app/auth'
import { Buton } from '@/ui'
import { ModalaParolaStatistici } from './ModalaParolaStatistici'

/**
 * „Schimbă parola” (doar administratorul) și „Încuie”, în antetul oricărui
 * ecran deschis cu parola statisticilor.
 *
 * Starea ferestrei de schimbare stă aici, nu în pagină: când ecranul se
 * încuie, butoanele dispar odată cu ea, iar la următoarea deblocare fereastra
 * nu mai apare deschisă din senin.
 */
export function ButoaneAcces({
  onIncuie,
  onSchimbata,
}: {
  onIncuie: () => void
  /** Parola s-a schimbat: noua deblocare înlocuiește vechea. */
  onSchimbata: (acces: AccesStatistici) => void
}) {
  const { esteAdministrator } = useAutentificare()
  const [schimbaParola, setSchimbaParola] = useState(false)

  return (
    <>
      {esteAdministrator && (
        <Buton
          varianta="discret"
          onClick={() => setSchimbaParola(true)}
          // Pe telefon rămâne doar cheia; numele trebuie să existe oricum.
          aria-label="Schimbă parola statisticilor"
          title="Schimbă parola statisticilor"
        >
          <KeyRound className="size-4" />
          <span className="hidden sm:inline">Schimbă parola</span>
        </Buton>
      )}
      <Buton varianta="secundar" onClick={onIncuie}>
        <Lock className="size-4" />
        Încuie
      </Buton>
      <ModalaParolaStatistici
        deschisa={schimbaParola}
        onInchide={() => setSchimbaParola(false)}
        onSchimbata={onSchimbata}
      />
    </>
  )
}
