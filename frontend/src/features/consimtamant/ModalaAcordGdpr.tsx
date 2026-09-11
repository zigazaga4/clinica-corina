import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, TriangleAlert } from 'lucide-react'
import { useSemneazaAcord } from '@/app/queries'
import type { Client, Uuid } from '@/domain/types'
import { mesajEroare } from '@/api/errors'
import { Buton, Modala, Spinner } from '@/ui'
import { construiesteAcord, VERSIUNE_ACORD, ziRomaneasca } from './document'
import { DocumentAcord } from './DocumentAcord'
import { incarcaFonturi } from './fonturi'
import { EroarePad, porneste, type PunctSemnatura, type SesiunePad } from './pad'

/**
 * Semnarea acordului GDPR, la venirea clientului.
 *
 * Pe ecran stă textul întreg, ca să poată fi citit sau întors spre client;
 * semnătura se culege NUMAI de pe tabletă. Nu există variantă cu degetul pe
 * ecran, dinadins: o semnătură dată cu mouse-ul nu seamănă cu cea din buletin
 * și nu ar ține nicăieri, iar o cale mai comodă ar fi devenit repede singura
 * folosită.
 *
 * La confirmare se tipărește un PDF și se trimite la server. Din acel moment
 * documentul este înghețat: ce s-a semnat rămâne exact așa, chiar dacă fișa
 * clientului sau textul acordului se schimbă mâine.
 */

/** Sub atâtea puncte nu este o semnătură, ci o atingere din greșeală. */
const PUNCTE_MINIME = 12

type Stare =
  | { faza: 'pregatire' }
  | { faza: 'semnare' }
  | { faza: 'tiparire' }
  | { faza: 'esec'; mesaj: string }

/** Octeți → base64, pe bucăți: un PDF întreg dat lui `btoa` umple stiva. */
function inBase64(octeti: Uint8Array): string {
  const BUCATA = 0x8000
  let binar = ''
  for (let i = 0; i < octeti.length; i += BUCATA) {
    binar += String.fromCharCode(...octeti.subarray(i, i + BUCATA))
  }
  return btoa(binar)
}

