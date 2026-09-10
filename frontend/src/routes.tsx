import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAutentificare } from '@/app/auth'
import { CadruAplicatie } from '@/components/AppShell'
import { PaginaAutentificare } from '@/features/auth/PaginaAutentificare'
import { Pagina } from '@/components/Pagina'
import { Buton, IncarcarePagina, StareGoala } from '@/ui'

/*
  Rutele.

  Ecranele se încarcă la cerere (`lazy`): pachetul inițial conține doar cadrul
  și autentificarea, iar jurnalul — pe care îl deschide un administrator o dată
  pe săptămână — nu întârzie pornirea aplicației pe telefon.
*/

const PaginaProgramari = lazy(() =>
  import('@/features/programari/PaginaProgramari').then((m) => ({ default: m.PaginaProgramari })),
)
const PaginaClienti = lazy(() =>
  import('@/features/clienti/PaginaClienti').then((m) => ({ default: m.PaginaClienti })),
)
const PaginaFisaClient = lazy(() =>
  import('@/features/clienti/PaginaFisaClient').then((m) => ({ default: m.PaginaFisaClient })),
)
const PaginaVanzari = lazy(() =>
  import('@/features/vanzari/PaginaVanzari').then((m) => ({ default: m.PaginaVanzari })),
)
const PaginaNomenclator = lazy(() =>
  import('@/features/nomenclator/PaginaNomenclator').then((m) => ({
    default: m.PaginaNomenclator,
  })),
)
const PaginaUtilizatori = lazy(() =>
  import('@/features/utilizatori/PaginaUtilizatori').then((m) => ({
    default: m.PaginaUtilizatori,
  })),
)
const PaginaJurnal = lazy(() =>
  import('@/features/jurnal/PaginaJurnal').then((m) => ({ default: m.PaginaJurnal })),
)

export function Rute() {
  return (
    <Routes>
      <Route path="/autentificare" element={<PaginaAutentificare />} />

      <Route
        element={
          <RutaProtejata>
            <CadruAplicatie />
          </RutaProtejata>
        }
      >
        <Route index element={<Navigate to="/programari" replace />} />
        <Route path="/programari" element={<CuIncarcare><PaginaProgramari /></CuIncarcare>} />
        <Route path="/clienti" element={<CuIncarcare><PaginaClienti /></CuIncarcare>} />
        <Route path="/clienti/:id" element={<CuIncarcare><PaginaFisaClient /></CuIncarcare>} />
        <Route path="/incasari" element={<CuIncarcare><PaginaVanzari /></CuIncarcare>} />
        <Route path="/nomenclator" element={<CuIncarcare><PaginaNomenclator /></CuIncarcare>} />

        <Route
          path="/utilizatori"
          element={
            <DoarAdministrator>
              <CuIncarcare>
                <PaginaUtilizatori />
              </CuIncarcare>
            </DoarAdministrator>
          }
        />
        <Route
          path="/jurnal"
          element={
            <DoarAdministrator>
              <CuIncarcare>
                <PaginaJurnal />
              </CuIncarcare>
            </DoarAdministrator>
          }
        />

        <Route path="*" element={<PaginaNegasita />} />
      </Route>
    </Routes>
  )
}

function CuIncarcare({ children }: { children: ReactNode }) {
  return <Suspense fallback={<IncarcarePagina />}>{children}</Suspense>
}

/** Cere o sesiune validă; reține ecranul cerut, ca să revină la el după login. */
function RutaProtejata({ children }: { children: ReactNode }) {
  const { utilizator, seVerifica } = useAutentificare()
  const location = useLocation()

  if (seVerifica) return <IncarcarePagina text="Se verifică sesiunea…" />

  if (!utilizator) {
    return (
      <Navigate to="/autentificare" replace state={{ de_la: location.pathname + location.search }} />
    )
  }

  return <>{children}</>
}

/**
 * Rutele marcate „administrator” în §7.
 *
 * Verificarea de aici este de confort, nu de securitate: ascunde ecranele pe
 * care serverul le-ar refuza oricum. Decizia reală rămâne la server, iar
 * implementarea în memorie o aplică la fel.
 */
function DoarAdministrator({ children }: { children: ReactNode }) {
  const { esteAdministrator } = useAutentificare()

  if (!esteAdministrator) {
    return (
      <Pagina>
        <StareGoala
          titlu="Acces restricționat"
          descriere="Această secțiune este disponibilă doar administratorului. Dacă ai nevoie de acces, cere-i administratorului să îți modifice rolul."
        />
      </Pagina>
    )
  }

  return <>{children}</>
}

function PaginaNegasita() {
  return (
    <Pagina>
      <StareGoala
        titlu="Pagina nu există"
        descriere="Adresa cerută nu corespunde niciunui ecran din aplicație."
      >
        <Buton varianta="primar" onClick={() => window.location.assign('/programari')}>
          Mergi la programări
        </Buton>
      </StareGoala>
    </Pagina>
  )
}
