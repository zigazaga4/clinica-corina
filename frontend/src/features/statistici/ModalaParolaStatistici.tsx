import { useState, type FormEvent } from 'react'
import type { AccesStatistici } from '@/api/contract'
import { useSeteazaParolaStatistici } from '@/app/queries'
import { useEroriFormular } from '@/lib/formular'
import { Buton, Input, Modala, useNotificari } from '@/ui'

type Camp = 'parola_curenta' | 'parola_noua' | 'repetata'

/**
 * Schimbarea parolei statisticilor — doar administratorul, și doar știind-o
 * pe cea veche. Rolul singur nu ajunge: contul de administrator poate fi
 * folosit și de alții, iar parola ar fi apărat atunci exact nimic.
 *
 * Statisticile deschise cu parola veche, pe orice calculator, nu mai primesc
 * nimic de la server din clipa salvării: se încuie la prima lor cerere — cel
 * târziu când omul se întoarce la fereastră. Aici rămân deschise, cu parola nouă.
 */
export function ModalaParolaStatistici({
  deschisa,
  onInchide,
  onSchimbata,
}: {
  deschisa: boolean
  onInchide: () => void
  onSchimbata: (acces: AccesStatistici) => void
}) {
  const [curenta, setCurenta] = useState('')
  const [noua, setNoua] = useState('')
  const [repetata, setRepetata] = useState('')
  const erori = useEroriFormular<Camp>()
  const seteaza = useSeteazaParolaStatistici()
  const notificari = useNotificari()

  const inchide = () => {
    setCurenta('')
    setNoua('')
    setRepetata('')
    erori.goleste()
    onInchide()
  }

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()
    if (curenta === '') return erori.setCamp('parola_curenta', 'Scrie parola de acum a statisticilor.')
    if (noua.length < 8) return erori.setCamp('parola_noua', 'Parola trebuie să aibă cel puțin 8 caractere.')
    if (repetata !== noua) return erori.setCamp('repetata', 'Cele două parole nu sunt la fel.')
    try {
      const acces = await seteaza.mutateAsync({ parola_curenta: curenta, parola_noua: noua })
      notificari.succes('Parola statisticilor a fost schimbată')
      onSchimbata(acces)
      inchide()
    } catch (err) {
      erori.preia(err)
    }
  }

  return (
    <Modala
      deschisa={deschisa}
      onInchide={inchide}
      blocata={seteaza.isPending}
      dimensiune="sm"
      titlu="Schimbă parola statisticilor"
      descriere="Pe celelalte calculatoare, statisticile deschise cu parola veche se încuie la prima lor cerere."
      subsol={
        <>
          <Buton onClick={inchide} disabled={seteaza.isPending} plin className="sm:w-auto">
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            type="submit"
            form="formular-parola-statistici"
            incarca={seteaza.isPending}
            plin
            className="sm:w-auto"
          >
            Schimbă parola
          </Buton>
        </>
      }
    >
      <form id="formular-parola-statistici" onSubmit={trimite} noValidate className="flex flex-col gap-3.5">
        <Input
          type="password"
          eticheta="Parola de acum"
          autoComplete="off"
          value={curenta}
          onChange={(e) => setCurenta(e.target.value)}
          eroare={erori.peCamp.parola_curenta ?? null}
          autoFocus
        />
        <Input
          type="password"
          eticheta="Parola nouă"
          autoComplete="new-password"
          value={noua}
          onChange={(e) => setNoua(e.target.value)}
          eroare={erori.peCamp.parola_noua ?? null}
          ajutor="Cel puțin 8 caractere, diferită de parola contului."
        />
        <Input
          type="password"
          eticheta="Parola nouă, încă o dată"
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
      </form>
    </Modala>
  )
}
