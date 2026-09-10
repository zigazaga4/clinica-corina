import { ArrowRight, ShieldCheck } from 'lucide-react'
import { InsemnActiuneJurnal } from '@/components/insemne'
import { numeEntitate } from '@/domain/labels'
import type { JurnalOperatiuneDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaDataOra } from '@/lib/dates'
import { Buton, Modala, Pereche, StareGoala, Tabel, type Coloana } from '@/ui'
import { campuriSchimbate, esteIdentificator, etichetaCamp, formateazaValoare } from './campuri'

/**
 * Detaliul unei intrări de jurnal: ce arăta înregistrarea înainte și ce arată
 * după.
 *
 * Serverul reține doar câmpurile atinse, deci comparația este scurtă și poate
 * fi citită câmp cu câmp. Nu afișăm obiectele brute: un JSON pe ecran mută
 * munca de interpretare asupra administratorului, exact în momentul în care el
 * încearcă să afle cine a schimbat prețul unui serviciu.
 *
 * Fereastra este strict de citire. Jurnalul este append-only (§3): nu există
 * UPDATE și nu există DELETE pe `jurnal_operatiuni`, altfel el nu ar mai putea
 * proba nimic despre operațiunile asupra datelor (art. 3.1.D).
 */

interface RandDiferenta {
  cheie: string
  inainte: unknown
  dupa: unknown
}

export function ModalaDetaliuJurnal({
  intrare,
  onInchide,
}: {
  intrare: JurnalOperatiuneDetaliu
  onInchide: () => void
}) {
  const randuri: RandDiferenta[] = campuriSchimbate(intrare).map((cheie) => ({
    cheie,
    inainte: intrare.date_vechi?.[cheie] ?? null,
    dupa: intrare.date_noi?.[cheie] ?? null,
  }))

  const coloane: Coloana<RandDiferenta>[] = [
    {
      cheie: 'camp',
      antet: 'Câmp',
      celula: (r) => <span className="font-medium text-ink">{etichetaCamp(r.cheie)}</span>,
      className: 'w-1/3',
    },
    {
      cheie: 'inainte',
      antet: 'Înainte',
      celula: (r) => <Valoare cheie={r.cheie} valoare={r.inainte} discreta />,
    },
    {
      cheie: 'dupa',
      antet: 'După',
      celula: (r) => <Valoare cheie={r.cheie} valoare={r.dupa} />,
    },
  ]

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      titlu="Operațiune înregistrată"
      descriere={formateazaDataOra(intrare.creat_la)}
      dimensiune="lg"
      subsol={
        <Buton varianta="primar" onClick={onInchide} className="sm:w-auto" plin>
          Închide
        </Buton>
      }
    >
      <dl className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Pereche eticheta="Utilizator">{intrare.utilizator_nume}</Pereche>
        <Pereche eticheta="Acțiune">
          <InsemnActiuneJurnal actiune={intrare.actiune} />
        </Pereche>
        <Pereche eticheta="Entitate">{numeEntitate(intrare.entitate)}</Pereche>
        <Pereche eticheta="Adresă IP">{intrare.adresa_ip}</Pereche>
        {intrare.entitate_id && (
          <div className="col-span-2 sm:col-span-4">
            <Pereche eticheta="Înregistrarea vizată">
              <span className="font-mono text-[12px] break-all">{intrare.entitate_id}</span>
            </Pereche>
          </div>
        )}
      </dl>

      <p className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
        Ce s-a schimbat
      </p>

      <div className="overflow-hidden rounded-xl border border-line">
        <Tabel
          coloane={coloane}
          randuri={randuri}
          cheieRand={(r) => r.cheie}
          randMobil={(r) => (
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-ink-faint">{etichetaCamp(r.cheie)}</p>
              <div className="mt-1 flex items-start gap-2 text-sm">
                <Valoare cheie={r.cheie} valoare={r.inainte} discreta />
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
                <Valoare cheie={r.cheie} valoare={r.dupa} />
              </div>
            </div>
          )}
          stareGoala={
            <StareGoala
              titlu="Fără modificări de conținut"
              descriere="Operațiunea a fost înregistrată, dar nu a schimbat valori din baza de date."
            />
          }
        />
      </div>

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-snug text-ink-faint">
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
        Intrările din jurnal nu pot fi modificate sau șterse din aplicație.
      </p>
    </Modala>
  )
}

function Valoare({
  cheie,
  valoare,
  discreta = false,
}: {
  cheie: string
  valoare: unknown
  /** Valoarea dinainte se scrie estompat, ca ochiul să cadă pe cea nouă. */
  discreta?: boolean
}) {
  const text = formateazaValoare(cheie, valoare)
  const lipseste = text === '—'

  return (
    <span
      className={cn(
        'break-words',
        lipseste || discreta ? 'text-ink-faint' : 'text-ink',
        esteIdentificator(cheie) && !lipseste && 'font-mono text-[12px] break-all',
      )}
    >
      {text}
    </span>
  )
}
