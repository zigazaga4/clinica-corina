import '@testing-library/jest-dom/vitest'
import { beforeAll, beforeEach } from 'vitest'
import { configureazaLatenta } from '@/api/memory/client'
import { populeaza } from '@/api/memory/seed'
import { stergeTokenuri } from '@/api/session'
import { seteazaFunctii } from '@/config/functii'

/*
  Pregătirea mediului de test.

  Latența simulată se oprește: în aplicație face vizibile stările de încărcare,
  în teste ar adăuga sute de milisecunde la fiecare apel, fără nicio informație
  în plus.

  Datele se repopulează înaintea fiecărui test. Magazinul în memorie este un
  modul cu stare partajată, deci un test care arhivează un client ar schimba
  altfel numărul de rânduri așteptat de următorul — iar suita ar depinde de
  ordinea de rulare.
*/

configureazaLatenta(0)

/**
 * jsdom nu implementează `<dialog>`.
 *
 * `Modala` este construită peste elementul nativ, tocmai ca să obțină gratuit
 * capturarea focalizării și închiderea cu Escape. Completarea trăiește aici, nu
 * într-un fișier de test anume: altfel fiecare test care deschide o fereastră
 * modală — și vor fi multe — ar trebui să o copieze.
 */
beforeAll(() => {
  /*
    Nu orice test are ecran.

    Fișierele marcate `@vitest-environment node` — cel care desenează PDF-ul
    acordului, de pildă — rulează fără `jsdom`, fiindcă au nevoie de `node:fs`
    și de `node:zlib`, pe care mediul de browser le scoate din joc. Acolo
    `window` nu există, iar completările de mai jos nu au ce completa.
  */
  if (typeof window === 'undefined') return

  const prototip = window.HTMLDialogElement?.prototype ?? HTMLElement.prototype
  Object.assign(prototip, {
    showModal(this: HTMLElement) {
      this.setAttribute('open', '')
    },
    close(this: HTMLElement) {
      this.removeAttribute('open')
    },
  })

  // `matchMedia` lipsește din jsdom, iar `FurnizorTema` o interoghează la
  // montare pentru tema „ca sistemul”. Fără ea, orice randare de ecran cade.
  if (!window.matchMedia) {
    window.matchMedia = ((interogare: string) => ({
      matches: false,
      media: interogare,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }

  // `Combobox` derulează opțiunea evidențiată în câmpul vizibil.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }

  // Tragerea unui interval pe grila calendarului (`StratSelectie`) ține
  // indicatorul cu `setPointerCapture`, pe care jsdom nu îl are.
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => undefined
    Element.prototype.releasePointerCapture = () => undefined
    Element.prototype.hasPointerCapture = () => false
  }
})

beforeEach(() => {
  populeaza()
  stergeTokenuri()
  // Suita pornește cu aplicația COMPLETĂ: fork-ul livrat e simplu (fără bani și
  // abonamente), dar regulile pe care le ascunde rămân și rămân testate. Un test
  // al variantei simple își oprește comutatoarele singur, în propriul beforeEach.
  seteazaFunctii({ costuri: true, tratamente: true })
})
