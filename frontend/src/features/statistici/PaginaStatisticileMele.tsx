import { useMemo, useState } from 'react'
import { useStatisticileMele } from '@/app/queries'
import { useUtilizator } from '@/app/auth'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { AlegerePerioadei } from './AlegerePerioadei'
import { alegereImplicita, calculeazaPerioada, filtruStatistici } from './perioade'
import { RaportulPersoanei } from './RaportulPersoanei'

/**
 * „Statisticile mele” — ședințele pe care le-a făcut persoana autentificată și
 * banii intrați pe ele, pe zile, săptămâni sau luni (cerința clinicii, 3 nov.
 * 2026: „o statistică și pentru Anda, în care să-i apară doar încasările ei și ce
 * face ea în fiecare lună, doar pe contul ei”).
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
        titlu="Statisticile mele"
        descriere={`${utilizator.nume}: ședințele făcute și banii intrați pe ele — doar ale tale, fără parolă.`}
      />
      <BaraFiltre>
        <AlegerePerioadei alegere={alegere} onSchimba={setAlegere} />
      </BaraFiltre>
      <RaportulPersoanei raport={raport} />
    </Pagina>
  )
}
