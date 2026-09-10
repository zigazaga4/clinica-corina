import { Router, Request, Response } from 'express'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import pool, { tranzactie, unuSauNimic, type Executor } from '../lib/db.js'
import { eroareInterzis, eroareNeautentificat, eroareValidare, ruta } from '../lib/erori.js'
import { adresaCererii, scrieJurnal } from '../lib/jurnal.js'
import { requireAuth, AuthRequest, cont } from '../middleware/auth.js'
import {
  JwtPayload,
  LoginRequest,
  LoginResponse,
  Utilizator,
  UtilizatorPublic,
} from '../types/database.js'

const router = Router()

/** Refresh token-ul trăiește cât sesiunea; access token-ul, cât spune .env. */
const ZILE_SESIUNE = 7

/** Doar SHA-256 al tokenului ajunge în bază: o copie a ei nu impersonează pe nimeni. */
const amprenta = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

/**
 * Emite un access token și spune când expiră.
 *
 * `expira_la` nu este un lux: fără el, interfața află că sesiunea s-a încheiat
 * abia din primul 401, adică în mijlocul unei salvări. Cu el, reînnoiește din
 * timp și operatoarea nu vede niciodată ecranul de autentificare apărând peste
 * un formular pe jumătate completat.
 */
function emiteAcces(utilizator: Utilizator | UtilizatorPublic, sesiune_id: string) {
  const payload: JwtPayload = {
    sub: utilizator.id,
    email: utilizator.email,
    rol: utilizator.rol,
    sesiune_id,
  }
  const access_token = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as jwt.SignOptions['expiresIn'],
  })
  const { exp } = jwt.decode(access_token) as { exp: number }
  return { access_token, expira_la: new Date(exp * 1000).toISOString() }
}

/** Contul așa cum pleacă spre client — fără `parola_hash`, niciodată. */
const public_ = (u: Utilizator): UtilizatorPublic => {
  const { parola_hash: _ascuns, ...restul } = u
  return restul
}

const SELECT_CONT = `SELECT id, nume, email, rol, activ, ultima_autentificare,
                            creat_la, actualizat_la
                     FROM utilizator`

/** POST /auth/login — public */
router.post('/login', ruta(async (req: Request, res: Response) => {
  const corp = req.body as LoginRequest
  const email = typeof corp.email === 'string' ? corp.email.trim() : ''
  // Interfața trimite `parola`; pagina de test livrată cu serverul, `password`.
  const parola = corp.parola ?? corp.password

  if (!email || !parola) {
    throw eroareValidare('Completează adresa de e-mail și parola.', 'email')
  }

  // Contul dezactivat se caută și el: altfel ar fi imposibil de deosebit de
  // unul inexistent, iar omul ar suna crezând că a greșit parola.
  const utilizator = await unuSauNimic<Utilizator>(
    pool,
    `SELECT * FROM utilizator WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  )

  /*
    Același mesaj pentru e-mail inexistent și parolă greșită.

    Mesaje diferite transformă formularul într-un instrument de aflat ce conturi
    există: încerci adrese până una răspunde altfel. Verificarea Argon2 se face
    și când contul lipsește, cu un hash de unică folosință, ca durata
    răspunsului să nu spună nici ea ce a ascuns mesajul.
  */
  const potrivita = utilizator
    ? await argon2.verify(utilizator.parola_hash, parola).catch(() => false)
    : await argon2.verify(await argon2.hash('—'), 'nimic').catch(() => false)

  if (!utilizator || !potrivita) {
    throw eroareValidare('E-mail sau parolă incorecte.', 'parola')
  }
  if (!utilizator.activ) {
    throw eroareInterzis('Acest cont este dezactivat. Contactează administratorul.')
  }

  const refresh_token = crypto.randomBytes(48).toString('hex')
  const expira = new Date(Date.now() + ZILE_SESIUNE * 24 * 60 * 60 * 1000)

  const raspuns = await tranzactie(async (ex: Executor) => {
    const { rows } = await ex.query<{ id: string }>(
      `INSERT INTO sesiune (utilizator_id, token_hash, expira_la, dispozitiv)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [utilizator.id, amprenta(refresh_token), expira, corp.dispozitiv ?? null],
    )
    const sesiune_id = rows[0]!.id

    const { rows: actualizat } = await ex.query<Utilizator>(
      `UPDATE utilizator SET ultima_autentificare = now() WHERE id = $1 RETURNING *`,
      [utilizator.id],
    )

    await scrieJurnal(ex, {
      utilizator_id: utilizator.id,
      actiune: 'autentificare',
      entitate: 'sesiune',
      entitate_id: sesiune_id,
      date_noi: { email: utilizator.email, dispozitiv: corp.dispozitiv ?? null },
      adresa_ip: adresaCererii(req),
    })

    const raspunsLogin: LoginResponse = {
      ...emiteAcces(utilizator, sesiune_id),
      refresh_token,
      utilizator: public_(actualizat[0] ?? utilizator),
    }
    return raspunsLogin
  })

  res.json(raspuns)
}))

/**
 * POST /auth/refresh — public
 *
 * Tokenul de reînnoire NU se rotește. Interfața rulează pe mai multe ferestre
 * și pe telefon; rotit, prima reînnoire l-ar invalida pe cel din mâna
 * celorlalte, iar utilizatorul ar fi dat afară din ele fără motiv. Sesiunea are
 * oricum termen, iar delogarea și resetarea parolei o revocă imediat.
 */
router.post('/refresh', ruta(async (req: Request, res: Response) => {
  const refresh_token = (req.body as { refresh_token?: string }).refresh_token
  if (!refresh_token) throw eroareNeautentificat()

  const rand = await unuSauNimic<UtilizatorPublic & { sesiune_id: string }>(
    pool,
    `SELECT u.id, u.nume, u.email, u.rol, u.activ, u.ultima_autentificare,
            u.creat_la, u.actualizat_la, s.id AS sesiune_id
     FROM sesiune s JOIN utilizator u ON u.id = s.utilizator_id
     WHERE s.token_hash = $1 AND s.revocata_la IS NULL AND s.expira_la > now()`,
    [amprenta(refresh_token)],
  )

  if (!rand || !rand.activ) throw eroareNeautentificat()

  const { sesiune_id, ...utilizator } = rand
  const raspuns: LoginResponse = {
    ...emiteAcces(utilizator, sesiune_id),
    refresh_token,
    utilizator,
  }
  res.json(raspuns)
}))

/** GET /auth/eu — orice rol. Cine este în spatele token-ului curent. */
router.get('/eu', requireAuth, (req: AuthRequest, res: Response) => {
  res.json(cont(req))
})

/** POST /auth/logout — orice rol. Revocă sesiunea curentă. */
router.post('/logout', requireAuth, ruta(async (req: AuthRequest, res: Response) => {
  const refresh_token = (req.body as { refresh_token?: string } | undefined)?.refresh_token

  // Se revocă atât sesiunea din token-ul de acces, cât și cea a refresh
  // token-ului trimis. De obicei sunt aceeași; când nu sunt, a rămâne cu una
  // vie ar însemna o delogare care nu deloghează.
  await pool.query(
    `UPDATE sesiune SET revocata_la = now()
     WHERE revocata_la IS NULL AND (id = $1 OR token_hash = $2)`,
    [req.user!.sesiune_id, refresh_token ? amprenta(refresh_token) : null],
  )

  res.status(204).end()
}))

export default router
