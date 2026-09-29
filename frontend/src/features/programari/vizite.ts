import { marcajSedinta } from '@/features/tratamente/ProgresTratament'
import type { ProgramareDetaliu, Uuid } from '@/domain/types'
import { sumaTotal } from '@/lib/money'

/*
  O programare din calendar, cu toate serviciile ei.

  În bază, fiecare serviciu este un rând `programare` — cu prețul, tratamentul
  și plata lui. Rândurile aceleiași programări au același `vizita_id` și împart
  clientul, persoana, intervalul, starea și nota. Calendarul, fereastra de
  detaliu și formularul le arată ca pe un singur lucru; aici se strâng la loc.

  Primul rând dintr-un grup ține locul programării întregi — ora, clientul,
  persoana, starea sunt oricum aceleași pe toate.
*/

/** Rândurile grupate pe programare, în ordinea primei apariții; în grup, în ordinea primită. */
export function grupeazaPeProgramari(randuri: readonly ProgramareDetaliu[]): ProgramareDetaliu[][] {
  const grupuri = new Map<Uuid, ProgramareDetaliu[]>()
  for (const rand of randuri) {
    const grup = grupuri.get(rand.vizita_id)
    if (grup) grup.push(rand)
    else grupuri.set(rand.vizita_id, [rand])
  }
  return [...grupuri.values()]
}

/** Câte programări sunt între rânduri — nu câte servicii. */
export function numarProgramari(randuri: readonly ProgramareDetaliu[]): number {
  return new Set(randuri.map((r) => r.vizita_id)).size
}

/** Cât costă toată programarea: suma serviciilor ei. */
export function pretulProgramarii(servicii: readonly ProgramareDetaliu[]): number {
  return sumaTotal(servicii.map((s) => s.pret))
}

/**
 * Ce se face la programare, pe un rând: „IPL axile 3/6 + Manichiură clasică”.
 * Marcajul de ședință stă lângă serviciul lui — o programare poate avea
 * ședințe din două tratamente deodată.
 */
export function denumireaServiciilor(servicii: readonly ProgramareDetaliu[]): string {
  return servicii
    .map((s) => {
      const marcaj = marcajSedinta(s)
      return marcaj ? `${s.articol_denumire} ${marcaj}` : s.articol_denumire
    })
    .join(' + ')
}
