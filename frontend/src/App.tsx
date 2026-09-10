import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { esteEroareApi } from '@/api/errors'
import { FurnizorAutentificare } from '@/app/auth'
import { FurnizorTema } from '@/app/theme'
import { PoartaActualizare } from '@/components/EcranActualizare'
import { Rute } from '@/routes'
import { FurnizorNotificari } from '@/ui'

/**
 * Politica de interogare.
 *
 * `retry` este selectiv, nu global: reîncercarea unui 403 sau a unui 404 nu
 * are cum să reușească a doua oară și nu face decât să întârzie mesajul de
 * eroare cu câteva secunde. Doar erorile de rețea și cele de server merită o
 * a doua șansă.
 */
const clientInterogari = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Aplicația este de birou și rămâne deschisă toată ziua; reîncărcarea la
      // fiecare revenire în fereastră ar fi trafic constant fără câștig.
      refetchOnWindowFocus: false,
      retry: (numarIncercari, eroare) => {
        if (esteEroareApi(eroare)) {
          const definitiva = ['validare', 'neautentificat', 'interzis', 'negasit', 'conflict']
          if (definitiva.includes(eroare.cod)) return false
        }
        return numarIncercari < 2
      },
    },
    mutations: {
      // O mutație reluată automat ar putea înregistra vânzarea de două ori.
      retry: false,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={clientInterogari}>
      <FurnizorTema>
        {/*
          Poarta stă înăuntrul temei, ca ecranul de actualizare să fie și el
          deschis sau întunecat după preferința utilizatorului, dar în afara
          restului: când cere o actualizare, tot ce urmează dispare din pagină.
        */}
        <PoartaActualizare>
          <FurnizorNotificari>
            <BrowserRouter>
              <FurnizorAutentificare>
                <Rute />
              </FurnizorAutentificare>
            </BrowserRouter>
          </FurnizorNotificari>
        </PoartaActualizare>
      </FurnizorTema>
    </QueryClientProvider>
  )
}
