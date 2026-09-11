/**
 * Verificări despre conturile personalului, folosite de mai multe rute.
 *
 * Programarea și notița cer amândouă același lucru despre executant: să
 * existe și să fie activ. Scrisă o dată, regula nu poate ajunge să difere
 * între cele două — un cont dezactivat refuzat la programare și acceptat la
 * notiță ar fi exact genul de nepotrivire pe care nimeni nu o caută.
 */

import { unu, type Executor } from './db.js'
import { eroareValidare } from './erori.js'
import type { Utilizator } from '../types/database.js'

export async function executantulCerut(ex: Executor, executant_id: unknown): Promise<Utilizator> {
  const executant = await unu<Utilizator>(
    ex, `SELECT * FROM utilizator WHERE id = $1`, [executant_id], 'Executantul',
  )
  if (!executant.activ) {
    throw eroareValidare('Contul selectat ca executant este dezactivat.', 'executant_id')
  }
  return executant
}
