import { useEffect, useState } from 'react'
import { mesajEroare } from '@/api/errors'
import { useIncaseaza, useModificaVanzare } from '@/app/queries'
import type { ProgramareDetaliu, Uuid, VanzareDetaliu } from '@/domain/types'
import { formateazaData } from '@/lib/dates'
import { formateazaBani, formateazaCantitate, sumaTotal } from '@/lib/money'
import { plural } from '@/lib/text'
import { Buton, Checkbox, Modala, Textarea, useNotificari } from '@/ui'

/**
 * Încasarea a tot ce are clientul de plată: ședințele rămase și produsele
 * luate pe datorie.
 *
 * O clientă care vine de trei ori într-o lună plătește o dată, la sfârșit; de
 * aceea fereastra pornește cu TOATE datoriile bifate. Debifarea rămâne
 * posibilă pentru cazul invers — cea care achită doar ședința de azi și lasă
 * restul pe data viitoare.
 *
 * Ședințele se sting într-o singură vânzare, cu prețurile citite de server din
 * `programare.pret` — aici doar afișate. Vânzările de produse există deja, cu
 * liniile lor; ele doar se trec „achitate”, ca de pe bon. Suma de pe buton este
 * o previzualizare, cu aceeași rotunjire ca a bazei de date (`sumaTotal`).
 */
