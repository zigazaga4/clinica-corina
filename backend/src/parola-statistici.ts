/**
 * Parola statisticilor a fost uitată — `npm run parola-statistici`.
 *
 * Din aplicație parola se schimbă doar știind-o pe cea veche (v.
 * `routes/statistici.ts`), tocmai ca un cont de administrator să nu fie de
 * ajuns. Când nu o mai știe nimeni, singura ieșire trece pe aici, pe server —
 * unde ajunge doar cine are acces la mașină, nu oricine are un cont.
 *
 * Scriptul ȘTERGE parola; nu alege alta. La următoarea deschidere a ecranului
 * „Statistici”, primul administrator o alege din nou. Toate statisticile
 * deschise în acel moment se încuie pe loc: deblocările poartă amprenta
 * parolei vechi.
 *
 * Nu atinge nimic altceva: încasările și cheltuielile rămân cum sunt. Se scrie
 * în jurnal, fără autor — nu există un cont în spatele unei comenzi rulate pe
 * server.
 */

import 'dotenv/config'
import pool, { tranzactie } from './lib/db.js'
import { scrieJurnal } from './lib/jurnal.js'

async function ruleaza(): Promise<void> {
  const sterse = await tranzactie(async (ex) => {
    const { rowCount } = await ex.query(`DELETE FROM parola_statistici`)
    if (rowCount) {
      await scrieJurnal(ex, {
        utilizator_id: null,
        actiune: 'stergere',
        entitate: 'parola_statistici',
        date_noi: { motiv: 'ștearsă de pe server (parolă uitată)' },
      })
    }
    return rowCount ?? 0
  })

  console.log(
    sterse
      ? '✓ Parola statisticilor a fost ștearsă. Primul administrator care deschide „Statistici” alege una nouă.'
      : 'Parola statisticilor nu era aleasă — nu era nimic de șters.',
  )
}

ruleaza()
  .catch((e) => {
    console.error('Nu am putut șterge parola:', (e as Error).message)
    process.exitCode = 1
  })
  .finally(() => pool.end())
