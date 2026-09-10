/**
 * /utilizatori — conturile personalului. Toate rutele cer rol de administrator.
 *
 * Conturile nu se șterg niciodată: cine a plecat se dezactivează. Ștergerea ar
 * lăsa jurnalul cu operațiuni fără autor și programările cu executant necunoscut
 * — exact informația pentru care există jurnalul.
 */

import { Router, Response } from 'express'
import argon2 from 'argon2'
import pool, { alege, multe, tranzactie, unu, type Executor } from '../lib/db.js'
import { eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii, textDin } from '../lib/filtre.js'
import { adresaCererii, diferenta, scrieJurnal } from '../lib/jurnal.js'
import { ceruteText, verificaFormatEmail, verificaParola } from '../lib/validare.js'
import { requireAuth, requireRole, AuthRequest, cont } from '../middleware/auth.js'
import type { RolUtilizator, UtilizatorPublic } from '../types/database.js'

const router = Router()
router.use(requireAuth, requireRole('administrator'))

/** Coloanele publice, enumerate o dată: `parola_hash` nu are voie să scape. */
const SELECT_CONT = `SELECT id, nume, email, rol, activ, ultima_autentificare,
                            creat_la, actualizat_la
                     FROM utilizator`

const CAMPURI = ['nume', 'email', 'rol', 'activ'] as const

function verificaRol(valoare: unknown): RolUtilizator {
  if (valoare !== 'administrator' && valoare !== 'utilizator') {
    throw eroareValidare('Rolul poate fi doar „administrator” sau „utilizator”.', 'rol')
  }
  return valoare
}

/**
 * Clinica trebuie să rămână cu cel puțin un administrator activ.
 *
 * Fără verificarea asta, ultimul administrator se poate retrograda sau
 * dezactiva pe alt cont și nimeni nu mai poate adăuga utilizatori, schimba
 * prețuri sau citi jurnalul. Reparat se repară doar din baza de date.
 */
async function verificaRamaneUnAdministrator(ex: Executor, exceptaId: string): Promise<void> {
  const [ramasi] = await multe<{ numar: number }>(
    ex,
    `SELECT count(*)::bigint AS numar FROM utilizator
     WHERE rol = 'administrator' AND activ = true AND id <> $1`,
    [exceptaId],
  )
  if ((ramasi?.numar ?? 0) === 0) {
    throw eroareValidare(
      'Trebuie să existe cel puțin un administrator activ. Desemnează altul înainte.',
      'rol',
    )
  }
}

/** Contul dezactivat sau cu parola resetată nu mai poate folosi sesiunile deschise. */
const revocaSesiunile = (ex: Executor, utilizator_id: string) =>
  ex.query(
    `UPDATE sesiune SET revocata_la = now()
     WHERE utilizator_id = $1 AND revocata_la IS NULL`,
    [utilizator_id],
  )

// ---------------------------------------------------------------------------
// GET /utilizatori
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()

  const activ = boolDin(req.query['activ'])
  if (activ !== undefined) unde.egal('activ', activ)

  const q = textDin(req.query['q'])
  if (q) {
    const tipar = unde.marcaj(`%${q}%`)
    unde.brut(`(unaccent(nume) ILIKE unaccent(${tipar}) OR email ILIKE ${tipar})`)
  }

  res.json(await multe<UtilizatorPublic>(
    pool, `${SELECT_CONT} ${unde.where} ORDER BY nume`, unde.values,
  ))
}))

// ---------------------------------------------------------------------------
// POST /utilizatori
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>

  const nume = ceruteText(corp['nume'], 'nume', 'Numele')
  const email = verificaFormatEmail(ceruteText(corp['email'], 'email', 'Adresa de e-mail'))
  const rol = verificaRol(corp['rol'] ?? 'utilizator')
  const parola = verificaParola(corp['parola'])
  const activ = corp['activ'] === undefined ? true : Boolean(corp['activ'])

  // Argon2id — implicit în biblioteca `argon2`, și singurul acceptabil pentru
  // parole. Unicitatea e-mailului o decide indexul `utilizator_email_uk`, nu un
  // SELECT dinainte: între verificare și INSERT încape altă înregistrare.
  const parola_hash = await argon2.hash(parola)

  const utilizator = await tranzactie(async (ex: Executor) => {
    const { rows } = await ex.query<UtilizatorPublic>(
      `INSERT INTO utilizator (nume, email, parola_hash, rol, activ)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nume, email, rol, activ, ultima_autentificare, creat_la, actualizat_la`,
      [nume, email, parola_hash, rol, activ],
    )
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'utilizator',
      entitate_id: rand.id,
      // Parola nu ajunge niciodată în jurnal.
      date_noi: { nume, email, rol, activ },
      adresa_ip: adresaCererii(req),
    })
    return rand
  })

  res.status(201).json(utilizator)
}))

