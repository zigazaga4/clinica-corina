import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import { esteModDemo } from '@/api'
import { mesajEroare } from '@/api/errors'
import { PAROLA_DEMO } from '@/api/memory/seed'
import { useAutentificare } from '@/app/auth'
import { Buton, Card, IncarcarePagina, Input } from '@/ui'

/**
 * Ecranul de autentificare (art. 3.1.D — „autentificare pe bază de utilizator
 * și parolă”).
 *
 * Nu există înregistrare de conturi: art. 3.1.D prevede că acestea se creează
 * exclusiv din contul de administrator. Nu există nici „am uitat parola” —
 * resetarea trece tot prin administrator, potrivit aceleiași cerințe.
 */
export function PaginaAutentificare() {
  const { utilizator, seVerifica, autentifica } = useAutentificare()
  const location = useLocation()

  const [email, setEmail] = useState(esteModDemo ? 'admin@clinica.ro' : '')
  const [parola, setParola] = useState(esteModDemo ? PAROLA_DEMO : '')
  const [aratParola, setAratParola] = useState(false)
  const [eroare, setEroare] = useState<string | null>(null)
  const [seTrimite, setSeTrimite] = useState(false)

  if (seVerifica) return <IncarcarePagina text="Se verifică sesiunea…" />

  if (utilizator) {
    // Revenire la ecranul cerut înainte de expirarea sesiunii.
    const destinatie = (location.state as { de_la?: string } | null)?.de_la ?? '/programari'
    return <Navigate to={destinatie} replace />
  }

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    setEroare(null)
    setSeTrimite(true)
    try {
      await autentifica(email, parola)
    } catch (err) {
      setEroare(mesajEroare(err))
      setSeTrimite(false)
    }
    // La succes nu oprim indicatorul: componenta se demontează prin redirectare,
    // iar o actualizare de stare pe un component demontat ar fi inutilă.
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-4 pt-sigur pb-sigur">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex size-13 items-center justify-center rounded-2xl bg-primary-600 text-white">
            <svg viewBox="0 0 24 24" fill="none" className="size-7" aria-hidden>
              <path
                d="M12 21c4.97-3.2 7.5-6.5 7.5-9.9A5.1 5.1 0 0 0 12 6.6a5.1 5.1 0 0 0-7.5 4.5c0 3.4 2.53 6.7 7.5 9.9Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path d="M12 6.6V3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-ink">Gestiune Clinică</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Aplicație internă. Autentifică-te pentru a continua.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={trimite} className="flex flex-col gap-4" noValidate>
            {/*
              Se intră cu numele, nu cu adresa.

              `type="text"`, nu `"email"`: pe telefon, tipul cerea tastatura cu
              „@” și „.ro”, iar iOS refuza să pornească un cuvânt cu majusculă.
              Serverul acceptă în continuare și adresa (v. POST /auth/login),
              deci cine o tastează din obișnuință intră la fel de bine.
            */}
            <Input
              eticheta="Nume"
              type="text"
              autoComplete="username"
              autoCapitalize="words"
              autoFocus
              obligatoriu
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              pictograma={<User className="size-4" />}
              placeholder="Irina"
            />

            <Input
              eticheta="Parolă"
              type={aratParola ? 'text' : 'password'}
              autoComplete="current-password"
              obligatoriu
              value={parola}
              onChange={(e) => setParola(e.target.value)}
              pictograma={<Lock className="size-4" />}
              sufix={
                <button
                  type="button"
                  onClick={() => setAratParola((v) => !v)}
                  aria-label={aratParola ? 'Ascunde parola' : 'Arată parola'}
                  className="rounded-md p-1 text-ink-faint transition-colors hover:text-ink"
                >
                  {aratParola ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />

            {eroare && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                {eroare}
              </p>
            )}

            <Buton
              type="submit"
              varianta="primar"
              dimensiune="lg"
              plin
              incarca={seTrimite}
              disabled={email.trim() === '' || parola === ''}
            >
              Autentificare
            </Buton>
          </form>
        </Card>

        {esteModDemo && <ConturiDemo onAlege={setEmail} />}

        <p className="mt-6 text-center text-[11px] text-ink-faint">
          Conturile se creează și se resetează din contul de administrator.
        </p>
      </div>
    </div>
  )
}

const CONTURI_DEMO = [
  { email: 'admin@clinica.ro', rol: 'Administrator — acces complet' },
  { email: 'andreea.popescu@clinica.ro', rol: 'Utilizator — acces de operare' },
  { email: 'diana.georgescu@clinica.ro', rol: 'Cont dezactivat — nu se poate conecta' },
]

/**
 * Conturile de probă, afișate doar în modul demo.
 *
 * Includem intenționat și contul dezactivat: art. 3.1.D cere dezactivarea
 * conturilor, iar comportamentul acela trebuie să poată fi verificat de
 * Beneficiar la recepție, nu doar descris.
 */
function ConturiDemo({ onAlege }: { onAlege: (email: string) => void }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-line bg-surface/60 p-3">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        Conturi demonstrative · parola „{PAROLA_DEMO}”
      </p>
      <div className="flex flex-col gap-1">
        {CONTURI_DEMO.map((cont) => (
          <button
            key={cont.email}
            type="button"
            onClick={() => onAlege(cont.email)}
            className="rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
          >
            <span className="block truncate text-[13px] font-medium text-ink">{cont.email}</span>
            <span className="block truncate text-[11px] text-ink-faint">{cont.rol}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
