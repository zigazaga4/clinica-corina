import { useState, type FormEvent, type ReactNode } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import type { AccesStatistici } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useAutentificare } from '@/app/auth'
import {
  useDeblocheazaStatistici,
  useSeteazaParolaStatistici,
  useStareParolaStatistici,
} from '@/app/queries'
import { useEroriFormular } from '@/lib/formular'
import { Buton, Card, Input, Spinner, StareEroare } from '@/ui'

/**
 * Ușa Statisticilor.
 *
 * Trei feluri de a o găsi:
 *   — parola există: se cere, și atât;
 *   — nu există încă, iar cine a venit e administrator: o alege acum;
 *   — nu există încă, iar cine a venit NU e administrator: află că trebuie
 *     să o aleagă întâi un administrator.
 *
 * Parola NU este cea a contului. Se spune asta pe ecran, fiindcă primul reflex
 * al oricui vede o căsuță de parolă este să scrie parola pe care o știe deja.
 */
export function PoartaStatistici({
  onDeschis,
  motiv,
}: {
  onDeschis: (acces: AccesStatistici) => void
  /** De ce s-a încuiat din nou — expirare, parolă schimbată. */
  motiv?: string | null
}) {
  const stare = useStareParolaStatistici()
  const { esteAdministrator } = useAutentificare()

  return (
    <div className="flex justify-center py-6 sm:py-12">
      <Card className="w-full max-w-md p-5 sm:p-6">
        {stare.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : stare.isError ? (
          <StareEroare mesaj={mesajEroare(stare.error)} onReincearca={() => void stare.refetch()} />
        ) : stare.data.parola_setata ? (
          <FormularDeblocare onDeschis={onDeschis} motiv={motiv} />
        ) : esteAdministrator ? (
          <FormularParolaNoua onDeschis={onDeschis} />
        ) : (
          <FaraParola />
        )}
      </Card>
    </div>
  )
}

function Antet({ titlu, text, pictograma }: { titlu: string; text: string; pictograma: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col items-center text-center">
      <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
        {pictograma}
      </span>
      <h2 className="text-lg font-semibold text-ink">{titlu}</h2>
      <p className="mt-1 text-[13px] text-ink-faint">{text}</p>
    </div>
  )
}

function FormularDeblocare({
  onDeschis,
  motiv,
}: {
  onDeschis: (acces: AccesStatistici) => void
  motiv?: string | null
}) {
  const [parola, setParola] = useState('')
  const erori = useEroriFormular<'parola'>()
  const deblocheaza = useDeblocheazaStatistici()

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()
    if (parola === '') return erori.setCamp('parola', 'Scrie parola statisticilor.')
    try {
      onDeschis(await deblocheaza.mutateAsync(parola))
    } catch (err) {
      erori.preia(err)
      setParola('')
    }
  }

  return (
    <form onSubmit={trimite} noValidate>
      <Antet
        pictograma={<LockKeyhole className="size-5" />}
        titlu="Statisticile sunt încuiate"
        text="Scrie parola statisticilor. Nu este parola contului tău — o știe doar cine are voie să vadă banii clinicii."
      />
      {motiv && (
        <p role="status" className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          {motiv}
        </p>
      )}
      <Input
        type="password"
        eticheta="Parola statisticilor"
        autoComplete="off"
        value={parola}
        onChange={(e) => setParola(e.target.value)}
        eroare={erori.peCamp.parola ?? null}
        autoFocus
      />
      {erori.general && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {erori.general}
        </p>
      )}
      <Buton type="submit" varianta="primar" plin incarca={deblocheaza.isPending} className="mt-4 w-full">
        Deschide statisticile
      </Buton>
    </form>
  )
}

/** Prima alegere a parolei — doar pentru administrator. */
function FormularParolaNoua({ onDeschis }: { onDeschis: (acces: AccesStatistici) => void }) {
  const [parola, setParola] = useState('')
  const [repetata, setRepetata] = useState('')
  const erori = useEroriFormular<'parola_noua' | 'repetata'>()
  const seteaza = useSeteazaParolaStatistici()

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()
    if (parola.length < 8) {
      return erori.setCamp('parola_noua', 'Parola trebuie să aibă cel puțin 8 caractere.')
    }
    if (repetata !== parola) return erori.setCamp('repetata', 'Cele două parole nu sunt la fel.')
    try {
      onDeschis(await seteaza.mutateAsync({ parola_noua: parola }))
    } catch (err) {
      erori.preia(err)
    }
  }

  return (
    <form onSubmit={trimite} noValidate className="flex flex-col gap-3.5">
      <Antet
        pictograma={<ShieldCheck className="size-5" />}
        titlu="Alege parola statisticilor"
        text="Încasările, cheltuielile și profitul se vor deschide doar cu această parolă. Alege una diferită de parola contului și spune-o numai cui trebuie să vadă cifrele."
      />
      <Input
        type="password"
        eticheta="Parola nouă"
        autoComplete="new-password"
        value={parola}
        onChange={(e) => setParola(e.target.value)}
        eroare={erori.peCamp.parola_noua ?? null}
        ajutor="Cel puțin 8 caractere."
        autoFocus
      />
      <Input
        type="password"
        eticheta="Scrie-o încă o dată"
        autoComplete="new-password"
        value={repetata}
        onChange={(e) => setRepetata(e.target.value)}
        eroare={erori.peCamp.repetata ?? null}
      />
      {erori.general && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {erori.general}
        </p>
      )}
      <Buton type="submit" varianta="primar" plin incarca={seteaza.isPending} className="mt-1 w-full">
        Salvează și deschide
      </Buton>
    </form>
  )
}

function FaraParola() {
  return (
    <Antet
      pictograma={<LockKeyhole className="size-5" />}
      titlu="Statisticile nu sunt încă deschise"
      text="Statisticile au o parolă a lor, pe care o alege un administrator la prima deschidere. Cere-i administratorului să o aleagă și să ți-o spună."
    />
  )
}
