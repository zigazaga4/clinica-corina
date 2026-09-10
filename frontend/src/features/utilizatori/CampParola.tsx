import { useState, type ReactNode } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { Buton, Input } from '@/ui'

/**
 * Câmpul de parolă.
 *
 * Administratorul stabilește parola altcuiva și i-o comunică pe loc, deci are
 * nevoie să o poată citi cât o tastează — altfel o greșeală de tastare se
 * descoperă abia când colega nu se mai poate autentifica. Comutatorul de
 * vizibilitate este singurul loc din aplicație în care parola apare pe ecran:
 * nu intră în rezumate, în notificări sau în jurnal (§7 — resetarea
 * înregistrează faptul, nu valoarea).
 */

/** Regula serverului (`verificaParola`), repetată aici ca să nu trimitem cereri sortite eșecului. */
export const PAROLA_MINIM = 8

export function CampParola({
  eticheta,
  valoare,
  onSchimba,
  eroare,
  ajutor,
  autoFocus,
}: {
  eticheta: string
  valoare: string
  onSchimba: (valoare: string) => void
  eroare?: string | null
  ajutor?: ReactNode
  autoFocus?: boolean
}) {
  const [vizibila, setVizibila] = useState(false)

  return (
    <Input
      eticheta={eticheta}
      // `new-password` oprește gestionarele de parole să completeze aici
      // parola administratorului conectat, peste cea a contului editat.
      autoComplete="new-password"
      type={vizibila ? 'text' : 'password'}
      obligatoriu
      autoFocus={autoFocus}
      value={valoare}
      onChange={(e) => onSchimba(e.target.value)}
      eroare={eroare ?? null}
      ajutor={ajutor}
      pictograma={<Lock className="size-4" />}
      sufix={
        <Buton
          varianta="discret"
          dimensiune="icon-sm"
          onClick={() => setVizibila((v) => !v)}
          aria-label={vizibila ? 'Ascunde parola' : 'Arată parola'}
        >
          {vizibila ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Buton>
      }
    />
  )
}
