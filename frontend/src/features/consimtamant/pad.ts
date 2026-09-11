/**
 * Tableta de semnat signotec, văzută din aplicație.
 *
 * Tableta NU este legată la aplicație direct. Pe calculatorul de la recepție
 * rulează un serviciu al producătorului — signoPAD-API/Web — care ține el
 * legătura pe USB cu aparatul și deschide, către programele de pe acel
 * calculator, un WebSocket local. Aplicația vorbește cu serviciul, serviciul
 * vorbește cu tableta. De aceea adresa este `localhost`, deși firul e USB:
 * `ws://` este limba serviciului, nu felul în care e legat aparatul.
 *
 * Biblioteca de mai jos, `pad/STPadServerLib-3.5.0.js`, este a producătorului
 * și este dată sub licență MIT (antetul ei o spune). Este păstrată în depozit
 * cu bună știință: fără ea nu s-ar putea semna, iar o versiune adusă de pe
 * internet la pornire ar însemna că o clinică fără internet nu mai poate lucra.
 *
 * Ce am aflat CITIND biblioteca, nu documentația, fiindcă documentația tace sau
 * se înșală — și fiecare punct de aici este motivul pentru care există cod în
 * plus mai jos:
 *
 *  1. Promisiunile ei NU expiră niciodată. Așteptarea răspunsului este o buclă
 *     `setTimeout(…, 1)` care se învârte la nesfârșit. Dacă serviciul moare în
 *     mijlocul unei cereri, promisiunea rămâne atârnată, iar ecranul ar aștepta
 *     până mâine. De aceea fiecare apel trece prin `cuTermen`.
 *  2. `openPad` întoarce datele SUB `padInfo`, nu direct pe obiect, cum scrie
 *     în documentație.
 *  3. Ce aruncă ea nu sunt obiecte `Error`, ci obiecte simple cu `errorCode` și
 *     `errorMessage` — iar la parametri greșiți aruncă de-a dreptul un șir.
 *  4. `createConnection` cheamă `_onOpen(event)` fără să verifice; dacă nu-i dai
 *     toate cele trei funcții, crapă în interiorul ei.
 *  5. O singură legătură poate exista la un moment dat: a doua `createConnection`
 *     aruncă. Sesiunea de aici este, prin urmare, tot una singură.
 */

import adresaBibliotecii from './pad/STPadServerLib-3.5.0.js?url'

// ---------------------------------------------------------------------------
// Fața bibliotecii producătorului
// ---------------------------------------------------------------------------

/** Eroarea aruncată de bibliotecă: obiect simplu, nu `Error`. */
interface EsecBiblioteca {
  errorCode?: number
  errorMessage?: string
}

interface PadGasit {
  index: number
  type: number
  serialNumber?: string
  firmwareVersion?: string
}

export interface BibliotecaPad {
  commons: {
    createConnection(
      url: string,
      onOpen: (e: unknown) => void,
      onClose: (e: unknown) => void,
      onError: (e: unknown) => void,
    ): void
    destroyConnection(): void
    handleNextSignaturePoint: (x: number, y: number, p: number) => void
    handleDisconnect: (index: unknown) => void
  }
  default: {
    Params: {
      searchForPads: new () => { setPadSubset(subset: string): void }
      openPad: new (index: number) => object
      closePad: new (index: number) => object
      startSignature: new () => {
        setFieldName(text: string): void
        setCustomText(text: string): void
      }
      getSignatureImage: new () => {
        setFileType(tip: number): void
        setPenWidth(latime: number): void
      }
    }
    FileType: { PNG: number }
    searchForPads(params: unknown): Promise<{ foundPads?: PadGasit[] }>
    openPad(params: unknown): Promise<{ padInfo?: { xResolution?: number; yResolution?: number } }>
    closePad(params: unknown): Promise<unknown>
    startSignature(params: unknown): Promise<unknown>
    confirmSignature(): Promise<{ countedPoints?: number }>
    cancelSignature(): Promise<unknown>
    retrySignature(): Promise<unknown>
    getSignatureImage(params: unknown): Promise<{ file?: string }>
    handleConfirmSignature: () => void
    handleRetrySignature: () => void
    handleCancelSignature: () => void
    handleError: (context: string, cod: number, descriere: string) => void
  }
}

