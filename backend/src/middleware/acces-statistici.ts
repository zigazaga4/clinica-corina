/**
 * Ușa Statisticilor: parola separată și deblocarea care rezultă din ea.
 *
 * Contul spune CINE lucrează în aplicație; parola statisticilor spune dacă
 * acel om are voie să vadă banii clinicii. Sunt două întrebări diferite, cu
 * două parole diferite — contul de la recepție îl folosesc, în fapt, mai mulți
 * oameni, iar încasările, cheltuielile și profitul nu sunt treaba tuturor.
 *
 * Parola bună se schimbă pe un jeton scurt, trimis apoi în antetul
 * `X-Acces-Statistici` la fiecare cerere de acolo. Jetonul este legat:
 *
 *   — de CONT și de SESIUNE: găsit pe alt calculator, sau după o delogare, nu
 *     deschide nimic;
 *   — de PAROLĂ: poartă o amprentă a hash-ului ei, deci schimbarea parolei
 *     închide pe loc toate statisticile deschise, peste tot;
 *   — de TIMP: expiră după o oră, ca un ecran uitat deschis la recepție să se
 *     încuie singur.
 *
 * Se semnează cu o cheie DERIVATĂ din `JWT_SECRET`, nu cu ea însăși. Altfel
 * jetonul statisticilor ar fi trecut și drept jeton de acces al aplicației —
 * are și el `sub` și `sesiune_id` — iar cele două uși ar fi avut aceeași cheie.
 */

import crypto from 'crypto'
import type { NextFunction, Response } from 'express'
import jwt from 'jsonwebtoken'
import pool, { unuSauNimic, type Executor } from '../lib/db.js'
import { EroareApi, eroareNeautentificat, ruta } from '../lib/erori.js'
import type { AuthRequest } from './auth.js'

/** Cât ține o deblocare. Pagina se încuie oricum când omul pleacă din ea. */
const DURATA = '1h'

export const ANTET_ACCES = 'x-acces-statistici'

/** Câmpul din eroare după care interfața știe să arate din nou ușa. */
export const CAMP_ACCES = 'acces_statistici'

const SCOP = 'statistici'

interface JetonStatistici {
  scop: typeof SCOP
  sub: string
  sesiune_id: string
  /** Amprenta parolei cu care s-a deblocat. */
  v: string
  exp?: number
}

/** Cheia jetoanelor statisticilor — derivată, ca să nu fie și cheia aplicației. */
function cheie(): Buffer {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET!)
    .update('acces-statistici')
    .digest()
}

/** Amprenta scurtă a parolei curente: se schimbă odată cu ea. */
function versiune(parola_hash: string): string {
  return crypto.createHash('sha256').update(parola_hash).digest('hex').slice(0, 16)
}

export function eroareAccesStatistici(
  mesaj = 'Statisticile sunt încuiate. Scrie parola lor ca să le vezi.',
): EroareApi {
  // 403, nu 401: sesiunea aplicației e în regulă. Un 401 ar trimite interfața
  // să-și reînnoiască sesiunea și, la al doilea, s-o delogheze de tot.
  return new EroareApi('interzis', mesaj, { camp: CAMP_ACCES })
}

export interface RandParolaStatistici {
  parola_hash: string
  actualizat_de: string | null
  actualizat_la: Date
}

/** Parola aleasă, sau `null` dacă nu a ales-o încă nimeni. */
export function parolaStatistici(
  ex: Executor,
  cuBlocare = false,
): Promise<RandParolaStatistici | null> {
  return unuSauNimic<RandParolaStatistici>(
    ex,
    `SELECT parola_hash, actualizat_de, actualizat_la FROM parola_statistici
     WHERE id ${cuBlocare ? 'FOR UPDATE' : ''}`,
  )
}

/**
 * Deblocarea pe care o primește interfața: jetonul, momentul în care expiră
 * și cât ține.
 *
 * `durata_secunde` este cea după care se ghidează ecranul, nu `expira_la`: un
 * calculator de la recepție cu ceasul o oră înainte ar fi socotit altfel
 * deblocarea deja expirată și s-ar fi încuiat imediat după fiecare parolă.
 * Durata se numără de pe ceasul lui, din clipa în care a primit răspunsul.
 */
export function emiteAccesStatistici(
  utilizator_id: string,
  sesiune_id: string,
  parola_hash: string,
): { jeton: string; expira_la: string; durata_secunde: number } {
  const continut: JetonStatistici = {
    scop: SCOP,
    sub: utilizator_id,
    sesiune_id,
    v: versiune(parola_hash),
  }
  const jeton = jwt.sign(continut, cheie(), { expiresIn: DURATA })
  const { exp, iat } = jwt.decode(jeton) as { exp: number; iat: number }
  return { jeton, expira_la: new Date(exp * 1000).toISOString(), durata_secunde: exp - iat }
}

/**
 * Verifică deblocarea din cerere și spune, dacă lipsește, de ce.
 *
 * Parola curentă se citește la fiecare cerere — un rând, pe cheie primară —
 * ca o parolă schimbată acum un minut să închidă ce a deschis cea veche.
 */
async function verificaAccesStatistici(req: AuthRequest): Promise<void> {
  if (!req.cont || !req.user) throw eroareNeautentificat()

  const antet = req.headers[ANTET_ACCES]
  const jeton = typeof antet === 'string' ? antet : ''
  if (!jeton) throw eroareAccesStatistici()

  let continut: JetonStatistici
  try {
    continut = jwt.verify(jeton, cheie()) as JetonStatistici
  } catch {
    throw eroareAccesStatistici('Statisticile s-au încuiat singure după o oră. Scrie din nou parola.')
  }

  if (
    continut.scop !== SCOP ||
    continut.sub !== req.cont.id ||
    continut.sesiune_id !== req.user.sesiune_id
  ) {
    throw eroareAccesStatistici()
  }

  const parola = await parolaStatistici(pool)
  if (!parola || versiune(parola.parola_hash) !== continut.v) {
    throw eroareAccesStatistici('Parola statisticilor s-a schimbat. Scrie parola nouă.')
  }
}

/**
 * Lasă cererea să treacă doar cu o deblocare valabilă.
 *
 * Se montează DUPĂ `requireAuth`: întâi contul, apoi parola statisticilor.
 */
export const cereAccesStatistici = ruta(
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    await verificaAccesStatistici(req)
    next()
  },
)

/**
 * Are cererea statisticile deblocate? Pentru rutele care NU se încuie de tot,
 * dar ascund bucata cu bani — jurnalul, de pildă.
 */
export function areAccesStatistici(req: AuthRequest): Promise<boolean> {
  return verificaAccesStatistici(req).then(
    () => true,
    () => false,
  )
}
