import { afterEach, describe, expect, it, vi } from 'vitest'
import { porneste, type BibliotecaPad, type PunctSemnatura } from './pad'

/*
  Probele tabletei, cu o bibliotecă prefăcută în locul celei adevărate.

  Nu există aparat de semnat în atelierul de probe și nici serviciu Windows
  care să asculte pe `localhost`. Dar partea care poate greși nu este aparatul:
  sunt ocolișurile din jurul lui — adresa care trebuie încercată a doua oară,
  promisiunea care nu se termină niciodată, confirmarea apăsată în același timp
  de două mâini. Toate se pot pune la încercare aici, iar dacă se strică
  vreuna, se strică în clipa cea mai proastă cu putință: cu clientul de față.

  `porneste` primește biblioteca ca parametru tocmai pentru asta.
*/

const PNG_PROBA = 'iVBORw0KGgo='

interface OptiuniFalse {
  /** Adresele la care „serviciul” nu răspunde. */
  adreseMoarte?: string[]
  /** Nicio tabletă legată. */
  faraPad?: boolean
  /** `searchForPads` nu se termină niciodată. */
  cautareAgatata?: boolean
  /** `openPad` respinge cu acest cod de eroare. */
  codLaDeschidere?: number
  puncte?: number
}

function bibliotecaFalsa(optiuni: OptiuniFalse = {}) {
  const jurnal: string[] = []
  let laPunct: (x: number, y: number, p: number) => void = () => undefined
  let butonConfirma: () => void = () => undefined

  const commons: BibliotecaPad['commons'] = {
    createConnection(url, onOpen, _onClose, onError) {
      jurnal.push(`legatura:${url}`)
      // Biblioteca adevărată cheamă înapoi asincron, după ce strânge mâna cu
      // serverul. Prefăcută altfel, ar ascunde exact cursele de sincronizare.
      queueMicrotask(() => {
        if (optiuni.adreseMoarte?.includes(url)) onError(new Event('error'))
        else onOpen(new Event('open'))
      })
    },
    destroyConnection() {
      jurnal.push('desfacere')
    },
    set handleNextSignaturePoint(f: (x: number, y: number, p: number) => void) {
      laPunct = f
    },
    get handleNextSignaturePoint() {
      return laPunct
    },
    handleDisconnect: () => undefined,
  }

  class ParamsCautare {
    subset = ''
    setPadSubset(s: string) {
      this.subset = s
    }
  }
  class ParamsIndex {
    constructor(public index: number) {}
  }
  class ParamsSemnatura {
    setFieldName() {}
    setCustomText() {}
  }
  class ParamsImagine {
    setFileType() {}
    setPenWidth() {}
  }

  const standard: BibliotecaPad['default'] = {
    Params: {
      searchForPads: ParamsCautare,
      openPad: ParamsIndex,
      closePad: ParamsIndex,
      startSignature: ParamsSemnatura,
      getSignatureImage: ParamsImagine,
    },
    FileType: { PNG: 1 },
    searchForPads: async () => {
      jurnal.push('cautare')
      if (optiuni.cautareAgatata) return new Promise(() => undefined)
      if (optiuni.faraPad) return { foundPads: [] }
      return {
        foundPads: [
          { index: 0, type: 1, serialNumber: '1000444927', firmwareVersion: '2.5' },
        ],
      }
    },
    openPad: async () => {
      jurnal.push('deschide')
      if (optiuni.codLaDeschidere !== undefined) {
        // Biblioteca aruncă obiecte simple, nu `Error`.
        throw { errorCode: optiuni.codLaDeschidere, errorMessage: 'nu contează' }
      }
      return { padInfo: { xResolution: 1000, yResolution: 500 } }
    },
    closePad: async () => {
      jurnal.push('inchide')
      return {}
    },
    startSignature: async () => {
      jurnal.push('start')
      return {}
    },
    confirmSignature: async () => {
      jurnal.push('confirma')
      return { countedPoints: optiuni.puncte ?? 240 }
    },
    cancelSignature: async () => {
      jurnal.push('anuleaza')
      return {}
    },
    retrySignature: async () => {
      jurnal.push('reia')
      return {}
    },
    getSignatureImage: async () => {
      jurnal.push('imagine')
      return { file: PNG_PROBA }
    },
    set handleConfirmSignature(f: () => void) {
      butonConfirma = f
    },
    get handleConfirmSignature() {
      return butonConfirma
    },
    handleRetrySignature: () => undefined,
    handleCancelSignature: () => undefined,
    handleError: () => undefined,
  }

  return {
    lib: { commons, default: standard } as BibliotecaPad,
    jurnal,
    /** Imită creionul pe tabletă. */
    deseneaza: (x: number, y: number, p: number) => laPunct(x, y, p),
    /** Imită butonul „OK” apăsat pe aparat. */
    apasaOk: () => butonConfirma(),
  }
}

