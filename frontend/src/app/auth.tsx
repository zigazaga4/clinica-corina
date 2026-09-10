import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import {
  citesteTokenuri,
  descriereDispozitiv,
  scrieTokenuri,
  stergeTokenuri,
} from '@/api/session'
import type { Utilizator } from '@/domain/types'

/*
  Starea de autentificare.

  Contractul cere la art. 3.1.D două roluri — administrator (acces complet) și
  utilizator (acces de operare). Verificarea rolului se face în DOUĂ locuri, și
  ambele sunt necesare:

    - aici, în interfață, ca să nu afișăm butoane care oricum ar fi respinse;
    - pe server, ca decizie reală de securitate.

  Ascunderea unui buton nu este o măsură de protecție: cine trimite cererea
  direct ocolește interfața cu totul. De aceea implementarea în memorie aplică
  aceleași verificări de rol ca serverul.
*/

interface StareAutentificare {
  utilizator: Utilizator | null
  /** Prima verificare a sesiunii salvate, la pornirea aplicației. */
  seVerifica: boolean
  esteAdministrator: boolean
  autentifica: (email: string, parola: string) => Promise<void>
  delogheaza: () => Promise<void>
}

const Context = createContext<StareAutentificare | null>(null)

export function FurnizorAutentificare({ children }: { children: ReactNode }) {
  const [utilizator, setUtilizator] = useState<Utilizator | null>(null)
  const [seVerifica, setSeVerifica] = useState(true)
  const queryClient = useQueryClient()

  // La pornire: dacă există token-uri salvate, aflăm cui aparțin. Contul poate
  // fi între timp dezactivat sau sesiunea revocată de un administrator, caz în
  // care serverul întoarce null și ecranul de autentificare apare firesc.
  useEffect(() => {
    let anulat = false

    const verifica = async () => {
      if (!citesteTokenuri()) {
        if (!anulat) setSeVerifica(false)
        return
      }
      try {
        const gasit = await api.auth.utilizatorCurent()
        if (anulat) return
        if (gasit) setUtilizator(gasit)
        else stergeTokenuri()
      } catch {
        if (!anulat) stergeTokenuri()
      } finally {
        if (!anulat) setSeVerifica(false)
      }
    }

    void verifica()
    return () => {
      anulat = true
    }
  }, [])

  const autentifica = useCallback(
    async (email: string, parola: string) => {
      const raspuns = await api.auth.login({
        email,
        parola,
        dispozitiv: descriereDispozitiv(),
      })
      scrieTokenuri({
        access_token: raspuns.access_token,
        refresh_token: raspuns.refresh_token,
        expira_la: raspuns.expira_la,
      })
      setUtilizator(raspuns.utilizator)
    },
    [],
  )

  const delogheaza = useCallback(async () => {
    const tokenuri = citesteTokenuri()
    try {
      if (tokenuri) await api.auth.logout(tokenuri.refresh_token)
    } catch {
      // Dacă serverul nu poate fi contactat, sesiunea locală se închide oricum:
      // a rămâne conectat pentru că delogarea a eșuat este exact pe dos.
    } finally {
      stergeTokenuri()
      setUtilizator(null)
      // Datele altui cont nu trebuie să rămână în memoria cache după schimbarea
      // utilizatorului — inclusiv listele vizibile doar administratorului.
      queryClient.clear()
    }
  }, [queryClient])

  const valoare = useMemo<StareAutentificare>(
    () => ({
      utilizator,
      seVerifica,
      esteAdministrator: utilizator?.rol === 'administrator',
      autentifica,
      delogheaza,
    }),
    [utilizator, seVerifica, autentifica, delogheaza],
  )

  return <Context.Provider value={valoare}>{children}</Context.Provider>
}

export function useAutentificare(): StareAutentificare {
  const context = useContext(Context)
  if (!context) {
    throw new Error('useAutentificare trebuie folosit în interiorul <FurnizorAutentificare>.')
  }
  return context
}

/**
 * Utilizatorul autentificat, garantat.
 * Se folosește sub `<RutaProtejata>`, unde absența lui este imposibilă.
 */
export function useUtilizator(): Utilizator {
  const { utilizator } = useAutentificare()
  if (!utilizator) throw new Error('Nu există un utilizator autentificat în acest context.')
  return utilizator
}
