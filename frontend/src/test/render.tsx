import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { api } from '@/api'
import { PAROLA_DEMO } from '@/api/memory/seed'
import { scrieTokenuri } from '@/api/session'
import { FurnizorAutentificare, useAutentificare } from '@/app/auth'
import { FurnizorTema } from '@/app/theme'
import { FurnizorNotificari } from '@/ui'

/*
  Randarea în teste.

  Orice ecran are nevoie de aceleași cinci furnizori. Adunați aici, un test nou
  începe cu o linie, iar adăugarea unui al șaselea furnizor în aplicație nu
  cere modificarea fiecărui fișier de test.
*/

/**
 * Un `QueryClient` NOU pentru fiecare randare.
 *
 * Refolosirea unuia singur ar transporta memoria cache de la un test la
 * următorul: al doilea ar vedea instantaneu datele primului și ar trece chiar
 * dacă cererea lui este stricată. Reîncercările sunt oprite, ca o eroare
 * așteptată să nu întârzie testul cu două reluări.
 */
function clientDeTest(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Ține copiii nerandați până se termină verificarea sesiunii.
 *
 * `FurnizorAutentificare` află cine este utilizatorul ASINCRON, iar în
 * aplicație `RutaProtejata` afișează între timp un ecran de încărcare. Ecranele
 * care se sprijină pe `useUtilizator()` — fișa clientului, de pildă — au voie
 * să presupună că există cineva autentificat tocmai pentru că nu se randează
 * niciodată mai devreme. Fără poarta asta, testul le-ar monta într-un moment
 * imposibil în aplicația reală și ar pica pe o eroare care nu există nicăieri
 * în afara testelor.
 *
 * Spre deosebire de `RutaProtejata`, nu redirecționează: un test care randează
 * ecranul de autentificare trebuie să îl vadă chiar fără utilizator.
 */
function DupaVerificareaSesiunii({ children }: { children: ReactNode }) {
  const { seVerifica } = useAutentificare()
  return seVerifica ? null : <>{children}</>
}

export function Furnizori({
  children,
  /**
   * Adresa de pornire. Contează pentru ecranele care citesc un parametru din
   * rută (`useParams`): fișa clientului fără `:id` s-ar randa ca eroare, nu ca
   * fișă, iar testul ar verifica altceva decât crede.
   */
  adresa = '/',
}: {
  children: ReactNode
  adresa?: string
}) {
  return (
    <QueryClientProvider client={clientDeTest()}>
      <FurnizorTema>
        <FurnizorNotificari>
          <MemoryRouter initialEntries={[adresa]}>
            <FurnizorAutentificare>
              <DupaVerificareaSesiunii>{children}</DupaVerificareaSesiunii>
            </FurnizorAutentificare>
          </MemoryRouter>
        </FurnizorNotificari>
      </FurnizorTema>
    </QueryClientProvider>
  )
}

/** Randează un element cu toți furnizorii aplicației. */
export function randeaza(element: ReactElement, adresa?: string): RenderResult {
  return render(<Furnizori {...(adresa ? { adresa } : {})}>{element}</Furnizori>)
}

/**
 * Deschide o sesiune ÎNAINTE de randare.
 *
 * `FurnizorAutentificare` citește token-urile la montare, deci autentificarea
 * de după `randeaza` ar ajunge prea târziu: ecranul s-ar randa deja ca
 * neautentificat.
 */
export async function autentifica(email = 'admin@clinica.ro') {
  const raspuns = await api.auth.login({ email, parola: PAROLA_DEMO })
  scrieTokenuri({
    access_token: raspuns.access_token,
    refresh_token: raspuns.refresh_token,
    expira_la: raspuns.expira_la,
  })
  return raspuns.utilizator
}

/** Parola statisticilor în teste — alta decât a conturilor, ca în aplicație. */
export const PAROLA_STATISTICI_TEST = 'statistici-test'

/**
 * Deblochează statisticile pentru sesiunea curentă: le alege parola, dacă nu
 * există încă (cere un administrator autentificat), altfel o folosește.
 * Pentru ecranele din spatele ei — lista încasărilor, cheltuielile, raportul.
 */
export async function deschideStatisticile(parola = PAROLA_STATISTICI_TEST) {
  const { parola_setata } = await api.statistici.stare()
  return parola_setata
    ? api.statistici.deblocheaza(parola)
    : api.statistici.seteazaParola({ parola_noua: parola })
}
