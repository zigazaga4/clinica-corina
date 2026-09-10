/**
 * Jurnalul operațiunilor (§3, tabela `jurnal_operatiuni`).
 *
 * Contractul cere la art. 3.1.D „jurnal al operațiunilor asupra datelor, cu
 * utilizatorul și momentul efectuării”, iar specificația precizează că
 * jurnalul este append-only: fără UPDATE, fără DELETE.
 *
 * Pe server, jurnalizarea se face în aceeași tranzacție cu operațiunea. Aici
 * se apelează imediat după mutație, din același loc, ca să nu existe drum prin
 * care o modificare să scape neînregistrată.
 */

import type { ActiuneJurnal, JurnalOperatiune, Uuid } from '@/domain/types'
import { acum } from '@/lib/dates'
import { magazin } from './store'

export interface IntrareJurnal {
  utilizator_id: Uuid | null
  actiune: ActiuneJurnal
  /** Numele tabelei afectate, exact ca în bază: 'client', 'programare', … */
  entitate: string
  entitate_id?: Uuid | null
  date_vechi?: Record<string, unknown> | null
  date_noi?: Record<string, unknown> | null
}

/**
 * Adresa IP este `inet` în bază și o completează serverul din conexiune.
 * Clientul nu o cunoaște, deci rămâne NULL în datele demo — a inventa una ar
 * face jurnalul să pară mai credibil decât este.
 */
export function scrieJurnal(intrare: IntrareJurnal): JurnalOperatiune {
  const rand: JurnalOperatiune = {
    id: magazin.urmatorId_jurnal++,
    utilizator_id: intrare.utilizator_id,
    actiune: intrare.actiune,
    entitate: intrare.entitate,
    entitate_id: intrare.entitate_id ?? null,
    date_vechi: intrare.date_vechi ?? null,
    date_noi: intrare.date_noi ?? null,
    adresa_ip: null,
    creat_la: acum(),
  }
  magazin.jurnal_operatiuni.push(rand)
  return rand
}

/**
 * Reține DOAR câmpurile modificate, așa cum cere specificația pentru
 * `date_vechi` / `date_noi`.
 *
 * Un jurnal care copiază rândul întreg la fiecare salvare devine imposibil de
 * citit: cine caută „cine a schimbat telefonul clientului” ar trebui să
 * compare manual două obiecte de cincisprezece câmpuri. Coloanele tehnice
 * (`actualizat_la`) se exclud — se modifică la orice UPDATE și nu spun nimic.
 */
export function diferenta<T extends Record<string, unknown>>(
  inainte: T,
  dupa: T,
): { date_vechi: Record<string, unknown>; date_noi: Record<string, unknown> } | null {
  const ignorate = new Set(['actualizat_la'])
  const date_vechi: Record<string, unknown> = {}
  const date_noi: Record<string, unknown> = {}
  let modificari = 0

  for (const cheie of Object.keys(dupa)) {
    if (ignorate.has(cheie)) continue
    const v = inainte[cheie]
    const n = dupa[cheie]
    if (!egale(v, n)) {
      date_vechi[cheie] = v ?? null
      date_noi[cheie] = n ?? null
      modificari++
    }
  }

  return modificari > 0 ? { date_vechi, date_noi } : null
}

/** Comparație suficientă pentru valorile scalare și tablourile din rânduri. */
function egale(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/** Instantaneu al unui rând pentru `date_noi` la creare. */
export function instantaneu<T extends Record<string, unknown>>(rand: T): Record<string, unknown> {
  const { actualizat_la: _ignorat, ...restul } = rand
  return restul as Record<string, unknown>
}