interface FereastraCuBiblioteca {
  STPadServerLib?: {
    STPadServerLibCommons: BibliotecaPad['commons']
    STPadServerLibDefault: BibliotecaPad['default']
  }
}

// ---------------------------------------------------------------------------
// Încărcarea bibliotecii
// ---------------------------------------------------------------------------

let incarcarea: Promise<BibliotecaPad> | undefined

/**
 * Aduce biblioteca o singură dată, ca etichetă `<script>`.
 *
 * Nu prin `import`: fișierul este UMD și, când nu găsește nici `define`, nici
 * `module`, se agață de `window`. Adus ca script obișnuit face exact ce a fost
 * scris să facă, fără să depindă de felul în care împachetează Vite astăzi.
 * `?url` îl scoate și din pachetul principal — o sută de kiloocteți pe care nu
 * are rost să-i încarce cine nu semnează nimic.
 */
function incarcaBiblioteca(): Promise<BibliotecaPad> {
  if (incarcarea) return incarcarea

  incarcarea = new Promise<BibliotecaPad>((rezolva, respinge) => {
    const fereastra = window as unknown as FereastraCuBiblioteca
    const gata = () => {
      const lib = fereastra.STPadServerLib
      if (!lib) {
        respinge(new Error('Biblioteca tabletei s-a încărcat, dar nu s-a înregistrat.'))
        return
      }
      rezolva({ commons: lib.STPadServerLibCommons, default: lib.STPadServerLibDefault })
    }

    if (fereastra.STPadServerLib) {
      gata()
      return
    }

    const eticheta = document.createElement('script')
    eticheta.src = adresaBibliotecii
    eticheta.async = true
    eticheta.onload = gata
    eticheta.onerror = () => {
      // O încărcare eșuată nu se ține minte: dacă utilizatorul apasă din nou,
      // merită o încercare curată, nu aceeași respingere păstrată de la prima.
      incarcarea = undefined
      respinge(new Error('Biblioteca tabletei nu a putut fi încărcată.'))
    }
    document.head.appendChild(eticheta)
  })

  return incarcarea
}

// ---------------------------------------------------------------------------
// Adrese, termene, erori
// ---------------------------------------------------------------------------

/**
 * Adresele pe care le încearcă, în ordine.
 *
 * Instalarea serviciului pe Windows are patru variante, iar fiecare deschide
 * alte adrese. Nu se poate ști dinainte care a fost aleasă pe calculatorul
 * clinicii, așa că se încearcă toate — altfel o bifă pusă greșit acum un an la
 * instalare ar însemna un ecran care spune „tableta nu răspunde” fără leac.
 */
const ADRESE = [
  'wss://local.signotecwebsocket.de:49494',
  'wss://localhost:49494',
  'ws://127.0.0.1:49494',
] as const

/** Cât se așteaptă o legătură, per adresă. */
const TERMEN_LEGATURA = 4000
/** Cât se așteaptă un răspuns la o comandă. */
const TERMEN_COMANDA = 15_000

export class EroarePad extends Error {
  readonly cod: number | undefined

  constructor(mesaj: string, cod?: number) {
    super(mesaj)
    this.name = 'EroarePad'
    this.cod = cod
  }
}

/** Codurile pe care le poate vedea recepția, spuse pe înțeles. */
const MESAJE: Record<number, string> = {
  [-4]: 'Tableta este folosită de alt program. Închideți-l și încercați din nou.',
  [-5]: 'Legătura cu tableta s-a pierdut.',
  [-8]: 'Tableta nu mai este recunoscută. Verificați cablul USB.',
  [-20]: 'Comunicarea cu tableta a eșuat. Scoateți și reintroduceți cablul USB.',
  [-22]: 'Tableta a fost deconectată. Verificați cablul USB.',
  [-25]: 'Tableta nu știe această comandă.',
}

