import { useMemo, useState } from 'react'
import { KeyRound, MoreHorizontal, Plus, SquarePen, UserCheck, Users, UserX } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useUtilizator } from '@/app/auth'
import { useModificaUtilizator, useUtilizatori } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { InsemnInactiv, InsemnRol } from '@/components/insemne'
import type { Utilizator } from '@/domain/types'
import { FurnizorCulori, SelectorCuloare } from '@/features/programari/culoriExecutanti'
import { formateazaDataOra } from '@/lib/dates'
import { useIntarziat } from '@/lib/hooks'
import {
  Avatar,
  Badge,
  Buton,
  ButonGrup,
  CampCautare,
  Card,
  CelulaDubla,
  ElementMeniu,
  GrupButoane,
  Meniu,
  ModalaConfirmare,
  SeparatorMeniu,
  StareGoala,
  Tabel,
  useNotificari,
  type Coloana,
} from '@/ui'
import { FormularUtilizator } from './FormularUtilizator'
import { ModalaResetareParola } from './ModalaResetareParola'

/**
 * Conturile personalului (art. 3.1.D — „gestiunea conturilor de utilizator,
 * cu roluri și posibilitatea dezactivării”).
 *
 * Ecranul este rezervat administratorului prin `<DoarAdministrator>` din
 * `@/routes`, deci aici nu se mai verifică rolul; se verifică doar cele două
 * reguli pe care serverul le aplică asupra propriului cont.
 *
 * Conturile nu se șterg niciodată: fiecare este autor de programări, vânzări și
 * intrări de jurnal, iar ștergerea ar rupe trasabilitatea cerută de art. 3.1.D.
 * Retragerea accesului se face prin dezactivare.
 */

type FiltruStare = 'toate' | 'activi' | 'inactivi'

const FILTRE_STARE: { valoare: FiltruStare; eticheta: string }[] = [
  { valoare: 'toate', eticheta: 'Toate' },
  { valoare: 'activi', eticheta: 'Active' },
  { valoare: 'inactivi', eticheta: 'Dezactivate' },
]

