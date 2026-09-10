import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import pool, { unuSauNimic } from '../lib/db.js'
import { eroareInterzis, eroareNeautentificat, ruta } from '../lib/erori.js'
import { JwtPayload, RolUtilizator, UtilizatorPublic } from '../types/database.js'

export interface AuthRequest extends Request {
  user?: JwtPayload
  /** Contul din spatele token-ului, așa cum arată ACUM în bază. */
  cont?: UtilizatorPublic
}

/**
 * Cererea vine de la un cont care există, este activ și are sesiunea deschisă.
 *
 * Semnătura JWT dovedește doar că token-ul a fost emis de noi și nu a expirat.
 * Nu spune nimic despre ce s-a întâmplat între timp: contul poate fi
 * dezactivat, iar sesiunea revocată printr-o delogare sau printr-o resetare de
 * parolă. Un token valid criptografic ar deschide mai departe toate ușile —
 * ceea ce face din „dezactivează contul” un buton fără efect până la expirare.
 *
 * De aceea starea se citește din bază la fiecare cerere. Este un SELECT pe
 * cheie primară, servit din cache-ul PostgreSQL; prețul lui este neglijabil
 * față de a lăsa un cont concediat să lucreze încă opt ore.
 */
export const requireAuth = ruta(async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw eroareNeautentificat('Lipsește antetul de autorizare.')
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as JwtPayload
  } catch {
    throw eroareNeautentificat()
  }

  const rand = await unuSauNimic<UtilizatorPublic & { sesiune_valida: boolean }>(
    pool,
    `SELECT u.id, u.nume, u.email, u.rol, u.activ, u.ultima_autentificare,
            u.creat_la, u.actualizat_la,
            (s.id IS NOT NULL AND s.revocata_la IS NULL AND s.expira_la > now())
              AS sesiune_valida
     FROM utilizator u
     LEFT JOIN sesiune s ON s.id = $2
     WHERE u.id = $1`,
    [payload.sub, payload.sesiune_id],
  )

  if (!rand || !rand.sesiune_valida) throw eroareNeautentificat()
  if (!rand.activ) {
    throw eroareInterzis('Acest cont este dezactivat. Contactează administratorul.')
  }

  const { sesiune_valida: _ignorat, ...cont } = rand
  req.user = payload
  req.cont = cont
  next()
})

export function requireRole(role: RolUtilizator) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    // Rolul se ia din bază, nu din token: un cont retrogradat acum cinci minute
    // are încă în buzunar un token care spune „administrator”.
    if (!req.cont) throw eroareNeautentificat()
    if (req.cont.rol !== role) {
      throw eroareInterzis('Această operațiune este permisă doar administratorului.')
    }
    next()
  }
}

/** Contul autentificat, pentru rutele montate în spatele lui `requireAuth`. */
export function cont(req: AuthRequest): UtilizatorPublic {
  if (!req.cont) throw eroareNeautentificat()
  return req.cont
}