/** Traduce orice a aruncat biblioteca într-o eroare a aplicației. */
function eroareDin(cauza: unknown, implicit: string): EroarePad {
  if (cauza instanceof EroarePad) return cauza
  if (typeof cauza === 'string') return new EroarePad(`${implicit} (${cauza})`)

  const esec = cauza as EsecBiblioteca | null
  const cod = esec?.errorCode
  if (typeof cod === 'number') {
    return new EroarePad(MESAJE[cod] ?? `${implicit} (cod ${cod})`, cod)
  }
  if (cauza instanceof Error) return new EroarePad(cauza.message)
  return new EroarePad(implicit)
}

/**
 * Pune un termen peste o promisiune care nu are niciunul.
 *
 * Promisiunile bibliotecii așteaptă la nesfârșit un răspuns care poate să nu
 * mai vină. Fără învelișul acesta, un serviciu oprit între timp ar lăsa recepția
 * cu rotița învârtindu-se și clientul așteptând în picioare.
 */
async function cuTermen<T>(treaba: Promise<T>, termen: number, ce: string): Promise<T> {
  let ceas: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      treaba,
      new Promise<never>((_, respinge) => {
        ceas = setTimeout(() => respinge(new EroarePad(`${ce} — tableta nu a răspuns.`)), termen)
      }),
    ])
  } finally {
    if (ceas) clearTimeout(ceas)
  }
}

/** Numele comerciale, după numărul de model întors de `searchForPads`. */
const MODELE: Record<number, string> = {
  1: 'signotec Sigma',
  2: 'signotec Sigma',
  5: 'signotec Zeta',
  6: 'signotec Zeta',
  11: 'signotec Omega',
  12: 'signotec Omega',
  15: 'signotec Gamma',
  16: 'signotec Gamma',
  21: 'signotec Delta',
  22: 'signotec Delta',
  23: 'signotec Delta',
  31: 'signotec Alpha',
  32: 'signotec Alpha',
  33: 'signotec Alpha',
}

/** „signotec Sigma (S/N 1000444927, firmware 2.5)” — se scrie în acord. */
function numeleDispozitivului(pad: PadGasit): string {
  const model = MODELE[pad.type] ?? `signotec (model ${pad.type})`
  const detalii = [
    pad.serialNumber ? `S/N ${pad.serialNumber}` : null,
    pad.firmwareVersion ? `firmware ${pad.firmwareVersion}` : null,
  ].filter(Boolean)
  return detalii.length ? `${model} (${detalii.join(', ')})` : model
}

/** `atob` întoarce un șir de octeți; PNG-ul are nevoie de octeți adevărați. */
function dinBase64(text: string): Uint8Array {
  const binar = atob(text)
  const octeti = new Uint8Array(binar.length)
  for (let i = 0; i < binar.length; i++) octeti[i] = binar.charCodeAt(i)
  return octeti
}

// ---------------------------------------------------------------------------
// Sesiunea
// ---------------------------------------------------------------------------

/** Un punct din traseul creionului, în coordonatele senzorului. */
export interface PunctSemnatura {
  x: number
  y: number
  /** 0 = creionul tocmai s-a așezat (începe o linie nouă), 1 = continuă. */
  p: number
}

export interface Semnatura {
  png: Uint8Array
  /** Câte puncte a cules tableta; puține înseamnă o zgârietură, nu o semnătură. */
  puncte: number
}