export function ModalaAcordGdpr({
  deschisa,
  onInchide,
  client,
  programareId,
  onSemnat,
  onSare,
}: {
  deschisa: boolean
  onInchide: () => void
  client: Pick<Client, 'id' | 'nume' | 'telefon' | 'email' | 'adresa'>
  /** Ședința la care se semnează; lipsește dacă se semnează în afara uneia. */
  programareId?: Uuid | null
  /** Acordul a fost semnat și păstrat. */
  onSemnat: () => void
  /**
   * Recepția merge mai departe fără acord.
   *
   * Există numai pentru cazul în care tableta chiar nu poate fi folosită —
   * cablu stricat, serviciu neinstalat. Fără el, o tabletă defectă ar opri
   * clinica din lucru, ceea ce ar fi mai rău decât un acord luat a doua zi.
   */
  onSare?: () => void
}) {
  const [stare, setStare] = useState<Stare>({ faza: 'pregatire' })
  const [dispozitiv, setDispozitiv] = useState<string | null>(null)
  const [areSemnatura, setAreSemnatura] = useState(false)
  const [incercarea, setIncercarea] = useState(0)

  const semneaza = useSemneazaAcord()
  const panza = useRef<HTMLCanvasElement>(null)
  const sesiune = useRef<SesiunePad | null>(null)
  const senzor = useRef({ latime: 0, inaltime: 0 })
  const anterior = useRef<PunctSemnatura | null>(null)

  const blocuri = construiesteAcord({ nume: client.nume, data: ziRomaneasca(new Date()) })

  // ---------------------------------------------------------------------
  // Oglinda de pe ecran
  // ---------------------------------------------------------------------

  const stergePanza = useCallback(() => {
    anterior.current = null
    const context = panza.current?.getContext('2d')
    if (context && panza.current) {
      context.clearRect(0, 0, panza.current.width, panza.current.height)
    }
    setAreSemnatura(false)
  }, [])

  /**
   * Desenează punctele venite de la tabletă, pe măsură ce sosesc.
   *
   * Nu este o podoabă: recepția stă de partea cealaltă a mesei și nu vede
   * ecranul tabletei. Fără oglinda asta nu ar avea de unde ști dacă creionul
   * scrie sau dacă aparatul a încetat să răspundă.
   */
  const deseneaza = useCallback((punct: PunctSemnatura) => {
    const canvas = panza.current
    const context = canvas?.getContext('2d')
    const { latime, inaltime } = senzor.current
    if (!canvas || !context || latime <= 0 || inaltime <= 0) return

    const la = (p: PunctSemnatura) => ({
      x: (p.x / latime) * canvas.width,
      y: (p.y / inaltime) * canvas.height,
    })

    // `p === 0` înseamnă creionul tocmai așezat: începe o linie nouă, nu se
    // trage o dreaptă din locul unde s-a ridicat data trecută.
    const precedent = punct.p === 0 ? null : anterior.current
    const acum = la(punct)

    context.strokeStyle = '#111827'
    context.lineWidth = Math.max(1.5, canvas.width / 260)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    if (precedent) {
      const de = la(precedent)
      context.moveTo(de.x, de.y)
    } else {
      context.moveTo(acum.x, acum.y)
    }
    context.lineTo(acum.x, acum.y)
    context.stroke()

    anterior.current = punct
  }, [])

  // ---------------------------------------------------------------------
  // Tipărirea și păstrarea
  // ---------------------------------------------------------------------

  /*
    Ce trebuie la tipărire se ține în referințe, nu se citește din închidere.

    Funcțiile date tabletei se leagă o singură dată, la pornire, și trăiesc cât
    ține sesiunea. Dacă ar citi direct `client` sau `blocuri`, ar rămâne cu
    valorile din clipa legării — iar o redesenare între timp le-ar face să
    tipărească datele vechi pe documentul semnat acum.
  */
  const datele = useRef({ client, programareId, blocuri })
  datele.current = { client, programareId, blocuri }

  const pastreaza = useCallback(
    async (png: Uint8Array) => {
      setStare({ faza: 'tiparire' })
      const { client: c, programareId: pid, blocuri: b } = datele.current
      try {
        /*
          `pdf-lib` + `fontkit` se aduc abia acum, nu la deschiderea
          calendarului: împreună fac peste un megaoctet, iar importate de sus
          intrau în pachetul ecranului de programări, pe care îl deschide
          toată lumea, toată ziua. Aici întârzierea nu se simte — oricum se
          așteaptă tableta și fonturile.
        */
        const [{ genereazaPdf }, fonturi] = await Promise.all([
          import('./pdf'),
          incarcaFonturi(),
        ])
        const pdf = await genereazaPdf({
          blocuri: b,
          semnaturaPng: png,
          fonturi,
          versiune: VERSIUNE_ACORD,
        })

        await semneaza.mutateAsync({
          client_id: c.id,
          programare_id: pid ?? null,
          versiune: VERSIUNE_ACORD,
          document: inBase64(pdf),
          date_semnatar: {
            nume: c.nume,
            telefon: c.telefon,
            email: c.email,
            adresa: c.adresa,
          },
          dispozitiv: sesiune.current?.dispozitiv ?? null,
        })

        await sesiune.current?.inchide()
        sesiune.current = null
        onSemnat()
      } catch (err) {
        setStare({ faza: 'esec', mesaj: mesajEroare(err) })
      }
    },
    [onSemnat, semneaza],
  )

  const pastreazaRef = useRef(pastreaza)
  pastreazaRef.current = pastreaza

  // ---------------------------------------------------------------------
  // Viața sesiunii
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!deschisa) return

    let anulat = false
    setStare({ faza: 'pregatire' })
    setDispozitiv(null)
    stergePanza()

    const pornirea = porneste({
      numeCamp: client.nume,
      textAjutator: 'Acord privind prelucrarea datelor cu caracter personal',
      laPunct: (punct) => {
        if (anulat) return
        /*
          „Există semnătură” se ține de sosirea punctelor, nu de desenarea lor.

          Oglinda de pe ecran e o comoditate: dacă `<canvas>` nu poate desena,
          creionul tot a scris pe tabletă. Legate la un loc, un ecran fără
          desenare ar fi lăsat butonul „Confirmă” stins pentru totdeauna, cu o
          semnătură perfect validă pe aparat.
        */
        setAreSemnatura(true)
        deseneaza(punct)
      },
      laSemnatura: ({ png, puncte }) => {
        if (anulat) return
        if (puncte < PUNCTE_MINIME) {
          setStare({
            faza: 'esec',
            mesaj: 'Semnătura este prea scurtă. Ștergeți și semnați din nou.',
          })
          return
        }
        void pastreazaRef.current(png)
      },
      laStergere: () => {
        if (!anulat) stergePanza()
      },
      laRenuntare: () => {
        if (!anulat) onInchide()
      },
      laEroare: (eroare) => {
        if (!anulat) setStare({ faza: 'esec', mesaj: eroare.message })
      },
    })

    void pornirea
      .then((s) => {
        if (anulat) return
        sesiune.current = s
        senzor.current = { latime: s.latimeSenzor, inaltime: s.inaltimeSenzor }
        setDispozitiv(s.dispozitiv)
        setStare({ faza: 'semnare' })
      })
      .catch((err: unknown) => {
        if (anulat) return
        setStare({
          faza: 'esec',
          mesaj: err instanceof EroarePad ? err.message : mesajEroare(err),
        })
      })

    return () => {
      anulat = true
      sesiune.current = null
      // Se așteaptă pornirea înainte de închidere: dacă s-a renunțat cât timp
      // tableta încă se deschidea, sesiunea apare abia acum și tot trebuie
      // închisă, altfel rămâne o legătură agățată.
      void pornirea.then((s) => s.inchide()).catch(() => undefined)
    }
    // `client.nume` apare pe ecranul tabletei; se repornește dacă se schimbă.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deschisa, client.nume, incercarea])

  // ---------------------------------------------------------------------

  const lucreaza = stare.faza === 'pregatire' || stare.faza === 'tiparire'

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      dimensiune="xl"
      blocata={stare.faza === 'tiparire'}
      titlu="Acord privind prelucrarea datelor"
      descriere={client.nume}
      subsol={
        <>
          <Buton onClick={onInchide} disabled={stare.faza === 'tiparire'} plin className="sm:w-auto">
            Renunță
          </Buton>

          {stare.faza === 'esec' ? (
            <>
              {onSare && (
                <Buton onClick={onSare} plin className="sm:w-auto">
                  Continuă fără acord
                </Buton>
              )}
              <Buton
                varianta="primar"
                onClick={() => setIncercarea((n) => n + 1)}
                plin
                className="sm:w-auto"
              >
                Încearcă din nou
              </Buton>
            </>
          ) : (
            <>
              <Buton
                onClick={() => void sesiune.current?.sterge().catch(() => undefined)}
                disabled={stare.faza !== 'semnare' || !areSemnatura}
                plin
                className="sm:w-auto"
              >
                <Eraser className="size-4" />
                Șterge
              </Buton>
              <Buton
                varianta="primar"
                onClick={() => void sesiune.current?.confirma()}
                disabled={stare.faza !== 'semnare' || !areSemnatura}
                incarca={stare.faza === 'tiparire'}
                plin
                className="sm:w-auto"
              >
                <PenLine className="size-4" />
                Confirmă semnătura
              </Buton>
            </>
          )}
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="max-h-[46dvh] overflow-y-auto rounded-xl border border-line bg-surface p-4 lg:max-h-[60dvh]">
          <DocumentAcord blocuri={blocuri} />
        </div>

        <div className="flex flex-col gap-3">
          {stare.faza === 'esec' ? (
            <div
              role="alert"
              className="flex gap-2.5 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-snug text-danger"
            >
              <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
              <p>{stare.mesaj}</p>
            </div>
          ) : (
            <div
              role="status"
              className="flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-ink-soft"
            >
              {lucreaza && <Spinner dimensiune="sm" />}
              <p>
                {stare.faza === 'pregatire'
                  ? 'Se caută tableta de semnat…'
                  : stare.faza === 'tiparire'
                    ? 'Se întocmește documentul. Nu închideți fereastra.'
                    : areSemnatura
                      ? 'Semnătura se vede mai jos. Apăsați „Confirmă semnătura”.'
                      : 'Rugați clientul să semneze pe tabletă.'}
              </p>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
              Semnătura
            </p>
            {/* Lățimea de desenare e fixă, nu cea afișată: o pânză întinsă prin
                CSS ar fi desenat linii încețoșate. */}
            <canvas
              ref={panza}
              width={640}
              height={280}
              aria-label="Semnătura culeasă de pe tabletă"
              className="aspect-[16/7] w-full rounded-xl border border-dashed border-line-strong bg-surface"
            />
          </div>

          <p className="text-[12px] leading-relaxed text-ink-faint">
            {dispozitiv ?? 'Semnătura se culege numai de pe tabletă.'}
          </p>
        </div>
      </div>
    </Modala>
  )
}
