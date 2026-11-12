import { useState } from 'react'
import { Input, Select } from './Field'

/*
  Alegerea unei ore: o listă pentru orele obișnuite, un câmp liber pentru restul.

  Recepția programează aproape mereu din sfert în sfert — o listă în care se
  apasă o dată merge mai repede decât orice câmp tastat. Dar uneori ora nu e
  rotundă: o clientă vine „la 9 și 43” după ce a sunat din mașină. Pentru
  asta, ultimul rând al listei, „Altă oră…”, deschide un câmp de oră cu
  minutul exact (pe telefon se alege din roata nativă a sistemului).

  O valoare care nu e în listă (o programare veche la 14:07, sau una abia
  tastată) trece singură în câmpul liber: așa ora adevărată se vede și se
  poate corecta, în loc să fie înlocuită în tăcere cu cea mai apropiată din
  listă.
*/

const ALTA_ORA = '__alta_ora__'
const FORMA_ORA = /^\d{2}:\d{2}$/

/** „09:43” -> minute de la miezul nopții. */
function inMinute(ora: string): number {
  const [h = '0', m = '0'] = ora.split(':')
  return Number(h) * 60 + Number(m)
}

function dinMinute(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Orele din listă, de la `deLa` la `panaLa` (minute de la miezul nopții), din `pas` în `pas`. */
export function oreDinPas(pas = 15, deLa = 6 * 60, panaLa = 22 * 60): string[] {
  const ore: string[] = []
  for (let minut = deLa; minut <= panaLa; minut += pas) ore.push(dinMinute(minut))
  return ore
}

export interface CampOraProps {
  eticheta?: string
  /** `HH:mm`, sau gol. */
  value: string
  onChange: (ora: string) => void
  obligatoriu?: boolean
  eroare?: string | null
  /** Pasul listei, în minute. */
  pas?: number
  /** Capetele listei, în minute de la miezul nopții. */
  deLa?: number
  panaLa?: number
}

export function CampOra({
  eticheta = 'Ora',
  value,
  onChange,
  obligatoriu,
  eroare,
  pas = 15,
  deLa = 6 * 60,
  panaLa = 22 * 60,
}: CampOraProps) {
  const ore = oreDinPas(pas, deLa, panaLa)
  // „Altă oră…” apăsată explicit; altfel, câmpul liber apare doar pentru o
  // valoare care nu se află în listă.
  const [alesLiber, setAlesLiber] = useState(false)
  // Ce s-a tastat până acum, cât timp ora nu e încă completă (câmpul de oră
  // raportează „gol” pe parcurs): fără asta, câmpul controlat ar șterge cifrele.
  const [schita, setSchita] = useState<string | null>(null)

  const liber = alesLiber || (value !== '' && !ore.includes(value))

  if (!liber) {
    return (
      <Select
        eticheta={eticheta}
        obligatoriu={obligatoriu}
        eroare={eroare}
        value={value}
        onChange={(e) => {
          if (e.target.value === ALTA_ORA) setAlesLiber(true)
          else onChange(e.target.value)
        }}
      >
        {ore.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={ALTA_ORA}>Altă oră…</option>
      </Select>
    )
  }

  /** Înapoi la listă: ora liberă se rotunjește la cea mai apropiată din ea. */
  const revineLaLista = () => {
    if (value !== '' && !ore.includes(value)) {
      const minute = inMinute(value)
      const rotunjita = Math.round((minute - deLa) / pas) * pas + deLa
      onChange(dinMinute(Math.min(Math.max(rotunjita, deLa), panaLa)))
    }
    setSchita(null)
    setAlesLiber(false)
  }

  return (
    <Input
      eticheta={eticheta}
      obligatoriu={obligatoriu}
      eroare={eroare}
      type="time"
      step={60}
      // `autoFocus` doar când ora liberă a fost cerută acum, nu la o valoare
      // deja neobișnuită: formularul nu trebuie să fure atenția la deschidere.
      autoFocus={alesLiber}
      value={schita ?? value}
      onChange={(e) => {
        const nou = e.target.value
        if (FORMA_ORA.test(nou)) {
          setSchita(null)
          onChange(nou)
        } else {
          setSchita(nou)
        }
      }}
      onBlur={() => setSchita(null)}
      ajutor={
        <button
          type="button"
          onClick={revineLaLista}
          className="cursor-pointer text-primary-600 underline-offset-4 hover:text-primary-700 hover:underline"
        >
          Alege din listă
        </button>
      }
    />
  )
}
