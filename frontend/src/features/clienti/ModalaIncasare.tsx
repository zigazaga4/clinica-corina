import { useEffect, useState } from 'react'
import { mesajEroare } from '@/api/errors'
import { useIncaseaza } from '@/app/queries'
import type { ProgramareDetaliu, Uuid } from '@/domain/types'
import { formateazaData } from '@/lib/dates'
import { formateazaBani, sumaTotal } from '@/lib/money'
import { plural } from '@/lib/text'
import { Buton, Checkbox, Modala, Textarea, useNotificari } from '@/ui'

/**
 * Încasarea ședințelor rămase de plată ale unui client.
 *
 * O clientă care vine de trei ori într-o lună plătește o dată, la sfârșit; de
 * aceea fereastra pornește cu TOATE ședințele neachitate bifate și le stinge
 * într-o singură vânzare. Debifarea rămâne posibilă pentru cazul invers — cel
 * care achită doar ședința de azi și lasă restul pe data viitoare.
 *
 * Prețurile sunt doar afișate, niciodată trimise: serverul le citește din
 * `programare.pret`. Suma de pe buton este o previzualizare a ceea ce va scrie
 * serverul, calculată cu aceeași rotunjire ca a bazei de date (`sumaTotal`).
 */
export function ModalaIncasare({
  deschisa,
  onInchide,
  clientId,
  clientNume,
  sedinte,
}: {
  deschisa: boolean
  onInchide: () => void
  clientId: Uuid
  clientNume: string
  /** Ședințele onorate și neachitate, derivate din istoricul deja încărcat. */
  sedinte: ProgramareDetaliu[]
}) {
  const notificari = useNotificari()
  const incaseaza = useIncaseaza()

  const [bifate, setBifate] = useState<Uuid[]>([])
  const [nota, setNota] = useState('')
  const [eroare, setEroare] = useState<string | null>(null)

  // Bifele se refac la DESCHIDEREA ferestrei, nu la fiecare schimbare a listei:
  // istoricul se împrospătează în fundal, iar o resincronizare pe `sedinte` ar
  // rebifa exact rândurile pe care operatoarea tocmai le-a scos.
  useEffect(() => {
    if (!deschisa) return
    setBifate(sedinte.map((s) => s.id))
    setNota('')
    setEroare(null)
  }, [deschisa, clientId])

  // Ordinea este cronologică, cea mai veche ședință prima — invers față de
  // istoric. O listă de plată se citește ca o notă de plată: datoria cea mai
  // veche sus, pentru că despre ea se discută cu clientul.
  const inOrdine = [...sedinte].sort((a, b) => a.incepe_la.localeCompare(b.incepe_la))
  const selectate = inOrdine.filter((s) => bifate.includes(s.id))
  const total = sumaTotal(selectate.map((s) => s.pret))

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

    try {
      // Fără prețuri în cerere: serverul le ia din `programare.pret`, singura
      // sursă a adevărului. Trimiterea lor ar deschide ușa unei încasări care
      // nu corespunde ședinței.
      await incaseaza.mutateAsync({
        client_id: clientId,
        programare_ids: selectate.map((s) => s.id),
        nota: nota.trim() === '' ? null : nota.trim(),
      })
      notificari.succes(
        `Încasare de ${formateazaBani(total)}`,
        `${clientNume} · ${selectate.length} ${plural(selectate.length, 'ședință stinsă', 'ședințe stinse')}.`,
      )
      onInchide()
    } catch (err) {
      // Eroarea rămâne în fereastră, lângă bifele care au produs-o: dacă
      // serverul refuză o ședință stinsă între timp de altcineva, operatoarea
      // trebuie să vadă lista ca s-o debifeze, nu o notificare peste ecran.
      setEroare(mesajEroare(err))
    }
  }

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      blocata={incaseaza.isPending}
      titlu="Încasează ședințele"
      descriere={`${clientNume} · ${sedinte.length} ${plural(
        sedinte.length,
        'ședință onorată și neachitată',
        'ședințe onorate și neachitate',
      )}`}
      subsol={
        <>
          <Buton
            onClick={onInchide}
            disabled={incaseaza.isPending}
            className="tinta-atingere sm:w-auto"
            plin
          >
            Renunță
          </Buton>
          <Buton
            varianta="primar"
            onClick={trimite}
            incarca={incaseaza.isPending}
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
          {inOrdine.map((sedinta) => (
            <li
              key={sedinta.id}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3"
            >
              <Checkbox
                className="min-w-0 flex-1"
                checked={bifate.includes(sedinta.id)}
                onChange={() => comuta(sedinta.id)}
                disabled={incaseaza.isPending}
                eticheta={<span className="block truncate">{sedinta.articol_denumire}</span>}
                descriere={
                  <>
                    <span className="tabular-nums">{formateazaData(sedinta.incepe_la)}</span>
                    {' · '}
                    {sedinta.executant_nume}
                  </>
                }
              />
              <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
                {formateazaBani(sedinta.pret)}
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
              ({selectate.length} {plural(selectate.length, 'ședință', 'ședințe')})
            </span>
          </span>
          <span className="text-base font-semibold text-ink tabular-nums">
            {formateazaBani(total)}
          </span>
        </div>

        <Textarea
          eticheta="Notă"
          rows={2}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          disabled={incaseaza.isPending}
          placeholder="Observații despre plată (opțional)"
        />

        {eroare && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {eroare}
          </p>
        )}
      </div>
    </Modala>
  )
}
