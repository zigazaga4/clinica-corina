import { useMemo } from 'react'
import {
  Banknote,
  CalendarCheck,
  Clock3,
  CreditCard,
  Receipt,
  TrendingDown,
  TrendingUp,
  UserX,
  Users,
  Wallet,
} from 'lucide-react'
import type { FiltruStatistici } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useRaportStatistici } from '@/app/queries'
import type { RaportStatistici, TotaluriStatistici } from '@/domain/types'
import { formateazaBani, formateazaCantitate, rotunjeste } from '@/lib/money'
import { plural } from '@/lib/text'
import {
  CardGrafic,
  GraficBare,
  GraficColoane,
  Spinner,
  StareEroare,
  Statistica,
  type PunctGrafic,
  type RandBare,
  type SerieGrafic,
} from '@/ui'
import { eticheteBara, numeZiSaptamana, type PerioadaCalculata } from './perioade'
import { Variatie } from './Variatie'

/**
 * Fila „Rezumat”: cifrele perioadei, cu variația față de cea comparată, și
 * graficele care le desfac — în timp, pe servicii, produse, persoane,
 * categorii de cheltuieli, zile ale săptămânii și clienți.
 */

const INCASAT: SerieGrafic = { cheie: 'incasat', eticheta: 'Încasat', culoare: 'var(--color-grafic-1)' }
const CHELTUIT: SerieGrafic = { cheie: 'cheltuieli', eticheta: 'Cheltuieli', culoare: 'var(--color-grafic-2)' }
const PROGRAMARI: SerieGrafic = {
  cheie: 'programari',
  eticheta: 'Programări onorate',
  culoare: 'var(--color-grafic-1)',
}

const numar = (n: number) => formateazaCantitate(n)

/** Fusul calculatorului — zilele se numără ca în calendarul de pe perete. */
const FUS = Intl.DateTimeFormat().resolvedOptions().timeZone

export function RezumatStatistici({ calculata }: { calculata: PerioadaCalculata }) {
  const filtru = useMemo<FiltruStatistici>(
    () => ({
      de_la: calculata.perioada.de_la,
      pana_la: calculata.perioada.pana_la,
      pas: calculata.pas,
      fus: FUS,
      comparatie_de_la: calculata.comparatie.de_la,
      comparatie_pana_la: calculata.comparatie.pana_la,
    }),
    [calculata],
  )
  const raport = useRaportStatistici(filtru)

  if (raport.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Spinner eticheta="Se calculează statisticile…" />
      </div>
    )
  }
  if (raport.isError) {
    return <StareEroare mesaj={mesajEroare(raport.error)} onReincearca={() => void raport.refetch()} />
  }

  return <Raport raport={raport.data} incarca={raport.isPlaceholderData} />
}

