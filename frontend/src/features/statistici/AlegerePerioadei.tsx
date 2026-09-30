import { Input, Select } from '@/ui'
import {
  calculeazaPerioada,
  formateazaPerioada,
  PRESETURI,
  type AlegerePerioada,
  type Preset,
} from './perioade'

/*
  Cât timp se tastează anul într-un câmp de dată, Chrome dă deja o valoare
  „întreagă” — „0002-09-01” după prima cifră. Trimisă, ar fi cerut un raport
  pe două mii de ani și s-ar fi întors cu eroare la fiecare tastă. Se așteaptă
  un an plauzibil.
*/
const anPlauzibil = (zi: string) => {
  const an = Number(zi.slice(0, 4))
  return an >= 2000 && an <= 2100
}

/**
 * Perioada Statisticilor: o listă de alegeri obișnuite („Luna aceasta”, „Anul
 * trecut”) și, la „Alt interval”, cele două date. Nimeni nu vrea să caute într-un
 * calendar ca să afle cât s-a încasat luna trecută.
 *
 * Sub alegere se scrie limpede perioada și cea cu care se compară — „față de”
 * de pe cifre trebuie să aibă un înțeles pe care îl vezi, nu pe care îl ghicești.
 */
export function AlegerePerioadei({
  alegere,
  onSchimba,
}: {
  alegere: AlegerePerioada
  onSchimba: (alegere: AlegerePerioada) => void
}) {
  const { perioada, comparatie } = calculeazaPerioada(alegere)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-2 [&>*]:shrink-0">
        <Select
          eticheta="Perioada"
          value={alegere.preset}
          onChange={(e) => onSchimba({ ...alegere, preset: e.target.value as Preset })}
          containerClassName="w-52"
        >
          {PRESETURI.map((p) => (
            <option key={p.valoare} value={p.valoare}>
              {p.eticheta}
            </option>
          ))}
        </Select>
        {alegere.preset === 'interval' && (
          <>
            <Input
              type="date"
              eticheta="De la"
              value={alegere.interval.de_la}
              onChange={(e) =>
                anPlauzibil(e.target.value) &&
                onSchimba({ ...alegere, interval: { ...alegere.interval, de_la: e.target.value } })
              }
              containerClassName="w-40"
            />
            <Input
              type="date"
              eticheta="Până la"
              value={alegere.interval.pana_la}
              onChange={(e) =>
                anPlauzibil(e.target.value) &&
                onSchimba({ ...alegere, interval: { ...alegere.interval, pana_la: e.target.value } })
              }
              containerClassName="w-40"
            />
          </>
        )}
      </div>
      <p className="text-[12px] text-ink-faint">
        {formateazaPerioada(perioada)} · comparat cu {formateazaPerioada(comparatie)}
      </p>
    </div>
  )
}
