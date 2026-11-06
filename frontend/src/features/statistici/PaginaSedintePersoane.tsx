import { useMemo, useState } from 'react'
import { useUtilizator } from '@/app/auth'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { useConturiAlese } from '@/components/selectoare'
import type { Uuid } from '@/domain/types'
import { Spinner } from '@/ui'
import { AlegerePerioadei } from './AlegerePerioadei'
import { AlegerePersoana } from './AlegerePersoana'
import { ButoaneAcces } from './ButoaneAcces'
import { alegereImplicita, calculeazaPerioada } from './perioade'
import { persoanaImplicita } from './persoane'
import { PoartaStatistici } from './PoartaStatistici'
import { RezumatPersoana } from './RaportulPersoanei'
import { useAccesStatistici } from './useAccesStatistici'

/**
 * „Ședințe pe persoane” — ședințele făcute de o persoană și banii intrați pe
 * ele, pe zile, săptămâni sau luni (cerința clinicii, 3 nov. 2026: „o
 * statistică și pentru Anda, în care să-i apară doar încasările ei și ce face
 * ea în fiecare lună”).
 *
 * Se numea „Statisticile mele”, apoi „Ședințele mele”, și arăta cifrele
 * contului care o deschidea — fără parolă. Proprietara a deschis-o cu contul ei
 * și a găsit cifrele ei, nu pe ale Andei, iar clinica a cerut de două ori același
 * lucru (4 și 6 nov. 2026): „aici trebuie Anda, și cu parola”. Acum stă în
 * spatele parolei statisticilor, ca „Statistici”, și se deschide pe Anda; celelalte
 * conturi se aleg din butoane. (Serverul păstrează ruta fără parolă
 * `GET /statistici/mele`, pe care o folosesc încă aplicațiile mai vechi.)
 */
export function PaginaSedintePersoane() {
  const { acces, motiv, deschide, incuie } = useAccesStatistici()

  return (
    <Pagina>
      <AntetPagina
        titlu="Ședințe pe persoane"
        descriere="Ședințele făcute de fiecare persoană și banii intrați pe ele — deschise doar cu parola statisticilor."
        actiuni={acces && <ButoaneAcces onIncuie={() => incuie(null)} onSchimbata={deschide} />}
      />
      {!acces ? <PoartaStatistici onDeschis={deschide} motiv={motiv} /> : <SedintePersoana />}
    </Pagina>
  )
}

/** Ce se vede după deblocare: perioada, persoana (Anda, la început) și cifrele ei. */
function SedintePersoana() {
  const utilizator = useUtilizator()
  const { conturi } = useConturiAlese()
  const [alegere, setAlegere] = useState(() => alegereImplicita())
  // Cât timp nu s-a ales nimeni, se arată persoana implicită.
  const [aleasa, setAleasa] = useState<Uuid | null>(null)
  const calculata = useMemo(() => calculeazaPerioada(alegere), [alegere])
  const persoana = aleasa ?? persoanaImplicita(conturi, utilizator)?.id ?? null

  return (
    <>
      <BaraFiltre>
        <AlegerePerioadei alegere={alegere} onSchimba={setAlegere} />
        <AlegerePersoana valoare={persoana} onSchimba={setAleasa} toti={null} />
      </BaraFiltre>
      {persoana ? (
        <RezumatPersoana id={persoana} calculata={calculata} />
      ) : (
        <div className="flex justify-center py-16">
          <Spinner eticheta="Se încarcă conturile…" />
        </div>
      )}
    </>
  )
}
