import { BanknoteArrowUp, Clock3 } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useModificaVanzare } from '@/app/queries'
import { InsemnPlata } from '@/components/insemne'
import type { VanzareDetaliu } from '@/domain/types'
import { cn } from '@/lib/cn'
import { formateazaData, isSameDay, laData } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'
import { ButonGrup, GrupButoane, useNotificari } from '@/ui'

/*
  „Achitat” / „Neachitat” — cele două căsuțe din cererea clinicii.

  Două butoane, nu o bifă singură: „neachitat” nu este lipsa unui răspuns, este
  un răspuns — clienta a luat cremele și plătește data viitoare. Cu o bifă
  goală, nu s-ar fi știut dacă cineva a ales „neachitat” sau doar a uitat.
*/

/** Alegerea simplă, pentru formulare: nu scrie nimic, doar spune ce s-a ales. */
export function AlegerePlata({
  achitat,
  onSchimba,
  disabled,
  compact = false,
  className,
}: {
  achitat: boolean
  onSchimba: (achitat: boolean) => void
  disabled?: boolean
  /** Mai mică, pentru rândurile din cronologia fișei. */
  compact?: boolean
  className?: string
}) {
  const marime = compact ? 'h-9 px-2.5 sm:h-8' : 'h-11 flex-1 sm:h-9'

  return (
    <GrupButoane eticheta="Plata" className={cn(!compact && 'w-full', className)}>
      <ButonGrup
        activ={achitat}
        disabled={disabled}
        onClick={() => onSchimba(true)}
        className={cn(marime, achitat && 'text-success')}
      >
        <BanknoteArrowUp className="size-4" aria-hidden />
        Achitat
      </ButonGrup>
      <ButonGrup
        activ={!achitat}
        disabled={disabled}
        onClick={() => onSchimba(false)}
        className={cn(marime, !achitat && 'text-warning')}
      >
        <Clock3 className="size-4" aria-hidden />
        Neachitat
      </ButonGrup>
    </GrupButoane>
  )
}

/**
 * Plata unei vânzări deja înregistrate — se schimbă pe loc, la apăsare.
 *
 * „Achitat” pe o vânzare neachitată o trece plătită ACUM (serverul pune data);
 * „Neachitat” readuce datoria pe fișa clientei. O vânzare care stinge ședințe
 * este chiar plata lor și nu se poate debifa: acolo apare doar însemnul.
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
  const achitat = modifica.isPending
    ? (modifica.variables?.date.achitat ?? vanzare.achitat)
    : vanzare.achitat

  if (vanzare.linii.some((l) => l.programare_id !== null)) {
    return <InsemnPlata achitat={vanzare.achitat} />
  }

  const schimba = async (nou: boolean) => {
    if (nou === vanzare.achitat || modifica.isPending) return
    try {
      await modifica.mutateAsync({ id: vanzare.id, date: { achitat: nou } })
      notificari.succes(
        nou ? 'Vânzare achitată' : 'Vânzare trecută neachitată',
        nou
          ? `${vanzare.client_nume} · ${formateazaBani(vanzare.total)} încasați.`
          : `${vanzare.client_nume} · ${formateazaBani(vanzare.total)} rămân de plată.`,
      )
    } catch (err) {
      notificari.eroare('Plata nu a putut fi schimbată', mesajEroare(err))
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <AlegerePlata
        achitat={achitat}
        onSchimba={(nou) => void schimba(nou)}
        disabled={modifica.isPending}
        compact={compact}
      />
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
