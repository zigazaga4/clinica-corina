import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { uuid } from '@/lib/id'

/*
  Notificările scurte.

  Rolul lor este să confirme că o acțiune s-a produs. Într-o aplicație de
  gestiune, „s-a salvat?” este întrebarea care generează cele mai multe
  dubluri: fără confirmare, operatoarea reapasă butonul și înregistrează
  vânzarea de două ori.

  Erorile NU se închid singure — dacă o salvare a eșuat, mesajul trebuie citit,
  nu ratat pentru că a dispărut în trei secunde.
*/

export type FelNotificare = 'succes' | 'eroare' | 'atentie' | 'info'

export interface Notificare {
  id: string
  fel: FelNotificare
  titlu: string
  descriere?: string
}

interface ContextNotificari {
  arata: (notificare: Omit<Notificare, 'id'>) => void
  succes: (titlu: string, descriere?: string) => void
  eroare: (titlu: string, descriere?: string) => void
}

const Context = createContext<ContextNotificari | null>(null)

const DURATA_IMPLICITA = 4000

export function FurnizorNotificari({ children }: { children: ReactNode }) {
  const [notificari, setNotificari] = useState<Notificare[]>([])
  // Cronometrele se rețin ca să poată fi anulate la închiderea manuală —
  // altfel un temporizator orfan ar încerca să scoată un element deja scos.
  const cronometre = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const inchide = useCallback((id: string) => {
    const cronometru = cronometre.current.get(id)
    if (cronometru) {
      clearTimeout(cronometru)
      cronometre.current.delete(id)
    }
    setNotificari((lista) => lista.filter((n) => n.id !== id))
  }, [])

  const arata = useCallback(
    (notificare: Omit<Notificare, 'id'>) => {
      const id = uuid()
      setNotificari((lista) => {
        // Cel mult trei simultan: un teanc mai înalt acoperă interfața.
        const urmatoare = [...lista, { ...notificare, id }]
        return urmatoare.slice(-3)
      })
      if (notificare.fel !== 'eroare') {
        cronometre.current.set(
          id,
          setTimeout(() => inchide(id), DURATA_IMPLICITA),
        )
      }
    },
    [inchide],
  )

  const valoare = useMemo<ContextNotificari>(
    () => ({
      arata,
      succes: (titlu, descriere) =>
        arata({ fel: 'succes', titlu, ...(descriere ? { descriere } : {}) }),
      eroare: (titlu, descriere) =>
        arata({ fel: 'eroare', titlu, ...(descriere ? { descriere } : {}) }),
    }),
    [arata],
  )

  return (
    <Context.Provider value={valoare}>
      {children}
      <ZonaNotificari notificari={notificari} onInchide={inchide} />
    </Context.Provider>
  )
}

export function useNotificari(): ContextNotificari {
  const context = useContext(Context)
  if (!context) {
    throw new Error('useNotificari trebuie folosit în interiorul <FurnizorNotificari>.')
  }
  return context
}

const pictograme: Record<FelNotificare, ReactNode> = {
  succes: <CheckCircle2 className="size-4.5" />,
  eroare: <XCircle className="size-4.5" />,
  atentie: <AlertTriangle className="size-4.5" />,
  info: <Info className="size-4.5" />,
}

const tonuri: Record<FelNotificare, string> = {
  succes: 'text-success',
  eroare: 'text-danger',
  atentie: 'text-warning',
  info: 'text-info',
}

function ZonaNotificari({
  notificari,
  onInchide,
}: {
  notificari: Notificare[]
  onInchide: (id: string) => void
}) {
  return (
    <div
      // `aria-live` anunță mesajul fără să mute focalizarea din formular.
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed z-50 flex flex-col gap-2',
        // Pe telefon apar sus: jos ar acoperi bara de navigație.
        'inset-x-3 top-3 pt-sigur',
        'sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:w-88',
      )}
    >
      {notificari.map((notificare) => (
        <div
          key={notificare.id}
          role={notificare.fel === 'eroare' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-xl border border-line',
            'bg-elevated p-3 shadow-(--umbra-ridicat)',
            'anim-intrare-modala',
          )}
        >
          <span className={cn('mt-px shrink-0', tonuri[notificare.fel])} aria-hidden>
            {pictograme[notificare.fel]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{notificare.titlu}</p>
            {notificare.descriere && (
              <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
                {notificare.descriere}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onInchide(notificare.id)}
            aria-label="Închide notificarea"
            className="-m-1 shrink-0 rounded-md p-1 text-ink-faint transition-colors hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
