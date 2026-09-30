import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Lock } from 'lucide-react'
import type { AccesStatistici } from '@/api/contract'
import { useAutentificare } from '@/app/auth'
import { useBlocheazaStatistici, useLaStatisticiIncuiate } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { ListaIncasari } from '@/features/vanzari/ListaIncasari'
import { Buton, File } from '@/ui'
import { AlegerePerioadei } from './AlegerePerioadei'
import { ListaCheltuieli } from './ListaCheltuieli'
import { ModalaParolaStatistici } from './ModalaParolaStatistici'
import { alegereImplicita, calculeazaPerioada } from './perioade'
import { PoartaStatistici } from './PoartaStatistici'
import { RezumatStatistici } from './RezumatStatistici'

type FilaStatistici = 'rezumat' | 'incasari' | 'cheltuieli'

const FILE: { valoare: FilaStatistici; eticheta: string }[] = [
  { valoare: 'rezumat', eticheta: 'Rezumat' },
  { valoare: 'incasari', eticheta: 'Încasări' },
  { valoare: 'cheltuieli', eticheta: 'Cheltuieli' },
]

/**
 * Statisticile: încasările, cheltuielile, profitul — și tot ce le explică.
 *
 * La fiecare intrare se cere parola STATISTICILOR, alta decât a contului.
 * Deblocarea nu supraviețuiește plecării din pagină: la întoarcere, parola se
 * cere din nou, iar cifrele citite înainte sunt deja șterse din memorie. La
 * fel după o oră, după o schimbare de parolă și după reîncărcarea aplicației.
 *
 * Aici a ajuns și lista încasărilor, care avea un ecran al ei: fila
 * „Încasări” este fostul ecran, neschimbat, doar pus în spatele aceleiași uși.
 */
export function PaginaStatistici() {
  const { esteAdministrator } = useAutentificare()
  const [acces, setAcces] = useState<AccesStatistici | null>(null)
  const [motiv, setMotiv] = useState<string | null>(null)
  const [fila, setFila] = useState<FilaStatistici>('rezumat')
  const [alegere, setAlegere] = useState(() => alegereImplicita())
  const [schimbaParola, setSchimbaParola] = useState(false)
  const uita = useBlocheazaStatistici()

  const calculata = useMemo(() => calculeazaPerioada(alegere), [alegere])

  const incuie = useCallback((mesaj: string | null) => {
    setAcces(null)
    setMotiv(mesaj)
    setSchimbaParola(false)
  }, [])

  const deschide = useCallback((nou: AccesStatistici) => {
    setAcces(nou)
    setMotiv(null)
  }, [])

  /*
    Deblocarea se uită abia DUPĂ ce filele s-au închis — de aceea într-un
    efect, nu în `incuie`: cât timp mai erau pe ecran, ștergerea cifrelor de
    sub ele le-ar fi făcut să le ceară din nou, fără deblocare.
  */
  useEffect(() => {
    if (!acces) uita()
  }, [acces, uita])

  // Plecarea din pagină încuie. Nimic din ce s-a citit nu rămâne în urmă.
  useEffect(() => uita, [uita])

  // O oră mai târziu, serverul oricum refuză; ecranul se încuie la timp.
  useEffect(() => {
    if (!acces) return undefined
    const ramas = Math.max(0, new Date(acces.expira_la).getTime() - Date.now())
    const ceas = setTimeout(
      () => incuie('Statisticile s-au încuiat singure după o oră. Scrie din nou parola.'),
      ramas,
    )
    return () => clearTimeout(ceas)
  }, [acces, incuie])

  /*
    Un calculator adormit nu-și rulează ceasurile: la trezire, cronometrul de
    mai sus poate întârzia, iar cifrele ar sta pe ecran peste termen. La
    fiecare întoarcere în fereastră se verifică din nou.
  */
  useEffect(() => {
    if (!acces) return undefined
    const laIntoarcere = () => {
      if (document.visibilityState === 'visible' && Date.now() >= new Date(acces.expira_la).getTime()) {
        incuie('Statisticile s-au încuiat singure după o oră. Scrie din nou parola.')
      }
    }
    document.addEventListener('visibilitychange', laIntoarcere)
    return () => document.removeEventListener('visibilitychange', laIntoarcere)
  }, [acces, incuie])

  // Serverul a refuzat o cerere: parola s-a schimbat în altă parte, sau ceasul
  // calculatorului a luat-o înainte.
  useLaStatisticiIncuiate(incuie)

  return (
    <Pagina>
      <AntetPagina
        titlu="Statistici"
        descriere="Încasările, cheltuielile și profitul clinicii — deschise doar cu parola statisticilor."
        actiuni={
          acces && (
            <>
              {esteAdministrator && (
                <Buton
                  varianta="discret"
                  onClick={() => setSchimbaParola(true)}
                  // Pe telefon rămâne doar cheia; numele trebuie să existe oricum.
                  aria-label="Schimbă parola statisticilor"
                  title="Schimbă parola statisticilor"
                >
                  <KeyRound className="size-4" />
                  <span className="hidden sm:inline">Schimbă parola</span>
                </Buton>
              )}
              <Buton varianta="secundar" onClick={() => incuie(null)}>
                <Lock className="size-4" />
                Încuie
              </Buton>
            </>
          )
        }
      />

      {!acces ? (
        <PoartaStatistici onDeschis={deschide} motiv={motiv} />
      ) : (
        <>
          <File
            file={FILE}
            activa={fila}
            onSchimba={setFila}
            className="mb-4"
          />

          {fila === 'rezumat' && (
            <>
              <BaraFiltre>
                <AlegerePerioadei alegere={alegere} onSchimba={setAlegere} />
              </BaraFiltre>
              <RezumatStatistici calculata={calculata} />
            </>
          )}
          {fila === 'incasari' && <ListaIncasari />}
          {fila === 'cheltuieli' && (
            <ListaCheltuieli alegere={alegere} onAlegere={setAlegere} calculata={calculata} />
          )}

          <ModalaParolaStatistici
            deschisa={schimbaParola}
            onInchide={() => setSchimbaParola(false)}
            onSchimbata={deschide}
          />
        </>
      )}
    </Pagina>
  )
}