export function ModalaIncasare({
  deschisa,
  onInchide,
  clientId,
  clientNume,
  sedinte,
  vanzari = [],
}: {
  deschisa: boolean
  onInchide: () => void
  clientId: Uuid
  clientNume: string
  /** Ședințele onorate și neachitate, derivate din istoricul deja încărcat. */
  sedinte: ProgramareDetaliu[]
  /** Vânzările de produse neachitate, din același istoric. */
  vanzari?: VanzareDetaliu[]
}) {
  const notificari = useNotificari()
  const incaseaza = useIncaseaza()
  const modifica = useModificaVanzare()

  const [bifate, setBifate] = useState<Uuid[]>([])
  const [nota, setNota] = useState('')
  const [eroare, setEroare] = useState<string | null>(null)
  // Propriu, nu `isPending`: cererile pleacă în paralel, iar starea unei
  // mutații o urmărește doar pe ultima pornită.
  const [seTrimite, setSeTrimite] = useState(false)

  // Bifele se refac la DESCHIDEREA ferestrei, nu la fiecare schimbare a listei:
  // istoricul se împrospătează în fundal, iar o resincronizare pe `sedinte` ar
  // rebifa exact rândurile pe care operatoarea tocmai le-a scos.
  useEffect(() => {
    if (!deschisa) return
    setBifate([...sedinte.map((s) => s.id), ...vanzari.map((v) => v.id)])
    setNota('')
    setEroare(null)
  }, [deschisa, clientId])

  // Ordinea este cronologică, cea mai veche datorie prima — invers față de
  // istoric. O listă de plată se citește ca o notă de plată: datoria cea mai
  // veche sus, pentru că despre ea se discută cu clientul.
  const datorii: Datorie[] = [
    ...sedinte.map((s) => ({
      id: s.id,
      fel: 'sedinta' as const,
      la: s.incepe_la,
      denumire: s.articol_denumire,
      cine: s.executant_nume,
      suma: s.pret,
    })),
    ...vanzari.map((v) => ({
      id: v.id,
      fel: 'produse' as const,
      la: v.efectuat_la,
      denumire: denumireProduse(v),
      cine: v.operator_nume,
      suma: v.total,
    })),
  ].sort((a, b) => a.la.localeCompare(b.la))

  const selectate = datorii.filter((d) => bifate.includes(d.id))
  const total = sumaTotal(selectate.map((d) => d.suma))
  const sedinteAlese = selectate.filter((d) => d.fel === 'sedinta')
  const vanzariAlese = selectate.filter((d) => d.fel === 'produse')

  const comuta = (id: Uuid) => {
    setBifate((precedente) =>
      precedente.includes(id) ? precedente.filter((x) => x !== id) : [...precedente, id],
    )
  }

  const trimite = async () => {
    // Se verifică `selectate`, nu `bifate`: dacă între timp cineva a încasat
    // ședințele de la alt post, ele dispar din `sedinte`, iar `bifate` rămâne cu
    // identificatori care nu mai au rând. Pe `bifate` am fi trimis o listă
    // goală și am fi primit o eroare de la server pentru o cerere pe care nu
    // trebuia s-o facem.
    if (selectate.length === 0) return
    setEroare(null)
    setSeTrimite(true)

    /*
      Ședințele și vânzările pleacă deodată: sunt scrieri independente, iar
      clienta așteaptă la recepție. `allSettled`, nu `all`: dacă una cade,
      celelalte s-au scris deja, iar fereastra trebuie să spună ce a rămas —
      istoricul reîncărcat scoate din listă ce s-a plătit.
    */
    const rezultate = await Promise.allSettled([
      ...(sedinteAlese.length > 0
        ? [
            // Fără prețuri în cerere: serverul le ia din `programare.pret`,
            // singura sursă a adevărului.
            incaseaza.mutateAsync({
              client_id: clientId,
              programare_ids: sedinteAlese.map((d) => d.id),
              nota: nota.trim() === '' ? null : nota.trim(),
            }),
          ]
        : []),
      ...vanzariAlese.map((d) => modifica.mutateAsync({ id: d.id, date: { achitat: true } })),
    ])
    setSeTrimite(false)

    const cazuta = rezultate.find((r) => r.status === 'rejected')
    if (cazuta) {
      // Eroarea rămâne în fereastră, lângă bifele care au produs-o: dacă
      // serverul refuză o ședință stinsă între timp de altcineva, operatoarea
      // trebuie să vadă lista ca s-o debifeze, nu o notificare peste ecran.
      setEroare(mesajEroare(cazuta.reason))
      return
    }

    const parti = [
      sedinteAlese.length > 0 &&
        `${sedinteAlese.length} ${plural(sedinteAlese.length, 'ședință stinsă', 'ședințe stinse')}`,
      vanzariAlese.length > 0 &&
        `${vanzariAlese.length} ${plural(vanzariAlese.length, 'vânzare de produse achitată', 'vânzări de produse achitate')}`,
    ].filter(Boolean)
    notificari.succes(`Încasare de ${formateazaBani(total)}`, `${clientNume} · ${parti.join(', ')}.`)
    onInchide()
  }

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={vanzari.length === 0 ? 'Încasează ședințele' : 'Încasează'}
      descriere={`${clientNume} · ${descriereDatorii(sedinte.length, vanzari.length)}`}
      subsol={
        <>
          <Buton
            onClick={onInchide}
            disabled={seTrimite}
            className="tinta-atingere sm:w-auto"
            plin
          >
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            onClick={trimite}
            incarca={seTrimite}
            disabled={selectate.length === 0}
            className="tinta-atingere sm:w-auto"
            plin
          >
            Încasează {formateazaBani(total)}
          </Buton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {datorii.map((datorie) => (
            <li
              key={datorie.id}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3"
            >
              <Checkbox
                className="min-w-0 flex-1"
                checked={bifate.includes(datorie.id)}
                onChange={() => comuta(datorie.id)}
                disabled={seTrimite}
                eticheta={<span className="block truncate">{datorie.denumire}</span>}
                descriere={
                  <>
                    <span className="tabular-nums">{formateazaData(datorie.la)}</span>
                    {' · '}
                    {datorie.fel === 'produse' ? `Produse · ${datorie.cine}` : datorie.cine}
                  </>
                }
              />
              <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
                {formateazaBani(datorie.suma)}
              </span>
            </li>
          ))}
        </ul>

        {/* Totalul se recalculează din bife, ca operatoarea să spună suma cu
            voce tare înainte de a apăsa, nu după. */}
        <div className="flex items-center justify-between rounded-xl bg-muted px-3.5 py-3">
          <span className="text-sm font-medium text-ink-soft">
            Total de încasat
            <span className="ml-1.5 text-ink-faint tabular-nums">
              ({vanzari.length === 0
                ? `${selectate.length} ${plural(selectate.length, 'ședință', 'ședințe')}`
                : `${selectate.length} ${plural(selectate.length, 'datorie', 'datorii')}`})
            </span>
          </span>
          <span className="text-base font-semibold text-ink tabular-nums">
            {formateazaBani(total)}
          </span>
        </div>

        {/*
          Nota merge pe încasarea ședințelor. Doar cu produse bifate nu are unde
          să ajungă — vânzările își au deja nota lor — așa că nu se cere.
        */}
        {sedinte.length > 0 && (
          <Textarea
            eticheta="Notă"
            rows={2}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            disabled={seTrimite}
            placeholder="Observații despre plată (opțional)"
          />
        )}

        {eroare && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {eroare}
          </p>
        )}
      </div>
    </Modala>
  )
}

/** Un rând din lista de plată: o ședință neîncasată sau o vânzare neachitată. */
interface Datorie {
  id: Uuid
  fel: 'sedinta' | 'produse'
  la: string
  denumire: string
  cine: string
  suma: number
}

/** „Ser cu vitamina C, Loțiune tonică × 2” — ce a luat clienta, pe un rând. */
function denumireProduse(vanzare: VanzareDetaliu): string {
  return vanzare.linii
    .map((l) =>
      l.cantitate === 1
        ? l.articol_denumire
        : `${l.articol_denumire} × ${formateazaCantitate(l.cantitate)}`,
    )
    .join(', ')
}

function descriereDatorii(sedinte: number, vanzari: number): string {
  const parti: string[] = []
  if (sedinte > 0) {
    parti.push(`${sedinte} ${plural(sedinte, 'ședință onorată și neachitată', 'ședințe onorate și neachitate')}`)
  }
  if (vanzari > 0) {
    parti.push(`${vanzari} ${plural(vanzari, 'vânzare de produse neachitată', 'vânzări de produse neachitate')}`)
  }
  return parti.join(' · ')
}
