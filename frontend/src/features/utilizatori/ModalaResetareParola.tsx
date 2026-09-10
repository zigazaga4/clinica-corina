import { useId, useState, type FormEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useUtilizator } from '@/app/auth'
import { useReseteazaParola } from '@/app/queries'
import type { Utilizator } from '@/domain/types'
import { useEroriFormular } from '@/lib/formular'
import { Avatar, Buton, Modala, useNotificari } from '@/ui'
import { CampParola, PAROLA_MINIM } from './CampParola'

/**
 * Resetarea parolei unui cont (§7 — POST /utilizatori/:id/reset-parola).
 *
 * Nu folosim `ModalaConfirmare`: operațiunea cere două câmpuri și o avertizare
 * care trebuie citită înainte de apăsare, nu un simplu „ești sigur?”.
 * Resetarea revocă TOATE sesiunile contului, deci persoana este deconectată de
 * pe telefon, de pe tabletă și de la recepție în același timp — dacă nu spunem
 * asta aici, administratorul află abia din reclamația colegei.
 */

type CampFormular = 'parola' | 'confirmare'

export function ModalaResetareParola({
  utilizator,
  onInchide,
}: {
  utilizator: Utilizator
  onInchide: () => void
}) {
  const eu = useUtilizator()
  const { succes } = useNotificari()
  const erori = useEroriFormular<CampFormular>()
  const reseteaza = useReseteazaParola()
  const idFormular = useId()

  const [parola, setParola] = useState('')
  const [confirmare, setConfirmare] = useState('')

  const suntEu = utilizator.id === eu.id

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    if (parola.length < PAROLA_MINIM) {
      erori.setCamp('parola', `Parola trebuie să aibă cel puțin ${PAROLA_MINIM} caractere.`)
      return
    }
    if (confirmare !== parola) {
      erori.setCamp('confirmare', 'Cele două parole nu coincid.')
      return
    }

    try {
      await reseteaza.mutateAsync({ id: utilizator.id, parola_noua: parola })
      // Notificarea confirmă efectul, nu parola: aceasta nu părăsește formularul.
      succes(
        'Parolă resetată',
        `Sesiunile contului ${utilizator.nume} au fost închise. Comunică-i parola nouă.`,
      )
      onInchide()
    } catch (err) {
      erori.preia(err)
    }
  }

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      blocata={reseteaza.isPending}
      titlu="Resetează parola"
      dimensiune="sm"
      subsol={
        <>
          <Buton onClick={onInchide} disabled={reseteaza.isPending} className="sm:w-auto" plin>
            Renunță
          </Buton>
          <Buton
            type="submit"
            form={idFormular}
            varianta="primar"
            incarca={reseteaza.isPending}
            className="sm:w-auto"
            plin
          >
            Resetează parola
          </Buton>
        </>
      }
    >
      <form id={idFormular} onSubmit={trimite} className="flex flex-col gap-4" noValidate>
        <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5">
          <Avatar nume={utilizator.nume} dimensiune="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{utilizator.nume}</p>
            <p className="truncate text-[12px] text-ink-faint">{utilizator.email}</p>
          </div>
        </div>

        <div
          role="note"
          className="flex gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] leading-snug text-warning"
        >
          <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
          <p>
            Resetarea închide <strong className="font-semibold">toate sesiunile</strong> acestui
            cont. Persoana va fi deconectată de pe fiecare dispozitiv și va trebui să se
            autentifice din nou, cu parola stabilită acum.
            {suntEu && ' Este propriul tău cont: vei fi deconectat și tu.'}
          </p>
        </div>

        <CampParola
          eticheta="Parolă nouă"
          valoare={parola}
          onSchimba={setParola}
          eroare={erori.peCamp.parola ?? null}
          ajutor={`Cel puțin ${PAROLA_MINIM} caractere.`}
          autoFocus
        />

        <CampParola
          eticheta="Confirmă parola"
          valoare={confirmare}
          onSchimba={setConfirmare}
          eroare={erori.peCamp.confirmare ?? null}
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
