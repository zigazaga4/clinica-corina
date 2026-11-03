import { useMemo } from 'react'
import { Banknote, CalendarCheck, Clock3, Receipt, UserX, Users } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { mesajEroare } from '@/api/errors'
import { useRaportPersoana } from '@/app/queries'
import type { RaportPersoana, TotaluriPersoana, Uuid } from '@/domain/types'
import { formateazaBani, formateazaCantitate, rotunjeste } from '@/lib/money'
import { plural } from '@/lib/text'
import {
  CardGrafic,
  GraficColoane,
  Spinner,
  StareEroare,
  Statistica,
  type PunctGrafic,
  type SerieGrafic,
} from '@/ui'
import { eticheteBara, filtruStatistici, type PerioadaCalculata } from './perioade'
import { CardBare, Gol } from './RezumatStatistici'
import { Variatie } from './Variatie'

/**
 * Cifrele unei singure persoane pe o perioadă — fila din „Statisticile mele” și
 * vederea „pe persoană” a proprietarului (cerința clinicii, 3 nov. 2026: „o
 * statistică și pentru Anda, în care să-i apară doar încasările ei și ce face
 * ea în fiecare lună”).
 *
 * Doar ce ține de ședințele FĂCUTE de ea: banii din ele, ședințele, clienții.
 * Nu are cheltuieli, profit sau produse — acelea sunt ale clinicii. Aceeași
 * piesă servește ambele ecrane; o deosebește doar de unde vine raportul.
 */

const INCASAT: SerieGrafic = { cheie: 'incasat', eticheta: 'Încasat', culoare: 'var(--color-grafic-1)' }
const PROGRAMARI: SerieGrafic = {
  cheie: 'programari',
  eticheta: 'Programări onorate',
  culoare: 'var(--color-grafic-2)',
}

const numar = (n: number) => formateazaCantitate(n)

/**
 * Cifrele unei persoane alese, în fila „Rezumat” a Statisticilor — pentru
 * proprietar, care le vede pe toate pe rând („Irina cu Anda”, apoi doar Anda”).
 * Cere statisticile deblocate; ecranul „Statisticile mele” nu are nevoie de ele.
 */
export function RezumatPersoana({ id, calculata }: { id: Uuid; calculata: PerioadaCalculata }) {
  const filtru = useMemo(() => filtruStatistici(calculata), [calculata])
  return <RaportulPersoanei raport={useRaportPersoana(id, filtru)} />
}

