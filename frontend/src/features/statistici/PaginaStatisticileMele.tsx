import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStatisticileMele } from '@/app/queries'
import { useUtilizator } from '@/app/auth'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { AlegerePerioadei } from './AlegerePerioadei'
import { alegereImplicita, calculeazaPerioada, filtruStatistici } from './perioade'
import { RaportulPersoanei } from './RaportulPersoanei'

/**
 * „Ședințele mele” — ședințele pe care le-a făcut persoana autentificată și
 * banii intrați pe ele, pe zile, săptămâni sau luni (cerința clinicii, 3 nov.
 * 2026: „o statistică și pentru Anda, în care să-i apară doar încasările ei și ce
 * face ea în fiecare lună, doar pe contul ei”).
 *
 * Se numea „Statisticile mele”, dar proprietara așa numește „Statistici”, iar
 * deschizând-o cu contul ei a găsit cifrele ei, nu pe ale Andei (4 nov. 2026).
 * Cifrele Andei le vede ea la „Statistici”, pe persoane, cu parola; aici fiecare
 * își vede doar ale lui.
 *
 * NU cere parola statisticilor: nu arată nimic din clinică, doar ce ține de
 * contul care o deschide, iar persoana o stabilește serverul din cont — nu o
 * alege ecranul. Încasările și rapoartele clinicii rămân în spatele parolei,
 * la „Statistici”.
 */
export function PaginaStatisticileMele() {
  const utilizator = useUtilizator()
  const [alegere, setAlegere] = useState(() => alegereImplicita())
  const calculata = useMemo(() => calculeazaPerioada(alegere), [alegere])
  const filtru = useMemo(() => filtruStatistici(calculata), [calculata])
  const raport = useStatisticileMele(filtru)

  return (
    <Pagina>
      <AntetPagina
        titlu="Ședințele mele"
        descriere={
          <>
            Contul <strong className="font-semibold text-ink">{utilizator.nume}</strong>: ședințele făcute de acest
            cont și banii intrați pe ele, fără parolă. Cifrele clinicii și ale celorlalți sunt la{' '}
            <Link to="/statistici" className="font-medium text-primary-600 underline-offset-4 hover:underline">
              Statistici
            </Link>
            , cu parola statisticilor.
          </>
        }
      />
      <BaraFiltre>
        <AlegerePerioadei alegere={alegere} onSchimba={setAlegere} />
      </BaraFiltre>
      <RaportulPersoanei raport={raport} />
    </Pagina>
  )
}
