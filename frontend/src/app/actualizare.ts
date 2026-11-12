import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

/**
 * Verificarea versiunii instalate.
 *
 * Aplicația de Windows întreabă un fișier public — `latest.json`, publicat de
 * GitHub odată cu instalatorul — dacă a apărut ceva mai nou. Dacă da, partea
 * de interfață oprește lucrul și cere instalarea; vezi `EcranActualizare`.
 *
 * Două lucruri de reținut:
 *
 * 1. Pachetul descărcat este verificat criptografic înainte de a fi pornit.
 *    Cheia publică stă în `tauri.conf.json`, iar perechea ei privată doar în
 *    secretele depozitului. Un fișier pus acolo de altcineva este refuzat, deci
 *    faptul că adresa e publică nu deschide nicio ușă.
 *
 * 2. O verificare eșuată NU blochează nimic. Fără internet, cu serverul căzut
 *    sau pe telefon — unde modulul nici nu există — programul merge mai
 *    departe neschimbat. Se blochează doar când se știe sigur că există o
 *    versiune nouă.
 */

/**
 * La cât timp se întreabă din nou, cât timp aplicația stă deschisă. Același
 * ritm îl folosește și verificarea versiunii web (`versiuneWeb.ts`).
 */
export const INTERVAL_VERIFICARE = 15 * 60 * 1000

export type StareActualizare =
  /** Nimic de făcut: fie e la zi, fie nu s-a putut afla. Aplicația merge. */
  | { faza: 'in-regula' }
  /** Există o versiune nouă. De aici încolo aplicația nu mai e utilizabilă. */
  | { faza: 'gasita'; versiune: string; versiuneCurenta: string; note?: string }
  | { faza: 'descarcare'; versiune: string; procent: number | null }
  | { faza: 'instalare'; versiune: string }
  | { faza: 'esec'; versiune: string; mesaj: string }

/**
 * Are rost să întrebăm?
 *
 * Doar în aplicația de birou. În browser nu există nimic de instalat, iar pe
 * telefon actualizarea vine prin APK — modulul nu e compilat pentru Android,
 * deci apelul ar da eroare de fiecare dată, degeaba.
 */
function poateVerifica(): boolean {
  if (typeof window === 'undefined' || !isTauri()) return false
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function mesajEroare(eroare: unknown): string {
  if (eroare instanceof Error) return eroare.message
  if (typeof eroare === 'string') return eroare
  return 'Eroare necunoscută.'
}

export function useActualizare(): {
  stare: StareActualizare
  instaleaza: () => void
} {
  const [stare, setStare] = useState<StareActualizare>({ faza: 'in-regula' })

  // Obiectul primit de la verificare, păstrat ca să nu fie nevoie de o a doua
  // interogare la apăsarea butonului.
  const pachet = useRef<Update | null>(null)

  useEffect(() => {
    if (!poateVerifica()) return

    let anulat = false
    let cronometru: ReturnType<typeof setInterval> | undefined

    const verifica = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const gasit = await check()
        if (anulat || !gasit) return
        pachet.current = gasit
        setStare({
          faza: 'gasita',
          versiune: gasit.version,
          versiuneCurenta: gasit.currentVersion,
          note: gasit.body,
        })
        // S-a găsit; nu mai are rost să întrebăm până la repornire.
        clearInterval(cronometru)
      } catch (eroare) {
        if (import.meta.env.DEV) {
          console.warn('Verificarea versiunii nu a reușit:', eroare)
        }
      }
    }

    void verifica()
    cronometru = setInterval(() => void verifica(), INTERVAL_VERIFICARE)

    return () => {
      anulat = true
      clearInterval(cronometru)
    }
  }, [])

  const instaleaza = useCallback(() => {
    void (async () => {
      // Ținut în afara blocului: dacă instalarea cade, ecranul de eroare tot
      // trebuie să poată spune despre ce versiune era vorba.
      let versiune = pachet.current?.version ?? ''
      try {
        // După un eșec, obiectul de dinainte poate fi deja închis; atunci
        // întrebăm din nou, ca reîncercarea să pornească de la zero.
        let pachetul = pachet.current
        if (!pachetul) {
          const { check } = await import('@tauri-apps/plugin-updater')
          pachetul = await check()
          pachet.current = pachetul
        }
        if (!pachetul) {
          // Între timp a dispărut: nu mai e nimic de instalat, dăm drumul.
          setStare({ faza: 'in-regula' })
          return
        }

        versiune = pachetul.version
        setStare({ faza: 'descarcare', versiune, procent: null })

        let total = 0
        let primite = 0

        await pachetul.downloadAndInstall((eveniment: DownloadEvent) => {
          if (eveniment.event === 'Started') {
            total = eveniment.data.contentLength ?? 0
            setStare({ faza: 'descarcare', versiune, procent: total ? 0 : null })
          } else if (eveniment.event === 'Progress') {
            primite += eveniment.data.chunkLength
            setStare({
              faza: 'descarcare',
              versiune,
              // Fără lungime anunțată nu se poate calcula un procent; ecranul
              // arată atunci o bară nedeterminată, nu un procent inventat.
              procent: total ? Math.min(100, Math.round((primite / total) * 100)) : null,
            })
          } else {
            setStare({ faza: 'instalare', versiune })
          }
        })

        // Pe Windows nu se ajunge aici: instalatorul închide singur programul
        // și îl repornește. Rândurile de mai jos sunt pentru macOS și Linux.
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      } catch (eroare) {
        // Obiectul poate fi într-o stare de nefolosit după eroare; îl uităm,
        // ca reîncercarea să pornească de la o verificare curată.
        pachet.current = null
        setStare({ faza: 'esec', versiune, mesaj: mesajEroare(eroare) })
      }
    })()
  }, [])

  return { stare, instaleaza }
}
