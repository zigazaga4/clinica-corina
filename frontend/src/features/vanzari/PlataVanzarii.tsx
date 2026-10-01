import { Banknote, Clock3, CreditCard, type LucideIcon } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useModificaVanzare } from '@/app/queries'
import { etichetaMetodaPlata, METODE_PLATA } from '@/domain/labels'
import type { MetodaPlata, VanzareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaData, isSameDay, laData } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { ButonGrup, GrupButoane, useNotificari } from '@/ui'

/*
  „Numerar” / „Card” / „Neachitat” — cum s-a plătit, sau că nu s-a plătit încă.

  Cererea clinicii a fost întâi „achitat sau neachitat”, apoi (2026-10-01) „la
  orice încasare să aleagă dacă e card sau cash”. Un singur rând de butoane le
  spune pe amândouă: o apăsare pe „Card” înseamnă „achitat, cu cardul”.

  Butoane, nu o bifă: „neachitat” nu este lipsa unui răspuns, este un răspuns —
  clienta a luat cremele și plătește data viitoare. Și nimic nu e ales dinainte
  la o vânzare nouă: o metodă pusă din oficiu ar fi trecut în Statistici
  „numerar” tot ce recepția a uitat să schimbe.
*/

/** Ce arată butoanele: metoda, sau că vânzarea e încă datorie. */
export type StarePlata = MetodaPlata | 'neachitat'

/** Starea plății unei vânzări; `null` = achitată, dar fără metodă (încasare veche). */
export function starePlata(vanzare: Pick<VanzareDetaliu, 'achitat' | 'metoda_plata'>): StarePlata | null {
  return vanzare.achitat ? vanzare.metoda_plata : 'neachitat'
}

const PICTOGRAME: Record<StarePlata, LucideIcon> = {
  numerar: Banknote,
  card: CreditCard,
  neachitat: Clock3,
}

const ETICHETE: Record<StarePlata, string> = { ...etichetaMetodaPlata, neachitat: 'Neachitat' }

/**
 * Alegerea simplă, pentru formulare: nu scrie nimic, doar spune ce s-a ales.
 *
 * `cuNeachitat={false}` lasă doar metodele — la o încasare de ședințe, care
 * este chiar plata lor și nu poate rămâne datorie.
 */
export function AlegerePlata({
  valoare,
  onSchimba,
  cuNeachitat = true,
  disabled,
  compact = false,
  className,
}: {
  valoare: StarePlata | null
  onSchimba: (valoare: StarePlata) => void
  cuNeachitat?: boolean
  disabled?: boolean
  /** Mai mică, pentru rândurile din cronologia fișei și din liste. */
  compact?: boolean
  className?: string
}) {
  const marime = compact ? 'h-9 px-2.5 sm:h-8' : 'h-11 flex-1 sm:h-9'
  const optiuni: StarePlata[] = cuNeachitat ? [...METODE_PLATA, 'neachitat'] : [...METODE_PLATA]

  return (
    <GrupButoane eticheta="Plata" className={cn(!compact && 'w-full', className)}>
      {optiuni.map((optiune) => {
        const Pictograma = PICTOGRAME[optiune]
        const activ = valoare === optiune
        return (
          <ButonGrup
            key={optiune}
            activ={activ}
            disabled={disabled}
            onClick={() => onSchimba(optiune)}
            className={cn(
              marime,
              activ && (optiune === 'neachitat' ? 'text-warning' : 'text-success'),
            )}
          >
            <Pictograma className="size-4" aria-hidden />
            {ETICHETE[optiune]}
          </ButonGrup>
        )
      })}
    </GrupButoane>
  )
}

/**
 * Plata unei vânzări deja înregistrate — se schimbă pe loc, la apăsare.
 *
 * „Numerar” sau „Card” pe o vânzare neachitată o trece plătită ACUM (serverul
 * pune data); pe una achitată doar schimbă metoda — recepția a apăsat greșit.
 * „Neachitat” readuce datoria pe fișa clientei. O vânzare care stinge ședințe
 * este chiar plata lor: acolo se poate schimba doar metoda.
 */
export function PlataVanzarii({
  vanzare: primita,
  compact = false,
  className,
}: {
  vanzare: VanzareDetaliu
  compact?: boolean
  className?: string
}) {
  const modifica = useModificaVanzare()
  const notificari = useNotificari()

  /*
    Răspunsul mutației poate fi mai nou decât vânzarea primită: fișa își
    reîncarcă istoricul abia după, iar până atunci butoanele ar fi sărit înapoi
    o clipă. Se arată varianta cu `actualizat_la` mai recent, iar cât timp
    cererea e în drum, alegerea tocmai apăsată.
  */
  const dinMutatie = modifica.data?.id === primita.id ? modifica.data : null
  const vanzare =
    dinMutatie && dinMutatie.actualizat_la > primita.actualizat_la ? dinMutatie : primita
  const actuala = starePlata(vanzare)
  const ceruta = modifica.variables?.date
  const afisata: StarePlata | null =
    modifica.isPending && ceruta
      ? ceruta.achitat === false
        ? 'neachitat'
        : (ceruta.metoda_plata ?? actuala)
      : actuala

  // Un bon de ședințe este chiar plata lor: nu poate deveni datorie.
  const stingeSedinte = vanzare.linii.some((l) => l.programare_id !== null)

  const schimba = async (noua: StarePlata) => {
    if (noua === actuala || modifica.isPending) return
    const date =
      noua === 'neachitat' ? { achitat: false } : { achitat: true, metoda_plata: noua }
    try {
      await modifica.mutateAsync({ id: vanzare.id, date })
      notificari.succes(
        noua === 'neachitat'
          ? 'Vânzare trecută neachitată'
          : vanzare.achitat
            ? `Plată schimbată pe ${ETICHETE[noua].toLowerCase()}`
            : 'Vânzare achitată',
        noua === 'neachitat'
          ? `${vanzare.client_nume} · ${formateazaBani(vanzare.total)} rămân de plată.`
          : `${vanzare.client_nume} · ${formateazaBani(vanzare.total)} · ${ETICHETE[noua].toLowerCase()}.`,
      )
    } catch (err) {
      notificari.eroare('Plata nu a putut fi schimbată', mesajEroare(err))
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <AlegerePlata
        valoare={afisata}
        onSchimba={(noua) => void schimba(noua)}
        cuNeachitat={!stingeSedinte}
        disabled={modifica.isPending}
        compact={compact}
      />
      {/* Încasare de dinainte de alegere: nu se știe cum s-a plătit. */}
      {!modifica.isPending && afisata === null && (
        <p className="text-[12px] text-warning">Alege cum s-a plătit.</p>
      )}
      {/* Plătită în altă zi decât a vânzării: tocmai asta se caută la sfârșit de lună. */}
      {!modifica.isPending && achitatAltaZi(vanzare) && (
        <p className="text-[12px] text-ink-faint tabular-nums">
          Achitat pe {formateazaData(vanzare.achitat_la)}
        </p>
      )}
    </div>
  )
}

/** Plătită, dar în altă zi decât cea în care au plecat produsele. */
export function achitatAltaZi(vanzare: VanzareDetaliu): boolean {
  if (vanzare.achitat_la === null) return false
  return !isSameDay(laData(vanzare.achitat_la), laData(vanzare.efectuat_la))
}