export interface OptiuniSesiune {
  /** Scris în stânga sus pe ecranul tabletei — cine semnează. */
  numeCamp: string
  /** Scris în stânga jos — ce se semnează. */
  textAjutator?: string
  /** Fiecare punct, pe măsură ce e desenat: pentru oglinda de pe ecran. */
  laPunct?: (punct: PunctSemnatura) => void
  /**
   * Semnătura este gata. Se cheamă la fel, fie că a apăsat clientul „OK” pe
   * tabletă, fie recepția pe ecran: interfața are un singur drum de urmat.
   */
  laSemnatura: (semnatura: Semnatura) => void
  /** Clientul a apăsat „Anulează” pe tabletă. */
  laRenuntare?: () => void
  /** Clientul a apăsat „Șterge” pe tabletă — ecranul trebuie golit și el. */
  laStergere?: () => void
  /** Ceva s-a stricat în afara unei comenzi: cablu scos, serviciu oprit. */
  laEroare?: (eroare: EroarePad) => void
  /** Numai pentru probe: biblioteca prefăcută, în locul celei adevărate. */
  biblioteca?: BibliotecaPad
}

export interface SesiunePad {
  /** Cum se numește aparatul — se păstrează în acordul semnat. */
  dispozitiv: string
  /** Rezoluția senzorului, pentru desenarea oglinzii de pe ecran. */
  latimeSenzor: number
  inaltimeSenzor: number
  /** Șterge ce s-a desenat și lasă clientul să reia. */
  sterge(): Promise<void>
  /** Încheie semnătura; rezultatul ajunge la `laSemnatura`. */
  confirma(): Promise<void>
  /** Închide tot: tableta, apoi legătura. Se poate chema de oricâte ori. */
  inchide(): Promise<void>
}

/*
  Pornirile stau la rând, iar cea nouă o închide pe cea veche.

  Biblioteca ține UN SINGUR obiect WebSocket și aruncă la a doua
  `createConnection`. Asta s-ar întâmpla mai des decât pare: React rulează
  efectele de două ori în dezvoltare (`StrictMode`), iar a doua pornire ar
  începe înainte ca prima să fi apucat să se lege — deci înainte să existe ceva
  de închis. La fel și dacă recepția închide fereastra și o redeschide repede.

  Lanțul de mai jos face ca a doua pornire să aștepte sfârșitul primeia, să
  închidă ce a rămas deschis și abia apoi să înceapă. Costă o legătură făcută
  degeaba în dezvoltare; scapă de o eroare care altfel ar apărea numai pe
  calculatorul clinicii, unde nimeni nu o poate depana.
*/
let lant: Promise<void> = Promise.resolve()
let activa: SesiunePad | undefined

export function porneste(optiuni: OptiuniSesiune): Promise<SesiunePad> {
  const rezultat = lant.then(async () => {
    if (activa) {
      await activa.inchide().catch(() => undefined)
      activa = undefined
    }
    const sesiune = await porneșteAcum(optiuni)
    activa = sesiune
    return sesiune
  })

  // Lanțul merge mai departe și după un eșec: altfel o pornire căzută ar bloca
  // pentru totdeauna orice încercare următoare.
  lant = rezultat.then(
    () => undefined,
    () => undefined,
  )
  return rezultat
}

/**
 * Deschide tableta și pornește culegerea semnăturii.
 *
 * Întoarce abia când tableta așteaptă efectiv creionul, ca ecranul să nu spună
 * „semnați” înainte ca aparatul să fie pregătit.
 */
