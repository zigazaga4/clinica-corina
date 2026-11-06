import { useCallback, useEffect, useState } from 'react'
import type { AccesStatistici } from '@/api/contract'
import { useBlocheazaStatistici, useLaStatisticiIncuiate } from '@/app/queries'

/**
 * Deblocarea statisticilor, pentru orice ecran care stă în spatele parolei lor
 * („Statistici” și „Ședințe pe persoane”): cine e deblocat, de ce s-a încuiat
 * din nou, și toate felurile în care o deblocare ia sfârșit.
 *
 * Deblocarea nu supraviețuiește plecării din pagină: la întoarcere, parola se
 * cere din nou, iar cifrele citite înainte sunt deja șterse din memorie. La
 * fel după o oră, după o schimbare de parolă și după reîncărcarea aplicației.
 */
export function useAccesStatistici() {
  const [acces, setAcces] = useState<AccesStatistici | null>(null)
  const [motiv, setMotiv] = useState<string | null>(null)
  const uita = useBlocheazaStatistici()

  const incuie = useCallback((mesaj: string | null) => {
    setAcces(null)
    setMotiv(mesaj)
  }, [])

  const deschide = useCallback((nou: AccesStatistici) => {
    setAcces(nou)
    setMotiv(null)
  }, [])

  /*
    Deblocarea se uită abia DUPĂ ce filele s-au închis — de aceea într-un
    efect, nu în `incuie`: cât timp mai erau pe ecran, ștergerea cifrelor de
    sub ele le-ar fi făcut să le ceară din nou, fără deblocare.
  */
  useEffect(() => {
    if (!acces) uita()
  }, [acces, uita])

  // Plecarea din pagină încuie. Nimic din ce s-a citit nu rămâne în urmă.
  useEffect(() => uita, [uita])

  // O oră mai târziu, serverul oricum refuză; ecranul se încuie la timp.
  useEffect(() => {
    if (!acces) return undefined
    const ramas = Math.max(0, new Date(acces.expira_la).getTime() - Date.now())
    const ceas = setTimeout(
      () => incuie('Statisticile s-au încuiat singure după o oră. Scrie din nou parola.'),
      ramas,
    )
    return () => clearTimeout(ceas)
  }, [acces, incuie])

  /*
    Un calculator adormit nu-și rulează ceasurile: la trezire, cronometrul de
    mai sus poate întârzia, iar cifrele ar sta pe ecran peste termen. La
    fiecare întoarcere în fereastră se verifică din nou.
  */
  useEffect(() => {
    if (!acces) return undefined
    const laIntoarcere = () => {
      if (document.visibilityState === 'visible' && Date.now() >= new Date(acces.expira_la).getTime()) {
        incuie('Statisticile s-au încuiat singure după o oră. Scrie din nou parola.')
      }
    }
    document.addEventListener('visibilitychange', laIntoarcere)
    return () => document.removeEventListener('visibilitychange', laIntoarcere)
  }, [acces, incuie])

  // Serverul a refuzat o cerere: parola s-a schimbat în altă parte, sau ceasul
  // calculatorului a luat-o înainte.
  useLaStatisticiIncuiate(incuie)

  return { acces, motiv, deschide, incuie }
}
