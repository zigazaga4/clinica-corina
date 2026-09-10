import { useCallback, useState } from 'react'
import { campVinovat, mesajEroare } from '@/api/errors'

/**
 * Legarea erorilor de server de câmpurile formularului.
 *
 * Serverul întoarce, pentru erorile de validare, câmpul vinovat (`camp`).
 * Fără acest hook, fiecare formular ar afișa mesajul într-o bandă generală de
 * sus, iar utilizatorul ar trebui să ghicească la care dintre cele opt câmpuri
 * se referă „Prețul nu poate fi negativ”.
 *
 * Erorile fără câmp (conflict de suprapunere, lipsă de drepturi) rămân în
 * `general` și se afișează deasupra butoanelor de acțiune.
 */
export function useEroriFormular<T extends string = string>() {
  const [peCamp, setPeCamp] = useState<Partial<Record<T, string>>>({})
  const [general, setGeneral] = useState<string | null>(null)

  const goleste = useCallback(() => {
    setPeCamp({})
    setGeneral(null)
  }, [])

  /** Distribuie o eroare prinsă de la API către câmp sau către banda generală. */
  const preia = useCallback((e: unknown) => {
    const camp = campVinovat(e)
    if (camp) {
      setPeCamp({ [camp]: mesajEroare(e) } as Partial<Record<T, string>>)
      setGeneral(null)
      return
    }
    setPeCamp({})
    setGeneral(mesajEroare(e))
  }, [])

  /** Marchează manual un câmp, pentru validările făcute înainte de trimitere. */
  const setCamp = useCallback((camp: T, mesaj: string | null) => {
    setPeCamp((precedente) => {
      const urmatoare = { ...precedente }
      if (mesaj === null) delete urmatoare[camp]
      else urmatoare[camp] = mesaj
      return urmatoare
    })
  }, [])

  return { peCamp, general, goleste, preia, setCamp }
}
