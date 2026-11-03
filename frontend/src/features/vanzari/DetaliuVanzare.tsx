import { CalendarClock, Pencil, Trash2 } from 'lucide-react'
import { useVanzare } from '@/app/queries'
import { InsemnTipArticol } from '@/components/insemne'
import { esteAvans } from '@/domain/avans'
import type { VanzareDetaliu, VanzareLinieDetaliu } from '@/domain/types'
import { formateazaData, formateazaDataOra } from '@/lib/dates'
import { formateazaBani, formateazaCantitate } from '@/lib/money'
import { Badge, Buton, Modala, Pereche, Tabel, type Coloana } from '@/ui'
import { PlataVanzarii } from './PlataVanzarii'

/**
 * Vânzarea desfășurată: antetul (de la cine, când, de cine), plata și liniile.
 *
 * Plata se schimbă chiar de aici — „Achitat” când clienta vine cu banii,
 * „Neachitat” dacă s-a apăsat din greșeală — fără a deschide corecția.
 *
 * Rândul din listă este afișat imediat, dar fereastra reinterogează încasarea:
 * după o corecție, rândul din pagina deschisă dedesubt este cel vechi, iar
 * detaliul trebuie să arate ce s-a salvat, nu ce s-a apăsat.
 */
export function DetaliuVanzare({
  vanzare: initiala,
  onInchide,
  onModifica,
  onSterge,
}: {
  vanzare: VanzareDetaliu
  onInchide: () => void
  onModifica: (vanzare: VanzareDetaliu) => void
  /** Cere ștergerea; confirmarea o face cine a deschis detaliul. */
  onSterge?: (vanzare: VanzareDetaliu) => void
}) {
  const { data } = useVanzare(initiala.id)
  const vanzare = data ?? initiala

  const coloane: Coloana<VanzareLinieDetaliu>[] = [
    {
      cheie: 'articol',
      antet: 'Articol',
      celula: (l) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ink">{l.articol_denumire}</span>
            <InsemnTipArticol tip={l.articol_tip} />
          </div>
          {/*
            Ziua ședinței, nu a plății: o încasare din octombrie care stinge o
            ședință din septembrie arată altfel ca o greșeală de dată, iar
            întrebarea „de ce apare aici?” se pune la fiecare verificare de casă.
          */}
          {l.programare_incepe_la && (
            <p className="mt-0.5 text-[12px] text-ink-faint">
              Ședința din {formateazaData(l.programare_incepe_la)}
              {l.executant_nume && ` · făcută de ${l.executant_nume}`}
              {l.tratament_id && ' · din avansul abonamentului'}
            </p>
          )}
          {/* Bani luați pe abonament, înainte de ședințe: încă neconsumați. */}
          {esteAvans(l) && (
            <p className="mt-0.5 text-[12px] text-ink-faint">Avans abonament · încă neconsumat de ședințe</p>
          )}
        </div>
      ),
    },
    {
      cheie: 'cantitate',
      antet: 'Cantitate',
      laDreapta: true,
      className: 'w-24 tabular-nums',
      celula: (l) => formateazaCantitate(l.cantitate),
    },
    {
      cheie: 'pret',
      antet: 'Preț unitar',
      laDreapta: true,
      ascunsaSub: 'md',
      className: 'w-32 tabular-nums',
      celula: (l) => formateazaBani(l.pret_unitar),
    },
    {
      cheie: 'total',
      antet: 'Total',
      laDreapta: true,
      className: 'w-32 font-medium tabular-nums',
      celula: (l) => formateazaBani(l.total_linie),
    },
  ]

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      dimensiune="lg"
      titlu="Detaliul vânzării"
      descriere={formateazaDataOra(vanzare.efectuat_la)}
      subsol={
        <>
          {onSterge && (
            <Buton
              varianta="discret"
              onClick={() => onSterge(vanzare)}
              className="text-danger hover:text-danger sm:mr-auto"
            >
              <Trash2 className="size-4" />
              Șterge
            </Buton>
          )}
          <Buton onClick={onInchide} plin className="sm:w-auto">
            Închide
          </Buton>
          <Buton varianta="primar" onClick={() => onModifica(vanzare)} plin className="sm:w-auto">
            <Pencil className="size-4" />
            Modifică
          </Buton>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Pereche eticheta="Client">{vanzare.client_nume}</Pereche>
          <Pereche eticheta="Vândută la">{formateazaDataOra(vanzare.efectuat_la)}</Pereche>
          <Pereche eticheta="Operator">{vanzare.operator_nume}</Pereche>
          <Pereche eticheta="Proveniență">
            {/*
              Proveniența se citește din LINII, nu din `vanzare.programare_id`:
              antetul reține o singură programare, iar o plată poate stinge trei
              ședințe deodată și ar apărea greșit drept vânzare directă.
            */}
            {vanzare.linii.some((l) => l.programare_id !== null) ? (
              <Badge ton="info">
                <CalendarClock className="size-3.5" aria-hidden />
                Din programare
              </Badge>
            ) : vanzare.linii.some(esteAvans) ? (
              <Badge ton="info">Avans abonament</Badge>
            ) : (
              <Badge ton="neutral">Produse la recepție</Badge>
            )}
          </Pereche>
          <Pereche eticheta="Plata" className="col-span-2 sm:col-span-2">
            <PlataVanzarii vanzare={vanzare} className="max-w-sm" />
          </Pereche>
          <Pereche eticheta="Notă" className="col-span-2 sm:col-span-3">
            {vanzare.nota}
          </Pereche>
        </dl>

        <div className="overflow-hidden rounded-xl border border-line">
          <Tabel
            coloane={coloane}
            randuri={vanzare.linii}
            cheieRand={(l) => l.id}
            randMobil={(l) => (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{l.articol_denumire}</p>
                  <p className="mt-0.5 text-[12px] text-ink-faint tabular-nums">
                    {formateazaCantitate(l.cantitate)} × {formateazaBani(l.pret_unitar)}
                  </p>
                  {l.programare_incepe_la && (
                    <p className="text-[12px] text-ink-faint">
                      Ședința din {formateazaData(l.programare_incepe_la)}
                      {l.executant_nume && ` · făcută de ${l.executant_nume}`}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
                  {formateazaBani(l.total_linie)}
                </span>
              </div>
            )}
          />
          <div className="flex items-center justify-between border-t border-line bg-muted px-4 py-3">
            <span className="text-sm font-medium text-ink-soft">Total</span>
            <span className="text-base font-semibold text-ink tabular-nums">
              {formateazaBani(vanzare.total)}
            </span>
          </div>
        </div>

        {/* Data introducerii, distinctă de cea a încasării — contează la corecții. */}
        <p className="text-[12px] text-ink-faint">
          Înregistrată la {formateazaDataOra(vanzare.creat_la)}
          {vanzare.actualizat_la !== vanzare.creat_la &&
            `, ultima corecție la ${formateazaDataOra(vanzare.actualizat_la)}`}
        </p>
      </div>
    </Modala>
  )
}
