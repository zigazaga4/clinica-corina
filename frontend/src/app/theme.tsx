import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useStocare } from '@/lib/hooks'

/**
 * Tema vizuală.
 *
 * „sistem” urmărește setarea sistemului de operare — implicit, pentru că o
 * aplicație de birou care rămâne albă când Windows este pe temă întunecată
 * arată ca o pagină web rătăcită, nu ca un program.
 */
export type Tema = 'sistem' | 'deschisa' | 'intunecata'

interface ContextTema {
  tema: Tema
  setTema: (tema: Tema) => void
  /** Tema aplicată efectiv, după rezolvarea lui „sistem”. */
  intunecata: boolean
}

const Context = createContext<ContextTema | null>(null)

export function FurnizorTema({ children }: { children: ReactNode }) {
  const [tema, setTema] = useStocare<Tema>('clinica.tema', 'sistem')

  useEffect(() => {
    const lista = window.matchMedia('(prefers-color-scheme: dark)')

    const aplica = () => {
      const intunecata = tema === 'intunecata' || (tema === 'sistem' && lista.matches)
      document.documentElement.classList.toggle('dark', intunecata)
      // Informează webview-ul, ca elementele native (bare de derulare, câmpuri
      // de dată) să se deseneze în aceeași gamă.
      document.documentElement.style.colorScheme = intunecata ? 'dark' : 'light'
    }

    aplica()
    // Doar modul „sistem” trebuie să reacționeze la schimbarea din OS.
    if (tema === 'sistem') {
      lista.addEventListener('change', aplica)
      return () => lista.removeEventListener('change', aplica)
    }
    return undefined
  }, [tema])

  const valoare = useMemo<ContextTema>(
    () => ({
      tema,
      setTema,
      intunecata: document.documentElement.classList.contains('dark'),
    }),
    [tema, setTema],
  )

  return <Context.Provider value={valoare}>{children}</Context.Provider>
}

export function useTema(): ContextTema {
  const context = useContext(Context)
  if (!context) throw new Error('useTema trebuie folosit în interiorul <FurnizorTema>.')
  return context
}
