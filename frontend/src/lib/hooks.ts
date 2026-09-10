import { useCallback, useEffect, useRef, useState } from 'react'

/** Închide un panou la clic în afara lui sau la Escape. */
export function useInchidereExterna<T extends HTMLElement>(
  activ: boolean,
  onInchide: () => void,
) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!activ) return

    const laClic = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onInchide()
    }
    const laTasta = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onInchide()
    }

    // `mousedown`, nu `click`: altfel un element care dispare la apăsare ar
    // face ca evenimentul `click` să se termine pe alt element.
    document.addEventListener('mousedown', laClic)
    document.addEventListener('touchstart', laClic)
    document.addEventListener('keydown', laTasta)
    return () => {
      document.removeEventListener('mousedown', laClic)
      document.removeEventListener('touchstart', laClic)
      document.removeEventListener('keydown', laTasta)
    }
  }, [activ, onInchide])

  return ref
}

/**
 * Întârzie o valoare până când încetează să se schimbe.
 *
 * Căutarea de clienți se face la fiecare tastă apăsată. Fără această pauză,
 * „Popescu” ar declanșa șapte cereri, iar răspunsurile ar putea sosi în altă
 * ordine decât au plecat, afișând rezultatele pentru „Popes”.
 */
export function useIntarziat<T>(valoare: T, ms = 250): T {
  const [intarziata, setIntarziata] = useState(valoare)

  useEffect(() => {
    const cronometru = setTimeout(() => setIntarziata(valoare), ms)
    return () => clearTimeout(cronometru)
  }, [valoare, ms])

  return intarziata
}

/** Adevărat cât timp interogarea media este satisfăcută. */
export function useMediaQuery(interogare: string): boolean {
  const [potrivit, setPotrivit] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(interogare).matches
  })

  useEffect(() => {
    const lista = window.matchMedia(interogare)
    const laSchimbare = (e: MediaQueryListEvent) => setPotrivit(e.matches)
    setPotrivit(lista.matches)
    lista.addEventListener('change', laSchimbare)
    return () => lista.removeEventListener('change', laSchimbare)
  }, [interogare])

  return potrivit
}

/** Pragul `sm` din Tailwind — sub el se folosesc variantele pentru telefon. */
export function useEcranMic(): boolean {
  return !useMediaQuery('(min-width: 640px)')
}

/** Valoare păstrată în localStorage, cu revenire la o valoare implicită. */
export function useStocare<T>(cheie: string, implicita: T): [T, (v: T) => void] {
  const [valoare, setValoare] = useState<T>(() => {
    try {
      const brut = localStorage.getItem(cheie)
      return brut === null ? implicita : (JSON.parse(brut) as T)
    } catch {
      return implicita
    }
  })

  const scrie = useCallback(
    (noua: T) => {
      setValoare(noua)
      try {
        localStorage.setItem(cheie, JSON.stringify(noua))
      } catch {
        // Spațiu plin sau stocare blocată: preferăm o setare nepăstrată unei
        // aplicații care se oprește.
      }
    },
    [cheie],
  )

  return [valoare, scrie]
}