function optiuniDePorneste(lib: BibliotecaPad, extra: Partial<Parameters<typeof porneste>[0]> = {}) {
  return {
    numeCamp: 'Ana Popescu',
    laSemnatura: () => undefined,
    biblioteca: lib,
    ...extra,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pornirea', () => {
  it('caută, deschide și pornește semnătura, în ordinea asta', async () => {
    const { lib, jurnal } = bibliotecaFalsa()
    const sesiune = await porneste(optiuniDePorneste(lib))

    expect(jurnal).toEqual([
      'legatura:wss://local.signotecwebsocket.de:49494',
      'cautare',
      'deschide',
      'start',
    ])
    await sesiune.inchide()
  })

  it('numește aparatul așa cum se scrie în acord', async () => {
    const { lib } = bibliotecaFalsa()
    const sesiune = await porneste(optiuniDePorneste(lib))

    // Modelul 1 este „Sigma USB”; exact aparatul clinicii.
    expect(sesiune.dispozitiv).toBe('signotec Sigma (S/N 1000444927, firmware 2.5)')
    await sesiune.inchide()
  })

  it('ia rezoluția senzorului de sub `padInfo`, unde o pune biblioteca', async () => {
    // Documentația o dă direct pe obiect. Dacă cineva „corectează” după
    // documentație, oglinda de pe ecran rămâne goală și nimeni nu înțelege de ce.
    const { lib } = bibliotecaFalsa()
    const sesiune = await porneste(optiuniDePorneste(lib))

    expect(sesiune.latimeSenzor).toBe(1000)
    expect(sesiune.inaltimeSenzor).toBe(500)
    await sesiune.inchide()
  })

  it('încearcă adresa următoare când prima nu răspunde', async () => {
    // Instalarea serviciului are patru variante, fiecare cu altă adresă.
    const { lib, jurnal } = bibliotecaFalsa({
      adreseMoarte: ['wss://local.signotecwebsocket.de:49494', 'wss://localhost:49494'],
    })
    const sesiune = await porneste(optiuniDePorneste(lib))

    expect(jurnal.filter((l) => l.startsWith('legatura:'))).toEqual([
      'legatura:wss://local.signotecwebsocket.de:49494',
      'legatura:wss://localhost:49494',
      'legatura:ws://127.0.0.1:49494',
    ])
    // Fiecare încercare ratată își desface legătura: a doua `createConnection`
    // pe un obiect viu ar arunca.
    expect(jurnal.filter((l) => l === 'desfacere').length).toBeGreaterThanOrEqual(2)
    await sesiune.inchide()
  })

  it('spune ce trebuie pornit când niciun serviciu nu răspunde', async () => {
    const { lib } = bibliotecaFalsa({
      adreseMoarte: [
        'wss://local.signotecwebsocket.de:49494',
        'wss://localhost:49494',
        'ws://127.0.0.1:49494',
      ],
    })

    await expect(porneste(optiuniDePorneste(lib))).rejects.toThrow(/signoPAD-API\/Web/)
  })

  it('spune să se verifice cablul când nu e nicio tabletă legată', async () => {
    const { lib, jurnal } = bibliotecaFalsa({ faraPad: true })

    await expect(porneste(optiuniDePorneste(lib))).rejects.toThrow(/cablul USB/)
    // Legătura nu rămâne agățată după un eșec, altfel a doua încercare cade
    // pe „WebSocket object is already created”.
    expect(jurnal).toContain('desfacere')
  })

  it('traduce codul de eroare al bibliotecii în ceva de citit', async () => {
    // -4 = tableta e deschisă de alt program.
    const { lib } = bibliotecaFalsa({ codLaDeschidere: -4 })

    await expect(porneste(optiuniDePorneste(lib))).rejects.toThrow(/folosită de alt program/)
  })

  it('nu așteptă la nesfârșit un răspuns care nu vine', async () => {
    /*
      Promisiunile bibliotecii NU expiră: așteptarea este o buclă care se
      învârte până primește răspuns. Cu serviciul oprit între timp, ecranul ar
      fi rămas cu rotița învârtindu-se și clientul așteptând în picioare.
    */
    vi.useFakeTimers()
    const { lib } = bibliotecaFalsa({ cautareAgatata: true })

    const pornirea = porneste(optiuniDePorneste(lib))
    const asteptarea = expect(pornirea).rejects.toThrow(/nu a răspuns/)

    await vi.advanceTimersByTimeAsync(20_000)
    await asteptarea
  })
})