async function porneșteAcum(optiuni: OptiuniSesiune): Promise<SesiunePad> {
  const lib = optiuni.biblioteca ?? (await incarcaBiblioteca())
  const { commons, default: standard } = lib

  await conecteaza(commons)

  // De aici înainte orice eșec trebuie să lase legătura închisă: altfel a doua
  // încercare ar cădea pe „WebSocket object is already created”.
  let inchisa = false
  const inchideTot = async (index?: number) => {
    if (inchisa) return
    inchisa = true
    activa = undefined
    commons.handleNextSignaturePoint = () => undefined
    commons.handleDisconnect = () => undefined
    standard.handleConfirmSignature = () => undefined
    standard.handleRetrySignature = () => undefined
    standard.handleCancelSignature = () => undefined
    standard.handleError = () => undefined
    try {
      if (index !== undefined) {
        await cuTermen(standard.closePad(new standard.Params.closePad(index)), 3000, 'Închiderea')
      }
    } catch {
      // Tableta poate fi deja scoasă din priză. Legătura tot trebuie desfăcută.
    } finally {
      commons.destroyConnection()
    }
  }

  let index: number | undefined
  try {
    const cautare = new standard.Params.searchForPads()
    cautare.setPadSubset('HID')
    const gasite = await cuTermen(standard.searchForPads(cautare), TERMEN_COMANDA, 'Căutarea')
    const pad = gasite.foundPads?.[0]
    if (!pad) {
      throw new EroarePad('Nu s-a găsit nicio tabletă de semnat. Verificați cablul USB.')
    }
    index = pad.index

    const deschisa = await cuTermen(
      standard.openPad(new standard.Params.openPad(pad.index)),
      TERMEN_COMANDA,
      'Deschiderea tabletei',
    )

    const sesiune = pregateste({
      lib,
      pad,
      // Documentația dă cheile direct pe obiect; biblioteca le pune sub
      // `padInfo`. Valorile de rezervă țin oglinda de pe ecran în picioare
      // chiar dacă o versiune viitoare le mută înapoi.
      latimeSenzor: deschisa.padInfo?.xResolution ?? 0,
      inaltimeSenzor: deschisa.padInfo?.yResolution ?? 0,
      optiuni,
      inchideTot: () => inchideTot(index),
    })

    const start = new standard.Params.startSignature()
    start.setFieldName(optiuni.numeCamp)
    if (optiuni.textAjutator) start.setCustomText(optiuni.textAjutator)
    await cuTermen(standard.startSignature(start), TERMEN_COMANDA, 'Pornirea semnăturii')

    return sesiune
  } catch (cauza) {
    await inchideTot(index)
    throw eroareDin(cauza, 'Tableta de semnat nu a putut fi pornită.')
  }
}

/**
 * Încearcă adresele pe rând, până răspunde una.
 *
 * Fiecare încercare eșuată își desface legătura înainte de următoarea:
 * biblioteca ține un singur obiect WebSocket și refuză al doilea.
 */
async function conecteaza(commons: BibliotecaPad['commons']): Promise<void> {
  let ultima: EroarePad | undefined

  for (const adresa of ADRESE) {
    try {
      await new Promise<void>((rezolva, respinge) => {
        const ceas = setTimeout(() => respinge(new EroarePad('Serviciul nu a răspuns.')), TERMEN_LEGATURA)
        let terminat = false
        const odata = (fapta: () => void) => {
          if (terminat) return
          terminat = true
          clearTimeout(ceas)
          fapta()
        }
        // Toate trei sunt obligatorii: biblioteca le cheamă fără să verifice.
        commons.createConnection(
          adresa,
          () => odata(rezolva),
          () => undefined,
          () => odata(() => respinge(new EroarePad('Serviciul nu a răspuns.'))),
        )
      })
      return
    } catch (cauza) {
      ultima = eroareDin(cauza, 'Legătura cu serviciul tabletei a eșuat.')
      commons.destroyConnection()
    }
  }

  throw new EroarePad(
    'Serviciul tabletei de semnat nu răspunde. Verificați că programul ' +
      'signoPAD-API/Web este pornit pe acest calculator.' +
      (ultima ? ` (${ultima.message})` : ''),
  )
}

