import { useMemo, useState } from 'react'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import type { Uuid } from '@/domain/types'
import { ListaIncasari } from '@/features/vanzari/ListaIncasari'
import { File } from '@/ui'
import { AlegerePerioadei } from './AlegerePerioadei'
import { AlegerePersoana } from './AlegerePersoana'
import { ButoaneAcces } from './ButoaneAcces'
import { ListaCheltuieli } from './ListaCheltuieli'
import { alegereImplicita, calculeazaPerioada } from './perioade'
import { PoartaStatistici } from './PoartaStatistici'
import { RezumatPersoana } from './RaportulPersoanei'
import { RezumatStatistici } from './RezumatStatistici'
import { useAccesStatistici } from './useAccesStatistici'

type FilaStatistici = 'rezumat' | 'incasari' | 'cheltuieli'

const FILE: { valoare: FilaStatistici; eticheta: string }[] = [
  { valoare: 'rezumat', eticheta: 'Rezumat' },
  { valoare: 'incasari', eticheta: 'Încasări' },
  { valoare: 'cheltuieli', eticheta: 'Cheltuieli' },
]

/**
 * Statisticile: încasările, cheltuielile, profitul — și tot ce le explică.
 *
 * La fiecare intrare se cere parola STATISTICILOR, alta decât a contului
 * (deblocarea și încuierea ei: `useAccesStatistici`).
 *
 * Aici a ajuns și lista încasărilor, care avea un ecran al ei: fila
 * „Încasări” este fostul ecran, neschimbat, doar pus în spatele aceleiași uși.
 */
export function PaginaStatistici() {
  const { acces, motiv, deschide, incuie } = useAccesStatistici()
  const [fila, setFila] = useState<FilaStatistici>('rezumat')
  const [alegere, setAlegere] = useState(() => alegereImplicita())
  // null = toată clinica; altfel doar cifrele persoanei alese.
  const [persoana, setPersoana] = useState<Uuid | null>(null)

  const calculata = useMemo(() => calculeazaPerioada(alegere), [alegere])

  return (
    <Pagina>
      <AntetPagina
        titlu="Statistici"
        descriere="Încasările, cheltuielile și profitul clinicii — deschise doar cu parola statisticilor."
        actiuni={acces && <ButoaneAcces onIncuie={() => incuie(null)} onSchimbata={deschide} />}
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
                {/* Cifrele unei singure persoane, pe lângă cele ale clinicii (3–4 nov. 2026). */}
                <AlegerePersoana valoare={persoana} onSchimba={setPersoana} />
              </BaraFiltre>
              {persoana ? (
                <RezumatPersoana id={persoana} calculata={calculata} />
              ) : (
                <RezumatStatistici calculata={calculata} />
              )}
            </>
          )}
          {fila === 'incasari' && <ListaIncasari />}
          {fila === 'cheltuieli' && (
            <ListaCheltuieli alegere={alegere} onAlegere={setAlegere} calculata={calculata} />
          )}
        </>
      )}
    </Pagina>
  )
}
