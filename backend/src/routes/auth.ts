import { Router, Request, Response } from 'express'
import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import pool, { tranzactie, unuSauNimic, type Executor } from '../lib/db.js'
import { eroareInterzis, eroareNeautentificat, eroareValidare, ruta } from '../lib/erori.js'
import { adresaCererii, scrieJurnal } from '../lib/jurnal.js'
import { cheieAdresa, LIMITA_ADRESA, LIMITA_CONT, limitator } from '../lib/limitare.js'
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

// ---------------------------------------------------------------------------
// Limitarea încercărilor de autentificare
// ---------------------------------------------------------------------------

/*
  Douăzeci de parole greșite la rând pe contul de administrator treceau toate,
  fiecare într-o treime de secundă, fără ca nimic să încetinească. Argon2 face
  ghicitul scump, dar nu îl oprește; o singură parolă slabă a cuiva din clinică
  este de ajuns dacă atacatorul are voie să încerce la nesfârșit.

  Numărătoarea se ține pe PERECHEA adresă + cont, nu pe una dintre ele:

  — Doar pe adresă e prea gros. Toată clinica iese în internet printr-o singură
    adresă publică (NAT), deci limita ar fi împărțită de zece oameni: ori atât
    de largă încât un atac încape lejer sub ea, ori recepția rămâne pe dinafară
    într-o dimineață în care trei persoane și-au greșit parola de două ori.

  — Doar pe cont e o cădere de serviciu oferită pe tavă. Oricine, de oriunde,
    ar ține contul de administrator încuiat la nesfârșit trimițând câteva parole
    greșite la fiecare fereastră — fix pe dos față de ce vrem.

  Pe pereche, cel care ghicește are nevoie de o adresă nouă la fiecare pachet de
  încercări, iar clinica nu poate fi încuiată de afară: un atac de pe internet
  își consumă propria găleată, cea a adresei clinicii rămâne întreagă. Și
  înăuntru, colega care greșește parola nu blochează pe nimeni altcineva —
  fiecare cont are găleata lui.

  Al doilea limitator, mai larg, ține minte doar adresa. Fără el, cel care
  încearcă o singură parolă („parola123”) pe o listă lungă de adrese de e-mail
  ar avea găleată nouă la fiecare rând și n-ar atinge niciodată vreo limită.

  Ce rămâne descoperit, conștient: un atac împrăștiat pe multe adrese IP,
  împotriva unui singur cont. Contra lui ar trebui blocat contul indiferent de
  unde vine cererea — adică exact butonul de încuiat clinica, pus la îndemâna
  oricui de pe internet. Alegem să lăsăm aici apărarea pe seama Argon2 și a
  parolelor: douăsprezece încercări la zece minute de pe fiecare adresă înseamnă
  că ar trebui mii de adrese, luni la rând, pentru un dicționar de mărime
  serioasă. Ușa pe care o poate trânti un străin ar fi costat mai mult.

  Nimic din toate acestea nu blochează pe nimeni definitiv: fereastra expiră
  singură, fără intervenția administratorului. Găleata stă în memoria
  procesului, deci se golește și la repornire; dacă pm2 ajunge vreodată să
  ruleze serverul în mai multe copii (`cluster`), fiecare copie va număra
  separat și limitele efective se înmulțesc cu numărul lor — atunci e nevoie de
  un store comun (Redis), nu de alte cifre aici.

  Unealta însăși (`limitator`, fereastra, limitele) stă în `lib/limitare.ts`,
  fiindcă o folosește și parola statisticilor. Cheile de mai jos sunt ale
  autentificării.
*/