/** Leagă evenimentele tabletei de funcțiile primite și întoarce sesiunea. */
function pregateste({
  lib,
  pad,
  latimeSenzor,
  inaltimeSenzor,
  optiuni,
  inchideTot,
}: {
  lib: BibliotecaPad
  pad: PadGasit
  latimeSenzor: number
  inaltimeSenzor: number
  optiuni: OptiuniSesiune
  inchideTot: () => Promise<void>
}): SesiunePad {
  const { commons, default: standard } = lib

  /*
    Semnătura se încheie o singură dată.

    Clientul poate apăsa „OK” pe tabletă exact în clipa în care recepția apasă
    pe ecran. Fără zăvorul acesta s-ar chema `confirmSignature()` de două ori,
    iar a doua oară tableta răspunde cu eroare — după ce prima reușise. Ar arăta
    ca un eșec deși semnătura era deja culeasă.

    Al doilea apel nu pleacă însă cu mâna goală: primește ACEEAȘI promisiune ca
    primul. Cine așteaptă `confirma()` așteaptă până se termină cu adevărat,
    indiferent care mână a apăsat prima.
  */
  let gata = false
  let inCurs: Promise<void> | undefined

  const finalizeaza = (): Promise<void> => {
    if (gata) return Promise.resolve()
    if (inCurs) return inCurs

    inCurs = (async () => {
      try {
        const confirmata = await cuTermen(
          standard.confirmSignature(),
          TERMEN_COMANDA,
          'Confirmarea',
        )

        const imagine = new standard.Params.getSignatureImage()
        imagine.setFileType(standard.FileType.PNG)
        // 5 este lățimea din exemplul producătorului: destul de groasă cât să
        // rămână citibilă după ce imaginea se micșorează în documentul tipărit.
        imagine.setPenWidth(5)
        const rezultat = await cuTermen(
          standard.getSignatureImage(imagine),
          TERMEN_COMANDA,
          'Preluarea semnăturii',
        )

        if (!rezultat.file) throw new EroarePad('Tableta nu a trimis imaginea semnăturii.')

        // Abia acum este cu adevărat încheiată: tableta și-a șters ecranul, iar
        // o a doua confirmare nu ar mai avea ce culege.
        gata = true
        optiuni.laSemnatura({
          png: dinBase64(rezultat.file),
          puncte: confirmata.countedPoints ?? 0,
        })
      } catch (cauza) {
        // `gata` rămâne fals: o confirmare eșuată trebuie să poată fi
        // reîncercată, altfel semnătura desenată pe tabletă rămâne acolo și
        // nimeni nu o mai poate lua.
        optiuni.laEroare?.(eroareDin(cauza, 'Semnătura nu a putut fi preluată.'))
      } finally {
        inCurs = undefined
      }
    })()

    return inCurs
  }

  commons.handleNextSignaturePoint = (x, y, p) => optiuni.laPunct?.({ x, y, p })

  commons.handleDisconnect = () => {
    optiuni.laEroare?.(new EroarePad('Tableta a fost deconectată. Verificați cablul USB.'))
  }

  standard.handleError = (_context, cod, descriere) => {
    optiuni.laEroare?.(new EroarePad(MESAJE[cod] ?? descriere, cod))
  }

  // Butoanele desenate pe tableta însăși.
  standard.handleConfirmSignature = () => void finalizeaza()

  standard.handleRetrySignature = () => {
    void standard
      .retrySignature()
      .then(() => optiuni.laStergere?.())
      .catch((cauza: unknown) =>
        optiuni.laEroare?.(eroareDin(cauza, 'Semnătura nu a putut fi ștearsă.')),
      )
  }

  standard.handleCancelSignature = () => {
    void standard
      .cancelSignature()
      .catch(() => undefined)
      .then(() => optiuni.laRenuntare?.())
  }

  return {
    dispozitiv: numeleDispozitivului(pad),
    latimeSenzor,
    inaltimeSenzor,
    sterge: async () => {
      try {
        await cuTermen(standard.retrySignature(), TERMEN_COMANDA, 'Ștergerea')
        optiuni.laStergere?.()
      } catch (cauza) {
        throw eroareDin(cauza, 'Semnătura nu a putut fi ștearsă.')
      }
    },
    confirma: finalizeaza,
    inchide: inchideTot,
  }
}
