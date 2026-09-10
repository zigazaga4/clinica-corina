import { useId, useState, type FormEvent } from 'react'
import { Mail, User } from 'lucide-react'
import { EroareApi, esteEroareApi } from '@/api/errors'
import { useUtilizator } from '@/app/auth'
import { useCreeazaUtilizator, useModificaUtilizator } from '@/app/queries'
import { GrilaFormular } from '@/components/Pagina'
import { etichetaRol } from '@/domain/labels'
import { ROL_UTILIZATOR, type RolUtilizator, type Utilizator } from '@/domain/types'
import { useEroriFormular } from '@/lib/formular'
import { Buton, Comutator, Input, Modala, Select, useNotificari } from '@/ui'
import { CampParola, PAROLA_MINIM } from './CampParola'

/**
 * Crearea și modificarea unui cont (art. 3.1.D).
 *
 * Parola apare DOAR la creare. Schimbarea ei ulterioară trece exclusiv prin
 * resetare, pentru că aceea închide și sesiunile deschise — o parolă schimbată
 * din formularul de editare ar lăsa dispozitivele vechi conectate în
 * continuare, ceea ce anulează rostul schimbării.
 */

type CampFormular = 'nume' | 'email' | 'parola' | 'rol' | 'activ'

export function FormularUtilizator({
  utilizator,
  onInchide,
}: {
  /** null = cont nou. */
  utilizator: Utilizator | null
  onInchide: () => void
}) {
  const eu = useUtilizator()
  const { succes } = useNotificari()
  const erori = useEroriFormular<CampFormular>()
  const creeaza = useCreeazaUtilizator()
  const modifica = useModificaUtilizator()
  const idFormular = useId()

  // Componenta se montează la deschidere (părintele o randează condiționat),
  // deci starea inițială se citește o singură dată, fără sincronizări.
  const [nume, setNume] = useState(utilizator?.nume ?? '')
  const [email, setEmail] = useState(utilizator?.email ?? '')
  const [parola, setParola] = useState('')
  const [rol, setRol] = useState<RolUtilizator>(utilizator?.rol ?? 'utilizator')
  const [activ, setActiv] = useState(utilizator?.activ ?? true)

  // Serverul refuză schimbarea propriului rol și dezactivarea propriului cont
  // (§7). Le blocăm și aici, cu motivul la vedere, ca administratorul să nu
  // completeze un formular care oricum va fi respins.
  const suntEu = utilizator !== null && utilizator.id === eu.id
  const seTrimite = creeaza.isPending || modifica.isPending

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    if (nume.trim() === '') {
      erori.setCamp('nume', 'Numele este obligatoriu.')
      return
    }
    if (email.trim() === '') {
      erori.setCamp('email', 'Adresa de e-mail este obligatorie.')
      return
    }
    if (utilizator === null && parola.length < PAROLA_MINIM) {
      erori.setCamp('parola', `Parola trebuie să aibă cel puțin ${PAROLA_MINIM} caractere.`)
      return
    }

    try {
      if (utilizator === null) {
        const creat = await creeaza.mutateAsync({
          nume: nume.trim(),
          email: email.trim(),
          parola,
          rol,
          activ,
        })
        succes('Cont creat', `${creat.nume} se poate autentifica cu parola stabilită acum.`)
      } else {
        const actualizat = await modifica.mutateAsync({
          id: utilizator.id,
          date: { nume: nume.trim(), email: email.trim(), rol, activ },
        })
        succes('Cont actualizat', actualizat.nume)
      }
      onInchide()
    } catch (err) {
      erori.preia(cuCampLaRadacina(err))
    }
  }

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={utilizator === null ? 'Cont nou' : 'Modifică contul'}
      descriere={
        utilizator === null
          ? 'Contul poate fi folosit imediat după creare.'
          : 'Parola se schimbă separat, prin resetare.'
      }
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seTrimite} className="sm:w-auto" plin>
            Renunță
          </Buton>
          <Buton
            type="submit"
            form={idFormular}
            varianta="primar"
            incarca={seTrimite}
            className="sm:w-auto"
            plin
          >
            {utilizator === null ? 'Creează contul' : 'Salvează'}
          </Buton>
        </>
      }
    >
      <form id={idFormular} onSubmit={trimite} className="flex flex-col gap-4" noValidate>
        <GrilaFormular>
          <Input
            eticheta="Nume"
            obligatoriu
            autoFocus
            autoComplete="off"
            value={nume}
            onChange={(e) => setNume(e.target.value)}
            eroare={erori.peCamp.nume ?? null}
            pictograma={<User className="size-4" />}
            placeholder="Popescu Andreea"
          />

          <Input
            eticheta="E-mail"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="off"
            obligatoriu
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            eroare={erori.peCamp.email ?? null}
            pictograma={<Mail className="size-4" />}
            placeholder="nume@clinica.ro"
            ajutor="Cu ea se face autentificarea; trebuie să fie unică."
          />

          {utilizator === null && (
            <CampParola
              eticheta="Parolă"
              valoare={parola}
              onSchimba={setParola}
              eroare={erori.peCamp.parola ?? null}
              ajutor={`Cel puțin ${PAROLA_MINIM} caractere. Comunic-o direct persoanei.`}
            />
          )}

          <Select
            eticheta="Rol"
            value={rol}
            onChange={(e) => setRol(e.target.value as RolUtilizator)}
            disabled={suntEu}
            eroare={erori.peCamp.rol ?? null}
            ajutor={
              suntEu
                ? 'Nu îți poți schimba propriul rol. Cere-i altui administrator.'
                : 'Administratorul are acces la utilizatori, nomenclator și jurnal.'
            }
          >
            {ROL_UTILIZATOR.map((valoare) => (
              <option key={valoare} value={valoare}>
                {etichetaRol[valoare]}
              </option>
            ))}
          </Select>

        </GrilaFormular>

        <Comutator
          eticheta="Cont activ"
          descriere={
            suntEu
              ? 'Nu îți poți dezactiva propriul cont.'
              : 'Contul dezactivat nu se mai poate autentifica, iar sesiunile deschise se închid.'
          }
          bifat={activ}
          disabled={suntEu}
          onChange={setActiv}
          className="rounded-lg bg-muted px-3 py-2.5"
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

/**
 * Conflictele de unicitate (409 `utilizator_email_uk`) transportă numele
 * câmpului în `detalii`, nu la rădăcina erorii, iar `useEroriFormular` citește
 * doar rădăcina. Fără mutarea asta, „există deja un cont cu această adresă” ar
 * ateriza în banda generală, la distanță de câmpul care a produs-o.
 */
function cuCampLaRadacina(e: unknown): unknown {
  if (!esteEroareApi(e) || e.camp) return e
  const camp = e.detalii?.['camp']
  if (typeof camp !== 'string') return e
  return new EroareApi(e.cod, e.message, { camp })
}
