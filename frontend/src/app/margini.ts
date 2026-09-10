/**
 * Marginile de sistem, cerute de la gazda nativă.
 *
 * Pe iOS și pe desktop nu are ce face: `env(safe-area-inset-*)` din `index.css`
 * răspunde corect și variabilele sunt deja bune. Pe Android, unde `env()`
 * întoarce zero deși bara de stare și pastila de gesturi acoperă chiar
 * marginile paginii, activitatea expune măsurătorile reale (v. `MainActivity.kt`)
 * și acestea le mută în CSS.
 *
 * Partea nativă le trimite și singură, la fiecare așezare a vederii. Dar acea
 * așezare cade de obicei înaintea încărcării documentului, iar ce a scris pe
 * `<html>`-ul de atunci se pierde odată cu el. Deci întreabă și pagina, când
 * știe sigur că există.
 */

interface PunteMargini {
  sus(): number
  jos(): number
  stanga(): number
  dreapta(): number
}

declare global {
  interface Window {
    MargineSigura?: PunteMargini
  }
}

export function urmaresteMarginileSigure(): void {
  const punte = window.MargineSigura
  if (!punte) return

  const scrie = () => {
    const stil = document.documentElement.style
    try {
      stil.setProperty('--margine-sus', `${punte.sus()}px`)
      stil.setProperty('--margine-jos', `${punte.jos()}px`)
      stil.setProperty('--margine-stanga', `${punte.stanga()}px`)
      stil.setProperty('--margine-dreapta', `${punte.dreapta()}px`)
    } catch {
      /*
        Puntea trece prin JNI și poate dispărea sub noi la distrugerea
        activității. O margine nescrisă înseamnă o bară puțin prea jos; o
        excepție aici ar opri redarea. Valorile rămân cele de dinainte.
      */
    }
  }

  scrie()

  /*
    Rotirea ecranului mută decupajul de sus pe o latură, iar tastatura schimbă
    zona vizibilă. Ambele ajung aici ca redimensionare.
  */
  window.addEventListener('resize', scrie)
  window.addEventListener('orientationchange', scrie)
  window.visualViewport?.addEventListener('resize', scrie)
}