describe('semnarea', () => {
  it('trimite punctele mai departe, pentru oglinda de pe ecran', async () => {
    const puncte: PunctSemnatura[] = []
    const { lib, deseneaza } = bibliotecaFalsa()
    const sesiune = await porneste(optiuniDePorneste(lib, { laPunct: (p) => puncte.push(p) }))

    deseneaza(10, 20, 0)
    deseneaza(11, 22, 1)

    expect(puncte).toEqual([
      { x: 10, y: 20, p: 0 },
      { x: 11, y: 22, p: 1 },
    ])
    await sesiune.inchide()
  })

  it('întoarce PNG-ul decodat și numărul de puncte', async () => {
    const culese: { png: Uint8Array; puncte: number }[] = []
    const { lib } = bibliotecaFalsa({ puncte: 315 })
    const sesiune = await porneste(
      optiuniDePorneste(lib, { laSemnatura: (s) => culese.push(s) }),
    )

    await sesiune.confirma()

    expect(culese).toHaveLength(1)
    expect(culese[0]?.puncte).toBe(315)
    // `\x89PNG` — semnătura de fișier, ca să se știe că base64 a fost decodat.
    expect(Array.from(culese[0]!.png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    await sesiune.inchide()
  })

  it('confirmă o singură dată, chiar apăsată din două părți deodată', async () => {
    /*
      Clientul apasă „OK” pe tabletă exact când recepția apasă pe ecran.
      Fără zăvor s-ar chema `confirmSignature()` de două ori, iar a doua oară
      aparatul răspunde cu eroare — după ce prima reușise. Ar arăta a eșec,
      deși semnătura era deja culeasă.
    */
    const culese: unknown[] = []
    const { lib, jurnal, apasaOk } = bibliotecaFalsa()
    const sesiune = await porneste(
      optiuniDePorneste(lib, { laSemnatura: (s) => culese.push(s) }),
    )

    apasaOk()
    await sesiune.confirma()

    expect(jurnal.filter((l) => l === 'confirma')).toHaveLength(1)
    expect(culese).toHaveLength(1)
    await sesiune.inchide()
  })

  it('închide întâi tableta, apoi legătura', async () => {
    const { lib, jurnal } = bibliotecaFalsa()
    const sesiune = await porneste(optiuniDePorneste(lib))

    await sesiune.inchide()

    expect(jurnal.slice(-2)).toEqual(['inchide', 'desfacere'])
  })

  it('se poate închide de oricâte ori', async () => {
    // Se cheamă și din curățarea efectului React, și din drumul obișnuit.
    const { lib, jurnal } = bibliotecaFalsa()
    const sesiune = await porneste(optiuniDePorneste(lib))

    await sesiune.inchide()
    await sesiune.inchide()

    expect(jurnal.filter((l) => l === 'inchide')).toHaveLength(1)
  })
})

describe('porniri suprapuse', () => {
  it('a doua pornire o închide pe prima, nu se lovește de ea', async () => {
    /*
      React rulează efectele de două ori în dezvoltare (`StrictMode`), iar
      biblioteca ține un singur WebSocket și aruncă la a doua legătură. Fără
      lanțul de așteptare, ecranul de semnare ar fi murit din prima, dar numai
      pe calculatorul clinicii.
    */
    const { lib, jurnal } = bibliotecaFalsa()

    const [una, doua] = await Promise.all([
      porneste(optiuniDePorneste(lib)),
      porneste(optiuniDePorneste(lib)),
    ])

    expect(jurnal.filter((l) => l === 'start')).toHaveLength(2)
    // Prima a fost închisă înainte ca a doua să se lege.
    expect(jurnal.indexOf('desfacere')).toBeLessThan(jurnal.lastIndexOf('legatura:wss://local.signotecwebsocket.de:49494'))

    await una.inchide()
    await doua.inchide()
  })
})