function Raport({ raport, incarca }: { raport: RaportStatistici; incarca: boolean }) {
  const t = raport.total
  const c = raport.comparatie

  return (
    <div className={incarca ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <Cifre t={t} c={c} />

      <div className="mt-4 space-y-4">
        <GraficTimp raport={raport} />

        <div className="grid gap-4 lg:grid-cols-2">
          <CardBare
            titlu="Servicii"
            descriere="Ce servicii au adus banii, după încasări."
            randuri={raport.servicii.map((s) => ({
              cheie: s.articol_id,
              eticheta: s.denumire,
              valoare: s.suma,
              detaliu: `${numar(s.cantitate)} ${plural(s.cantitate, 'ședință încasată', 'ședințe încasate')}`,
            }))}
            antete={['Serviciu', 'Ședințe', 'Încasat']}
            cantitati={raport.servicii.map((s) => numar(s.cantitate))}
            gol="Nicio ședință încasată în perioada aleasă."
          />
          <CardBare
            titlu="Produse"
            descriere="Produsele vândute și încasate."
            randuri={raport.produse.map((p) => ({
              cheie: p.articol_id,
              // Aceeași cremă se vinde din două liste de prețuri — două rânduri
              // cu același nume, deosebite doar de categorie.
              eticheta: p.categorie ? `${p.denumire} · ${p.categorie}` : p.denumire,
              valoare: p.suma,
              detaliu: `${numar(p.cantitate)} buc.`,
            }))}
            antete={['Produs', 'Bucăți', 'Încasat']}
            cantitati={raport.produse.map((p) => numar(p.cantitate))}
            gol="Niciun produs încasat în perioada aleasă."
          />
          <CardBare
            titlu="Pe persoane"
            descriere="Încasat din serviciile fiecăreia și programările onorate."
            randuri={raport.persoane.map((p) => ({
              cheie: p.utilizator_id,
              eticheta: p.nume,
              valoare: p.incasat,
              detaliu: `${p.programari_onorate} ${plural(p.programari_onorate, 'programare onorată', 'programări onorate')}`,
            }))}
            antete={['Persoana', 'Programări onorate', 'Încasat']}
            cantitati={raport.persoane.map((p) => String(p.programari_onorate))}
            gol="Nicio programare onorată și nicio încasare din servicii în perioada aleasă."
          />
          <CardBare
            titlu="Cheltuieli pe categorii"
            descriere="Unde s-au dus banii."
            culoare={CHELTUIT.culoare}
            randuri={raport.cheltuieli.map((ch) => ({
              cheie: ch.categorie,
              eticheta: ch.categorie,
              valoare: ch.suma,
              detaliu: `${ch.numar} ${plural(ch.numar, 'cheltuială', 'cheltuieli')}`,
            }))}
            antete={['Categoria', 'Cheltuieli', 'Suma']}
            cantitati={raport.cheltuieli.map((ch) => String(ch.numar))}
            gol="Nicio cheltuială în perioada aleasă. Se adaugă din fila „Cheltuieli”."
          />
          <GraficZile raport={raport} />
          <CardBare
            titlu="Clienți"
            descriere="Cei zece clienți care au adus cei mai mulți bani."
            randuri={raport.clienti.map((cl) => ({
              cheie: cl.client_id,
              eticheta: cl.nume,
              valoare: cl.incasat,
              detaliu: `${cl.incasari} ${plural(cl.incasari, 'încasare', 'încasări')}`,
            }))}
            antete={['Client', 'Încasări', 'Încasat']}
            cantitati={raport.clienti.map((cl) => String(cl.incasari))}
            gol="Nicio încasare în perioada aleasă."
            maxim={10}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cifrele de sus
// ---------------------------------------------------------------------------

function Cifre({ t, c }: { t: TotaluriStatistici; c: TotaluriStatistici | null }) {
  const variatie = (curent: number, anterior: number | undefined, maiMultEBine = true, bani = true) =>
    c && anterior !== undefined ? (
      <Variatie
        curent={curent}
        anterior={anterior}
        maiMultEBine={maiMultEBine}
        formateaza={bani ? formateazaBani : numar}
      />
    ) : undefined

  const medie = t.incasari > 0 ? rotunjeste(t.incasat / t.incasari) : 0
  const trecute = t.programari_onorate + t.programari_neprezentate
  const pierdere = t.profit < 0

  return (
    <>
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Statistica
        eticheta="Încasat"
        valoare={formateazaBani(t.incasat)}
        pictograma={<Wallet className="size-4" />}
        detaliu={variatie(t.incasat, c?.incasat)}
      />
      {/* Din încasat, după cum s-a plătit (cerința clinicii, 2026-10-01). */}
      <Statistica
        eticheta="Numerar"
        valoare={formateazaBani(t.incasat_numerar)}
        pictograma={<Banknote className="size-4" />}
        detaliu={variatie(t.incasat_numerar, c?.incasat_numerar) ?? 'în casă'}
      />
      <Statistica
        eticheta="Card"
        valoare={formateazaBani(t.incasat_card)}
        pictograma={<CreditCard className="size-4" />}
        detaliu={variatie(t.incasat_card, c?.incasat_card) ?? 'prin bancă'}
      />
      <Statistica
        eticheta="Cheltuieli"
        valoare={formateazaBani(t.cheltuieli)}
        pictograma={<Receipt className="size-4" />}
        detaliu={variatie(t.cheltuieli, c?.cheltuieli, false)}
      />
      <Statistica
        eticheta={pierdere ? 'Pierdere' : 'Profit'}
        valoare={
          <span className={pierdere ? 'text-danger' : undefined}>{formateazaBani(t.profit)}</span>
        }
        pictograma={pierdere ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
        detaliu={variatie(t.profit, c?.profit) ?? 'încasat minus cheltuieli'}
      />
      <Statistica
        eticheta="Rămas de încasat"
        valoare={formateazaBani(t.neachitat)}
        pictograma={<Clock3 className="size-4" />}
        detaliu="din ce s-a lucrat în perioadă"
      />
      <Statistica
        eticheta="Programări onorate"
        valoare={numar(t.programari_onorate)}
        pictograma={<CalendarCheck className="size-4" />}
        detaliu={variatie(t.programari_onorate, c?.programari_onorate, true, false)}
      />
      <Statistica
        eticheta="Clienți serviți"
        valoare={numar(t.clienti)}
        pictograma={<Users className="size-4" />}
        detaliu={`${t.clienti_noi} ${plural(t.clienti_noi, 'fișă nouă', 'fișe noi')}`}
      />
      <Statistica
        eticheta="Încasare medie"
        valoare={formateazaBani(medie)}
        pictograma={<Receipt className="size-4" />}
        detaliu={`din ${t.incasari} ${plural(t.incasari, 'încasare', 'încasări')}`}
      />
      <Statistica
        eticheta="Neprezentări"
        valoare={numar(t.programari_neprezentate)}
        pictograma={<UserX className="size-4" />}
        detaliu={
          trecute > 0
            ? `${Math.round((t.programari_neprezentate / trecute) * 100)}% din programările trecute`
            : 'nicio programare trecută'
        }
      />
    </div>
    {/* Încasările de dinainte de alegere nu au metodă; se aleg din fila „Încasări”. */}
    {t.incasat_nespecificat > 0 && (
      <p className="mt-2 text-[13px] text-ink-faint">
        {formateazaBani(t.incasat_nespecificat)} încasați fără numerar / card ales. Se pot alege din
        fila „Încasări”.
      </p>
    )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Graficul în timp
// ---------------------------------------------------------------------------

function GraficTimp({ raport }: { raport: RaportStatistici }) {
  const perioada = { de_la: raport.de_la, pana_la: raport.pana_la }
  const unitate = { zi: 'zile', saptamana: 'săptămâni', luna: 'luni' }[raport.pas]

  const puncte: PunctGrafic[] = raport.perioade.map((p) => {
    const incasat = rotunjeste(p.incasat_servicii + p.incasat_produse)
    return {
      cheie: p.inceput,
      ...eticheteBara(p.inceput, raport.pas, perioada),
      valori: { incasat, cheltuieli: p.cheltuieli },
      extra: [
        { eticheta: 'din servicii', valoare: formateazaBani(p.incasat_servicii) },
        { eticheta: 'din produse', valoare: formateazaBani(p.incasat_produse) },
        { eticheta: 'profit', valoare: formateazaBani(incasat - p.cheltuieli) },
      ],
    }
  })

  const gol = raport.total.incasat === 0 && raport.total.cheltuieli === 0

  return (
    <CardGrafic
      titlu="Încasări și cheltuieli"
      descriere={`Pe ${unitate}. Din încasări: servicii ${formateazaBani(raport.total.incasat_servicii)}, produse ${formateazaBani(raport.total.incasat_produse)}.`}
      gol={gol ? <Gol text="Nicio încasare și nicio cheltuială în perioada aleasă." /> : undefined}
      tabel={{
        antete: ['Perioada', 'Încasat', 'Din servicii', 'Din produse', 'Cheltuieli', 'Profit'],
        laDreapta: [1, 2, 3, 4, 5],
        randuri: puncte.map((p, i) => {
          const r = raport.perioade[i]!
          const incasat = p.valori['incasat'] ?? 0
          return {
            cheie: p.cheie,
            celule: [
              p.titlu,
              formateazaBani(incasat),
              formateazaBani(r.incasat_servicii),
              formateazaBani(r.incasat_produse),
              formateazaBani(r.cheltuieli),
              formateazaBani(incasat - r.cheltuieli),
            ],
          }
        }),
      }}
    >
      <GraficColoane
        serii={[INCASAT, CHELTUIT]}
        puncte={puncte}
        formateaza={formateazaBani}
        descriere={`Încasări și cheltuieli pe ${unitate}. Folosește săgețile pentru a trece de la o perioadă la alta.`}
        inaltime={220}
      />
    </CardGrafic>
  )
}

function GraficZile({ raport }: { raport: RaportStatistici }) {
  const puncte: PunctGrafic[] = raport.zile_saptamana.map((z) => ({
    cheie: String(z.zi),
    eticheta: numeZiSaptamana(z.zi),
    titlu: numeZiSaptamana(z.zi, true),
    valori: { programari: z.programari },
  }))
  const gol = raport.zile_saptamana.every((z) => z.programari === 0)

  return (
    <CardGrafic
      titlu="Zilele săptămânii"
      descriere="Programările onorate, pe zile — unde e aglomerat și unde e loc."
      gol={gol ? <Gol text="Nicio programare onorată în perioada aleasă." /> : undefined}
      tabel={{
        antete: ['Ziua', 'Programări onorate'],
        laDreapta: [1],
        randuri: puncte.map((p) => ({ cheie: p.cheie, celule: [p.titlu, numar(p.valori['programari'] ?? 0)] })),
      }}
    >
      <GraficColoane
        serii={[PROGRAMARI]}
        puncte={puncte}
        formateaza={numar}
        descriere="Programările onorate pe zilele săptămânii."
        inaltime={160}
      />
    </CardGrafic>
  )
}

// ---------------------------------------------------------------------------
// Barele orizontale, în cardul lor
// ---------------------------------------------------------------------------

function CardBare({
  titlu,
  descriere,
  randuri,
  antete,
  cantitati,
  gol,
  culoare,
  maxim = 7,
}: {
  titlu: string
  descriere: string
  randuri: RandBare[]
  /** [nume, cantitate, sumă] — capul tabelului geamăn. */
  antete: [string, string, string]
  /** A doua coloană a tabelului, rând cu rând. */
  cantitati: string[]
  gol: string
  culoare?: string
  maxim?: number
}) {
  return (
    <CardGrafic
      titlu={titlu}
      descriere={descriere}
      gol={randuri.length === 0 ? <Gol text={gol} /> : undefined}
      tabel={{
        antete,
        laDreapta: [1, 2],
        randuri: randuri.map((r, i) => ({
          cheie: r.cheie,
          celule: [r.eticheta, cantitati[i] ?? '', formateazaBani(r.valoare)],
        })),
      }}
    >
      <GraficBare
        randuri={randuri}
        formateaza={formateazaBani}
        culoare={culoare}
        maxim={maxim}
        detaliuAltele={(n) => `încă ${n}`}
      />
    </CardGrafic>
  )
}

function Gol({ text }: { text: string }) {
  return <p className="py-6 text-center text-[13px] text-ink-faint">{text}</p>
}