export function PaginaUtilizatori() {
  const eu = useUtilizator()
  const { succes, eroare } = useNotificari()

  const [cautare, setCautare] = useState('')
  const [stare, setStare] = useState<FiltruStare>('toate')
  const cautareIntarziata = useIntarziat(cautare, 250)

  const [formular, setFormular] = useState<{ utilizator: Utilizator | null } | null>(null)
  const [deResetat, setDeResetat] = useState<Utilizator | null>(null)
  const [deComutat, setDeComutat] = useState<Utilizator | null>(null)

  const filtru = useMemo(
    () => ({
      ...(cautareIntarziata.trim() === '' ? {} : { q: cautareIntarziata.trim() }),
      ...(stare === 'toate' ? {} : { activ: stare === 'activi' }),
    }),
    [cautareIntarziata, stare],
  )

  const { data, isPending, isFetching, error, refetch } = useUtilizatori(filtru)
  // Culorile se împart pe TOATE conturile active, ca în calendar (aceeași
  // cerere, deci din cache) — nu pe lista filtrată de aici.
  const { data: activi } = useUtilizatori({ activ: true })
  const modifica = useModificaUtilizator()

  const randuri = data ?? []
  const areFiltre = cautare.trim() !== '' || stare !== 'toate'

  const golesteFiltrele = () => {
    setCautare('')
    setStare('toate')
  }

  const comutaStarea = async (tinta: Utilizator) => {
    const activeaza = !tinta.activ

    try {
      await modifica.mutateAsync({ id: tinta.id, date: { activ: activeaza } })
      succes(
        activeaza ? 'Cont activat' : 'Cont dezactivat',
        activeaza
          ? `${tinta.nume} se poate autentifica din nou.`
          : `${tinta.nume} nu se mai poate autentifica, iar sesiunile deschise s-au închis.`,
      )
    } catch (err) {
      // Cazul tipic: era ultimul administrator activ, iar serverul refuză să
      // lase clinica fără niciunul. Regula nu poate fi anticipată din lista
      // afișată, care este filtrată, deci se citește din răspuns.
      eroare('Modificarea a fost refuzată', mesajEroare(err))
    } finally {
      setDeComutat(null)
    }
  }

  const meniuRand = (utilizator: Utilizator, peTelefon = false) => {
    const esteContulMeu = utilizator.id === eu.id

    return (
      <Meniu
        declansator={({ deschis, comuta }) => (
          <Buton
            varianta="discret"
            dimensiune={peTelefon ? 'icon' : 'icon-sm'}
            onClick={comuta}
            aria-expanded={deschis}
            aria-label={`Acțiuni pentru ${utilizator.nume}`}
            className={peTelefon ? 'tinta-atingere' : undefined}
          >
            <MoreHorizontal className="size-4.5" />
          </Buton>
        )}
      >
        <ElementMeniu
          onClick={() => setFormular({ utilizator })}
          pictograma={<SquarePen className="size-4" />}
        >
          Modifică
        </ElementMeniu>
        <ElementMeniu
          onClick={() => setDeResetat(utilizator)}
          pictograma={<KeyRound className="size-4" />}
        >
          Resetează parola
        </ElementMeniu>

        <SeparatorMeniu />

        <ElementMeniu
          onClick={() => setDeComutat(utilizator)}
          disabled={esteContulMeu}
          periculos={utilizator.activ}
          pictograma={
            utilizator.activ ? <UserX className="size-4" /> : <UserCheck className="size-4" />
          }
        >
          {utilizator.activ ? 'Dezactivează' : 'Activează'}
        </ElementMeniu>

        {esteContulMeu && (
          <p className="px-2.5 pt-0.5 pb-1 text-[12px] leading-snug text-ink-faint">
            Propriul cont nu poate fi dezactivat, iar rolul ți-l poate schimba doar alt
            administrator.
          </p>
        )}
      </Meniu>
    )
  }

  const coloane: Coloana<Utilizator>[] = [
    {
      cheie: 'nume',
      antet: 'Nume',
      celula: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar nume={u.nume} dimensiune="sm" />
          <CelulaDubla principal={u.nume} secundar={u.email} />
        </div>
      ),
    },
    {
      cheie: 'rol',
      antet: 'Rol',
      celula: (u) => <InsemnRol rol={u.rol} />,
      className: 'w-32',
    },
    {
      cheie: 'stare',
      antet: 'Stare',
      celula: (u) =>
        u.activ ? (
          <Badge ton="success" cuPunct>
            Activ
          </Badge>
        ) : (
          <InsemnInactiv text="Dezactivat" />
        ),
      className: 'w-32',
    },
    {
      // Culoarea din calendar: apăsată, deschide selectorul de culoare.
      cheie: 'culoare',
      antet: 'Culoare',
      celula: (u) => <SelectorCuloare id={u.id} />,
      className: 'w-24',
    },
    {
      cheie: 'ultima_autentificare',
      antet: 'Ultima autentificare',
      celula: (u) => (
        <span className="text-ink-soft tabular-nums">
          {formateazaDataOra(u.ultima_autentificare)}
        </span>
      ),
      className: 'w-48 whitespace-nowrap',
      ascunsaSub: 'md',
    },
    {
      cheie: 'actiuni',
      antet: <span className="sr-only">Acțiuni</span>,
      celula: (u) => meniuRand(u),
      className: 'w-12 text-right',
    },
  ]

  return (
    <Pagina>
      <AntetPagina
        titlu="Utilizatori"
        descriere="Conturile personalului, rolurile lor și accesul la aplicație."
        actiuni={
          <Buton
            varianta="primar"
            onClick={() => setFormular({ utilizator: null })}
            className="tinta-atingere"
          >
            <Plus className="size-4" />
            Cont nou
          </Buton>
        }
      />

      <BaraFiltre>
        <CampCautare
          valoare={cautare}
          onSchimba={setCautare}
          placeholder="Caută după nume sau e-mail…"
          aria-label="Caută un cont"
          containerClassName="w-56 sm:w-72"
        />

        <GrupButoane eticheta="Starea contului">
          {FILTRE_STARE.map((optiune) => (
            <ButonGrup
              key={optiune.valoare}
              activ={stare === optiune.valoare}
              onClick={() => setStare(optiune.valoare)}
            >
              {optiune.eticheta}
            </ButonGrup>
          ))}
        </GrupButoane>
      </BaraFiltre>

      <FurnizorCulori utilizatori={activi}>
      <Card className="overflow-hidden">
        <Tabel
          coloane={coloane}
          randuri={randuri}
          cheieRand={(u) => u.id}
          incarca={isPending || isFetching}
          eroare={error ? mesajEroare(error) : null}
          onReincearca={() => void refetch()}
          randMobil={(u) => (
            <div className="flex items-start gap-3">
              <Avatar nume={u.nume} />
              <div className="min-w-0 flex-1">
                <CelulaDubla principal={u.nume} secundar={u.email} />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <InsemnRol rol={u.rol} />
                  {!u.activ && <InsemnInactiv text="Dezactivat" />}
                  <SelectorCuloare id={u.id} />
                </div>
                <p className="mt-1 text-[12px] text-ink-faint">
                  Ultima autentificare: {formateazaDataOra(u.ultima_autentificare)}
                </p>
              </div>
              {meniuRand(u, true)}
            </div>
          )}
          stareGoala={
            areFiltre ? (
              <StareGoala
                pictograma={<Users className="size-5" />}
                titlu="Niciun cont găsit"
                descriere="Niciun cont nu corespunde căutării sau filtrului de stare."
                actiune={{ eticheta: 'Golește filtrele', onClick: golesteFiltrele }}
              />
            ) : (
              <StareGoala
                pictograma={<Users className="size-5" />}
                titlu="Niciun cont"
                descriere="Conturile se creează de aici; fiecare persoană se autentifică apoi cu e-mailul ei."
                actiune={{
                  eticheta: 'Cont nou',
                  onClick: () => setFormular({ utilizator: null }),
                }}
              />
            )
          }
        />
      </Card>
      </FurnizorCulori>

      {/* Formularele se montează la deschidere, ca starea lor să pornească de
          la contul ales fără sincronizări între proprietăți și stare. */}
      {formular && (
        <FormularUtilizator utilizator={formular.utilizator} onInchide={() => setFormular(null)} />
      )}

      {deResetat && (
        <ModalaResetareParola utilizator={deResetat} onInchide={() => setDeResetat(null)} />
      )}

      {deComutat && (
        <ModalaConfirmare
          deschisa
          onInchide={() => setDeComutat(null)}
          onConfirma={() => void comutaStarea(deComutat)}
          inCurs={modifica.isPending}
          periculoasa={deComutat.activ}
          titlu={deComutat.activ ? 'Dezactivezi contul?' : 'Activezi contul?'}
          etichetaConfirmare={deComutat.activ ? 'Dezactivează' : 'Activează'}
          mesaj={
            deComutat.activ
              ? `${deComutat.nume} nu se va mai putea autentifica, iar sesiunile deschise se închid imediat. Contul rămâne în evidență, cu tot istoricul lui.`
              : `${deComutat.nume} va putea din nou să se autentifice, cu parola pe care o avea.`
          }
        />
      )}
    </Pagina>
  )
}