/** Adresa de e-mail din corpul cererii, normalizată ca la căutarea din bază. */
const contulCerut = (req: Request): string => {
  const email = (req.body as LoginRequest | undefined)?.email
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

const cheieCont = (req: Request): string => `${cheieAdresa(req)}|${contulCerut(req)}`

// La reînnoire nu există e-mail; amprenta jetonului ține locul contului, ca o
// fereastră rămasă deschisă cu un jeton mort să nu consume găleata întregii
// clinici. Amprenta, nu jetonul: cheile stau în memorie și ajung în depanare.
const cheieJeton = (req: Request): string => {
  const jeton = (req.body as { refresh_token?: string } | undefined)?.refresh_token
  return `${cheieAdresa(req)}|${typeof jeton === 'string' && jeton ? amprenta(jeton) : ''}`
}

const limitaAutentificareAdresa = limitator(LIMITA_ADRESA, cheieAdresa)
const limitaAutentificareCont = limitator(LIMITA_CONT, cheieCont)

const limitaReinnoireAdresa = limitator(LIMITA_ADRESA, cheieAdresa)
const limitaReinnoireJeton = limitator(LIMITA_CONT, cheieJeton)

/*
  Hash-ul de umplutură pentru adresele care nu există în bază.

  Se calculează O SINGURĂ DATĂ, la pornire. Varianta dinainte îl calcula la
  fiecare cerere — „hash + verify” — adică dublul muncii de pe drumul unui cont
  existent, care face doar „verify”. Diferența, sute de milisecunde, se măsoară
  din afară cu un cronometru și spunea exact ce ascundea mesajul: dacă adresa
  este sau nu un cont. Parametrii sunt cei impliciți ai bibliotecii, aceiași cu
  care se scriu parolele reale, ca cele două drumuri să coste la fel.
*/
const hashFantoma = argon2.hash(crypto.randomBytes(32).toString('hex'))
// Promisiunea pornește la import, înainte să o aștepte cineva: fără `catch`, o
// eventuală eroare ar apărea drept respingere netratată, la pornire, fără
// legătură vizibilă cu locul acesta.
hashFantoma.catch(() => undefined)

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

/** POST /auth/login — public, cu limitare a încercărilor eșuate */
router.post('/login', limitaAutentificareAdresa, limitaAutentificareCont, ruta(async (req: Request, res: Response) => {
  const corp = req.body as LoginRequest
  const email = typeof corp.email === 'string' ? corp.email.trim() : ''
  // Interfața trimite `parola`; pagina de test livrată cu serverul, `password`.
  const parola = corp.parola ?? corp.password

  if (!email || !parola) {
    throw eroareValidare('Completează numele și parola.', 'email')
  }

  /*
    Se intră cu numele, nu cu adresa de e-mail.

    La recepție lucrează două persoane care se știu pe nume, iar aplicația se
    deschide de zeci de ori pe zi, inclusiv de pe telefon. „Irina” se scrie mai
    repede și mai fără greșeală decât o adresă, mai ales pe o tastatură de
    telefon, unde o literă ratată într-un „@clinica.ro” arată exact ca o parolă
    greșită.

    Adresa rămâne acceptată în paralel: conturile mai vechi au fost create cu
    ea, jurnalul o poartă, iar cine o tastează din obișnuință nu trebuie să
    primească un refuz. Potrivirea pe e-mail are întâietate în sortare, ca o
    adresă scrisă întreagă să nu poată fi furată de un cont care se NUMEȘTE la
    fel — iar indexul `utilizator_nume_uk` face ca numele să fie, la rândul
    lui, unic; fără el „cine e Irina?” ar fi avut două răspunsuri.
  */
  // Contul dezactivat se caută și el: altfel ar fi imposibil de deosebit de
  // unul inexistent, iar omul ar suna crezând că a greșit parola.
  const utilizator = await unuSauNimic<Utilizator>(
    pool,
    `SELECT * FROM utilizator
      WHERE lower(email) = lower($1)
         OR lower(btrim(nume)) = lower(btrim($1))
      ORDER BY (lower(email) = lower($1)) DESC
      LIMIT 1`,
    [email],
  )

  /*
    Același mesaj pentru e-mail inexistent și parolă greșită.

    Mesaje diferite transformă formularul într-un instrument de aflat ce conturi
    există: încerci adrese până una răspunde altfel. Verificarea Argon2 se face
    și când contul lipsește, pe hash-ul-fantomă de mai sus, ca durata
    răspunsului să nu spună nici ea ce a ascuns mesajul.
  */
  const potrivita = utilizator
    ? await argon2.verify(utilizator.parola_hash, parola).catch(() => false)
    : await hashFantoma.then((h) => argon2.verify(h, parola)).catch(() => false)

  if (!utilizator || !potrivita) {
    throw eroareValidare('Nume sau parolă incorecte.', 'parola')
  }

  /*
    Contul dezactivat își păstrează mesajul limpede, dar îl primește DOAR cine a
    dovedit deja că știe parola.

    Ordinea nu este întâmplătoare și nu trebuie „curățată” mutând verificarea
    lui `activ` mai sus, lângă căutarea din bază: un 403 dat înaintea parolei ar
    răspunde altfel la o adresă reală decât la una inventată, iar cine trece o
    listă de adrese prin formular ar afla din chiar mesajele noastre care dintre
    ele sunt conturi. Conturile dezactivate sunt cea mai bună pradă din listă —
    foști angajați, pe care nu-i mai supraveghează nimeni și ale căror parole nu
    se mai schimbă.

    Cum stă acum, cel care vede 403 știa deja parola, deci nu a aflat nimic nou.
    Iar omul dezactivat pe bune — cazul obișnuit, de departe cel mai frecvent —
    nu rămâne să-și încerce parola de zece ori crezând că a greșit-o: i se spune
    din prima să sune la administrator. A șterge mesajul l-ar trimite exact în
    bucla de încercări pe care o oprește limitatorul de mai sus, cu un blocaj
    la capăt și un telefon nervos la firmă.
  */
  if (!utilizator.activ) {
    throw eroareInterzis('Acest cont este dezactivat. Contactează administratorul.')
  }

  /*
    Parola bună șterge încercările greșite de dinainte, pe cont.

    Cine a nimerit parola a dovedit că este contul lui; a-l lăsa cu trei
    încercări consumate până la capătul ferestrei nu apără de nimic, dar îl
    poate opri la a patra tastare greșită de peste zece minute — în plină zi de
    lucru, la o operatoare care oricum se grăbește. Numărătoarea pe adresă NU se
    șterge: dacă s-ar șterge, cineva cu un singur cont valid ar putea reseta la
    nesfârșit contorul care există tocmai ca să prindă încercarea unei parole pe
    o listă lungă de adrese.
  */
  limitaAutentificareCont.resetKey(cheieCont(req))

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
router.post('/refresh', limitaReinnoireAdresa, limitaReinnoireJeton, ruta(async (req: Request, res: Response) => {
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