// ---------------------------------------------------------------------------
// PATCH /utilizatori/:id
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>

  const utilizator = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<UtilizatorPublic>(
      ex, `${SELECT_CONT} WHERE id = $1 FOR UPDATE`, [id], 'Utilizatorul',
    )
    const date = alege(corp, CAMPURI)

    if (date['nume'] !== undefined) {
      date['nume'] = ceruteText(date['nume'], 'nume', 'Numele')
    }
    if (date['email'] !== undefined) {
      date['email'] = verificaFormatEmail(
        ceruteText(date['email'], 'email', 'Adresa de e-mail'),
      )
    }

    /*
      Un administrator care își retrage singur rolul sau își dezactivează contul
      rămâne blocat afară, iar clinica poate rămâne fără niciun administrator.
      Ambele se refuză explicit — o eroare citită acum este mai ieftină decât un
      UPDATE manual în baza de date mâine.
    */
    if (date['rol'] !== undefined) {
      const rol = verificaRol(date['rol'])
      if (rol !== inainte.rol) {
        if (id === autor.id) throw eroareValidare('Nu îți poți schimba propriul rol.', 'rol')
        if (inainte.rol === 'administrator') await verificaRamaneUnAdministrator(ex, id)
      }
      date['rol'] = rol
    }

    if (date['activ'] !== undefined) {
      const activ = Boolean(date['activ'])
      if (activ !== inainte.activ) {
        if (!activ && id === autor.id) {
          throw eroareValidare('Nu îți poți dezactiva propriul cont.', 'activ')
        }
        if (!activ && inainte.rol === 'administrator') {
          await verificaRamaneUnAdministrator(ex, id)
        }
        if (!activ) await revocaSesiunile(ex, id)
      }
      date['activ'] = activ
    }

    const coloane = Object.keys(date)
    if (coloane.length === 0) throw eroareValidare('Nu ai trimis niciun câmp de modificat.')

    const { rows } = await ex.query<UtilizatorPublic>(
      `UPDATE utilizator SET ${coloane.map((c, i) => `"${c}" = $${i + 1}`).join(', ')}
       WHERE id = $${coloane.length + 1}
       RETURNING id, nume, email, rol, activ, ultima_autentificare, creat_la, actualizat_la`,
      [...coloane.map((c) => date[c]), id],
    )
    const dupa = rows[0]!

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'utilizator',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }
    return dupa
  })

  res.json(utilizator)
}))

// ---------------------------------------------------------------------------
// POST /utilizatori/:id/reset-parola
// ---------------------------------------------------------------------------

/**
 * Resetarea parolei revocă TOATE sesiunile contului.
 *
 * Motivul obișnuit pentru care se resetează o parolă este că a ajuns unde nu
 * trebuia. O resetare care lasă sesiunile deschise nu rezolvă nimic: cine avea
 * token-ul lucrează mai departe.
 */
router.post('/:id/reset-parola', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const parola = verificaParola((req.body as { parola_noua?: unknown }).parola_noua)
  const parola_hash = await argon2.hash(parola)

  await tranzactie(async (ex: Executor) => {
    await unu(ex, `SELECT id FROM utilizator WHERE id = $1`, [id], 'Utilizatorul')
    await ex.query(`UPDATE utilizator SET parola_hash = $1 WHERE id = $2`, [parola_hash, id])
    await revocaSesiunile(ex, id)

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'modificare',
      entitate: 'utilizator',
      entitate_id: id,
      date_noi: { parola_resetata: true, sesiuni_revocate: true },
      adresa_ip: adresaCererii(req),
    })
  })

  res.status(204).end()
}))

export default router
