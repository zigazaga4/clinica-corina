package ro.tzintelligence.clinica

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/*
  Marginile de sistem, duse până în CSS.

  `enableEdgeToEdge()` întinde aplicația peste tot ecranul, pe sub bara de stare
  și pe sub bara de gesturi. Este ce vrem — fundalul aplicației urcă până în
  colțuri, în loc să lase două dungi cenușii — dar mută în seama noastră o
  obligație: conținutul care nu trebuie atins de sistem să fie tras înăuntru cu
  mâna.

  Pe iOS asta se rezolvă din foaia de stil, cu `env(safe-area-inset-*)`. În
  WebView-ul Android acele valori sunt zero chiar și aici, unde barele chiar
  există: Chromium nu primește `WindowInsets` de la activitate. Rezultatul era
  o bară de file desenată corect, la marginea de jos a ecranului — adică exact
  sub pastila de gesturi, care îi acoperea etichetele.

  Activitatea are măsurătorile. Le scrie în aceleași variabile pe care le
  citește CSS-ul, ca stil inline pe `<html>`, de unde bat regula implicită cu
  `env()`. Unde puntea nu există — desktop, iOS — nimic nu se scrie și `env()`
  rămâne în picioare.
*/
class MainActivity : TauriActivity() {
  /** Ultimele margini primite, în pixeli CSS. Le cere și pagina, la pornire. */
  private var margini = Margini()

  private data class Margini(
    val sus: Float = 0f,
    val jos: Float = 0f,
    val stanga: Float = 0f,
    val dreapta: Float = 0f,
  )

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(Punte(), "MargineSigura")

    ViewCompat.setOnApplyWindowInsetsListener(webView) { vedere, ferestre ->
      /*
        Barele de sistem ȘI decupajul camerei: pe telefoanele cu gaură în ecran
        cele două nu coincid, iar în peisaj decupajul ajunge pe o margine
        laterală, unde nicio bară nu-l acoperă.
      */
      val margine = ferestre.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val densitate = vedere.resources.displayMetrics.density

      margini = Margini(
        sus = margine.top / densitate,
        jos = margine.bottom / densitate,
        stanga = margine.left / densitate,
        dreapta = margine.right / densitate,
      )
      (vedere as WebView).evaluateJavascript(scriptDeAplicat(), null)

      /*
        Marginile pleacă mai departe neconsumate: le-am citit, nu le-am
        rezolvat. Consumate aici, orice altă vedere din activitate — tastatura,
        un dialog de plugin — ar rămâne fără ele.
      */
      ferestre
    }
  }

  private fun scriptDeAplicat(): String =
    "(function(){var s=document.documentElement.style;" +
      "s.setProperty('--margine-sus','${margini.sus}px');" +
      "s.setProperty('--margine-jos','${margini.jos}px');" +
      "s.setProperty('--margine-stanga','${margini.stanga}px');" +
      "s.setProperty('--margine-dreapta','${margini.dreapta}px');})()"

  /**
   * Aceleași valori, dar cerute de pagină.
   *
   * Ascultătorul de mai sus se declanșează la așezarea vederii, care se
   * întâmplă de obicei înaintea încărcării documentului: scrisul lui nimerește
   * într-un `<html>` care va fi înlocuit, iar pagina pornește fără margini.
   * Puntea închide cursa — pagina întreabă când e gata (v. `app/margini.ts`).
   */
  private inner class Punte {
    @JavascriptInterface fun sus(): Float = margini.sus
    @JavascriptInterface fun jos(): Float = margini.jos
    @JavascriptInterface fun stanga(): Float = margini.stanga
    @JavascriptInterface fun dreapta(): Float = margini.dreapta
  }
}
