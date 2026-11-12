import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { intrareDinHtml, useVersiuneNoua } from './versiuneWeb'

/** `index.html` așa cum îl produce compilarea, cu scriptul de pornire dat. */
function pagina(intrare: string): string {
  return `<!doctype html><html><head>
    <link rel="manifest" href="/app/manifest.webmanifest" />
    <script type="module" crossorigin src="${intrare}"></script>
    <link rel="modulepreload" crossorigin href="/app/assets/rolldown-runtime-Dik6OG8R.js">
    <link rel="stylesheet" crossorigin href="/app/assets/index-B60HoTYa.css">
  </head><body><div id="root"></div></body></html>`
}

describe('intrareDinHtml', () => {
  it('scoate scriptul de pornire, nu legăturile din jurul lui', () => {
    expect(intrareDinHtml(pagina('/app/assets/index-DtCRfWAv.js'))).toBe(
      '/app/assets/index-DtCRfWAv.js',
    )
  })

  it('nu depinde de ordinea atributelor', () => {
    expect(intrareDinHtml('<script src="/a/x-1.js" crossorigin type="module"></script>')).toBe(
      '/a/x-1.js',
    )
  })

  it('ignoră scripturile obișnuite', () => {
    expect(intrareDinHtml('<script src="/analiza.js"></script>')).toBeNull()
  })

  it('întoarce nul pentru o pagină fără script (de pildă, a unei rețele publice)', () => {
    expect(intrareDinHtml('<html><body>Autentifică-te la Wi-Fi</body></html>')).toBeNull()
    expect(intrareDinHtml('')).toBeNull()
  })
})

describe('useVersiuneNoua', () => {
  let scriptCurent: HTMLScriptElement

  beforeEach(() => {
    // Pagina de față rulează „index-VECHI.js”.
    scriptCurent = document.createElement('script')
    scriptCurent.type = 'module'
    scriptCurent.setAttribute('src', '/app/assets/index-VECHI.js')
    document.head.appendChild(scriptCurent)
  })

  afterEach(() => {
    scriptCurent.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function serverulSpune(corp: string, ok = true) {
    const cerere = vi.fn(async () => ({ ok, text: async () => corp }) as Response)
    vi.stubGlobal('fetch', cerere)
    return cerere
  }

  it('anunță când serverul are alt script de pornire decât cel rulat', async () => {
    const cerere = serverulSpune(pagina('/app/assets/index-NOU.js'))
    const reincarca = vi.fn()
    const { result } = renderHook(() => useVersiuneNoua({ activ: true, reincarca }))

    await waitFor(() => expect(result.current.disponibila).toBe(true))

    // Se aduce pagina de pe server, nu o copie din memoria browserului.
    expect(cerere).toHaveBeenCalledWith('/index.html', { cache: 'no-store' })

    act(() => result.current.actualizeaza())
    expect(reincarca).toHaveBeenCalledTimes(1)
  })

  it('tace când serverul are aceeași versiune', async () => {
    const cerere = serverulSpune(pagina('/app/assets/index-VECHI.js'))
    const { result } = renderHook(() => useVersiuneNoua({ activ: true }))

    await waitFor(() => expect(cerere).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current.disponibila).toBe(false)
  })

  it.each([
    ['serverul răspunde cu eroare', () => serverulSpune(pagina('/app/assets/index-NOU.js'), false)],
    ['pagina primită nu e aplicația', () => serverulSpune('<html>Autentifică-te la Wi-Fi</html>')],
    [
      'rețeaua cade',
      () => {
        const cerere = vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        })
        vi.stubGlobal('fetch', cerere)
        return cerere
      },
    ],
  ])('nu strigă „versiune nouă” degeaba când %s', async (_caz, pregateste) => {
    const cerere = pregateste()
    const { result } = renderHook(() => useVersiuneNoua({ activ: true }))

    await waitFor(() => expect(cerere).toHaveBeenCalled())
    await act(async () => {})
    expect(result.current.disponibila).toBe(false)
  })

  it('nu întreabă nimic când e oprit (dezvoltare, aplicația de Windows)', async () => {
    const cerere = serverulSpune(pagina('/app/assets/index-NOU.js'))
    renderHook(() => useVersiuneNoua({ activ: false }))

    await act(async () => {})
    expect(cerere).not.toHaveBeenCalled()
  })

  it('întreabă din nou la revenirea în fereastră, dar nu mai des de un minut', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const cerere = serverulSpune(pagina('/app/assets/index-VECHI.js'))
    const { result } = renderHook(() => useVersiuneNoua({ activ: true }))
    await act(async () => {})
    expect(cerere).toHaveBeenCalledTimes(1)

    // Revenire imediată: prea devreme, nu se întreabă.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(cerere).toHaveBeenCalledTimes(1)

    // Peste o oră s-a publicat altceva; la revenire se află.
    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    serverulSpune(pagina('/app/assets/index-NOU.js'))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.disponibila).toBe(true)
  })
})
