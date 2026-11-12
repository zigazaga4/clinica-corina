import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { INTERVAL_VERIFICARE } from '@/app/actualizare'

/**
 * Pagina web află singură că există o versiune nouă.
 *
 * Aplicația se actualizează prin înlocuirea fișierelor de pe server, dar o
 * filă (sau aplicația de pe ecranul principal al telefonului) deschisă dinainte
 * rămâne pe scripturile pe care le-a încărcat la pornire. Zile la rând, într-un
 * birou unde calculatorul nu se închide. Singura cale era Ctrl+Shift+R, pe care
 * nu o știe nimeni.
 *
 * Verificarea compară scriptul pe care îl rulează pagina acum cu cel din
 * `index.html` de pe server. Numele lui poartă o amprentă (`index-a1b2c3.js`),
 * deci diferă exact atunci când s-a publicat altceva. Nimic nu se reîncarcă
 * singur: omul poate avea o programare pe jumătate scrisă. Doar i se spune.
 *
 * Ca la verificarea aplicației de Windows (`actualizare.ts`), un răspuns care
 * nu se poate citi — fără internet, server căzut, o pagină de autentificare a
 * unei rețele publice în loc de aplicație — nu înseamnă „versiune nouă”: se
 * ignoră și se mai încearcă.
 */

/** Oricâte reveniri în fereastră ar fi, nu se întreabă mai des de atât. */
const PAUZA_MINIMA = 60 * 1000

/** Scriptul de pornire dintr-un `index.html`: `src` din primul `<script type="module">`. */
export function intrareDinHtml(html: string): string | null {
  for (const [eticheta] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']module["']/i.test(eticheta)) continue
    const src = /\bsrc=["']([^"']+)["']/i.exec(eticheta)?.[1]
    if (src) return src
  }
  return null
}

/** Scriptul de pornire pe care îl rulează pagina de față. */
function intrareCurenta(): string | null {
  return document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null
}

/**
 * Are rost să întrebăm? Doar în pagina publicată: în dezvoltare nu există
 * amprente, iar aplicația instalată își are propriul mecanism.
 */
function poateVerifica(): boolean {
  return import.meta.env.PROD && !isTauri()
}

export function useVersiuneNoua({
  activ = poateVerifica(),
  reincarca = () => window.location.reload(),
}: {
  /** Se oprește verificarea fără a scoate hook-ul (pentru teste). */
  activ?: boolean
  reincarca?: () => void
} = {}): { disponibila: boolean; actualizeaza: () => void } {
  const [disponibila, setDisponibila] = useState(false)
  const ultimaVerificare = useRef(0)

  useEffect(() => {
    // Odată găsită, nu mai are rost să întrebăm: banda rămâne până la reîncărcare.
    if (!activ || disponibila) return

    let anulat = false

    const verifica = async () => {
      const acum = Date.now()
      if (acum - ultimaVerificare.current < PAUZA_MINIMA) return
      ultimaVerificare.current = acum

      try {
        // `no-store`: o copie din memoria browserului ar spune mereu „nimic nou”.
        const raspuns = await fetch(`${import.meta.env.BASE_URL}index.html`, { cache: 'no-store' })
        if (!raspuns.ok) return
        const deLaServer = intrareDinHtml(await raspuns.text())
        const curenta = intrareCurenta()
        if (anulat || !deLaServer || !curenta || deLaServer === curenta) return
        setDisponibila(true)
      } catch {
        // Fără rețea: se încearcă la următoarea revenire în fereastră.
      }
    }

    const laRevenire = () => {
      if (document.visibilityState === 'visible') void verifica()
    }

    void verifica()
    const cronometru = setInterval(() => void verifica(), INTERVAL_VERIFICARE)
    document.addEventListener('visibilitychange', laRevenire)
    window.addEventListener('online', laRevenire)

    return () => {
      anulat = true
      clearInterval(cronometru)
      document.removeEventListener('visibilitychange', laRevenire)
      window.removeEventListener('online', laRevenire)
    }
  }, [activ, disponibila])

  return { disponibila, actualizeaza: reincarca }
}