export function RaportulPersoanei({ raport }: { raport: UseQueryResult<RaportPersoana> }) {
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

function Raport({ raport, incarca }: { raport: RaportPersoana; incarca: boolean }) {
  return (
    <div className={incarca ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <Cifre t={raport.total} c={raport.comparatie} />

      <div className="mt-4 space-y-4">
        <GraficTimp raport={raport} />

        <div className="grid gap-4 lg:grid-cols-2">
          <CardBare
            titlu="Servicii"
            descriere="Ședințele făcute și banii intrați pe fiecare serviciu."
            randuri={raport.servicii.map((s) => ({
              cheie: s.articol_id,
              eticheta: s.denumire,
              valoare: s.incasat,
              detaliu: `${numar(s.sedinte)} ${plural(s.sedinte, 'ședință făcută', 'ședințe făcute')}`,
            }))}
            antete={['Serviciu', 'Ședințe', 'Încasat']}
            cantitati={raport.servicii.map((s) => numar(s.sedinte))}
            gol="Nicio ședință făcută și nicio încasare în perioada aleasă."
          />
          <CardBare
            titlu="Clienți"
            descriere="Cei zece clienți care au adus cei mai mulți bani prin ședințele făcute."
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

function Cifre({ t, c }: { t: TotaluriPersoana; c: TotaluriPersoana | null }) {
  const variatie = (curent: number, anterior: number | undefined, bani = true) =>
    c && anterior !== undefined ? (
      <Variatie
        curent={curent}
        anterior={anterior}
        maiMultEBine
        formateaza={bani ? formateazaBani : numar}
      />
    ) : undefined

  const medie = t.incasari > 0 ? rotunjeste(t.incasat / t.incasari) : 0
  const trecute = t.programari_onorate + t.programari_neprezentate

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Statistica
        eticheta="Încasat din ședințele mele"
        valoare={formateazaBani(t.incasat)}
        pictograma={<Banknote className="size-4" />}
        detaliu={variatie(t.incasat, c?.incasat) ?? 'banii intrați pe ședințele făcute'}
      />
      <Statistica
        eticheta="Programări onorate"
        valoare={numar(t.programari_onorate)}
        pictograma={<CalendarCheck className="size-4" />}
        detaliu={variatie(t.programari_onorate, c?.programari_onorate, false)}
      />
      <Statistica
        eticheta="Rămas de încasat"
        valoare={formateazaBani(t.neachitat)}
        pictograma={<Clock3 className="size-4" />}
        detaliu="din ședințele făcute în perioadă"
      />
      <Statistica
        eticheta="Clienți serviți"
        valoare={numar(t.clienti)}
        pictograma={<Users className="size-4" />}
        detaliu={variatie(t.clienti, c?.clienti, false)}
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
  )
}

// ---------------------------------------------------------------------------
// În timp: ce a făcut și ce a încasat, pe zile / săptămâni / luni
// ---------------------------------------------------------------------------

function GraficTimp({ raport }: { raport: RaportPersoana }) {
  const perioada = { de_la: raport.de_la, pana_la: raport.pana_la }
  const unitate = { zi: 'zile', saptamana: 'săptămâni', luna: 'luni' }[raport.pas]

  const bare = (valori: (p: RaportPersoana['perioade'][number]) => Record<string, number>): PunctGrafic[] =>
    raport.perioade.map((p) => ({
      cheie: p.inceput,
      ...eticheteBara(p.inceput, raport.pas, perioada),
      valori: valori(p),
    }))

  const incasat = bare((p) => ({ incasat: p.incasat }))
  const programari = bare((p) => ({ programari: p.programari_onorate }))
  const gol = raport.total.incasat === 0 && raport.total.programari_onorate === 0

  return (
    <>
      <CardGrafic
        titlu="Încasat pe ședințele mele"
        descriere={`Pe ${unitate}. Banii din avansul unui abonament se numără în ziua ședinței care l-a consumat.`}
        gol={gol ? <Gol text="Nicio ședință făcută și nicio încasare în perioada aleasă." /> : undefined}
        tabel={{
          antete: ['Perioada', 'Încasat', 'Programări onorate'],
          laDreapta: [1, 2],
          randuri: incasat.map((p, i) => ({
            cheie: p.cheie,
            celule: [
              p.titlu,
              formateazaBani(p.valori['incasat'] ?? 0),
              numar(raport.perioade[i]?.programari_onorate ?? 0),
            ],
          })),
        }}
      >
        <GraficColoane
          serii={[INCASAT]}
          puncte={incasat}
          formateaza={formateazaBani}
          descriere={`Încasat pe ${unitate}. Folosește săgețile pentru a trece de la o perioadă la alta.`}
          inaltime={220}
        />
      </CardGrafic>

      <CardGrafic
        titlu="Programări onorate"
        descriere={`Câte programări a făcut, pe ${unitate}.`}
        gol={gol ? <Gol text="Nicio programare onorată în perioada aleasă." /> : undefined}
        tabel={{
          antete: ['Perioada', 'Programări onorate'],
          laDreapta: [1],
          randuri: programari.map((p) => ({
            cheie: p.cheie,
            celule: [p.titlu, numar(p.valori['programari'] ?? 0)],
          })),
        }}
      >
        <GraficColoane
          serii={[PROGRAMARI]}
          puncte={programari}
          formateaza={numar}
          descriere={`Programările onorate pe ${unitate}.`}
          inaltime={160}
        />
      </CardGrafic>
    </>
  )
}
