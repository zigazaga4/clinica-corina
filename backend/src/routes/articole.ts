/**
 * /articole — nomenclatorul unic de servicii ȘI produse.
 *
 * Citirea este pentru toată lumea: fără ea nu se poate face nici o programare.
 * Scrierea este a administratorului — prețul de listă din nomenclator este
 * punctul de plecare al fiecărei sume încasate.
 */

import { Router, Response } from 'express'
import pool, { alege, dynamicInsert, dynamicUpdate, multe, tranzactie, unu, type Executor } from '../lib/db.js'
import { categoriaFolosita } from '../lib/categorii.js'
import { eroareConflict, eroareValidare, ruta } from '../lib/erori.js'
import { boolDin, Conditii, textDin } from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import {
  ceruteText,
  numarCerut,
  textOptional,
  verificaDurataArticol,
  verificaNumarSedinte,
  verificaPret,
  verificaTipArticol,
} from '../lib/validare.js'
import { requireAuth, requireRole, AuthRequest, cont } from '../middleware/auth.js'
import type { Articol, TipArticol } from '../types/database.js'

const router = Router()
router.use(requireAuth)

const CAMPURI = ['tip', 'denumire', 'durata_minute', 'pret_lista', 'activ', 'numar_sedinte', 'categorie'] as const

/**
 * CONSTRAINT articol_categorie_ck: doar produsele au categorie — lista de
 * prețuri din care fac parte („Produse clienți”, „Produse colaboratori”).
 *
 * Lipsă sau goală = fără categorie. Ca durata pe un produs, o categorie pusă
 * pe un serviciu se refuză, nu se curăță în tăcere. Scrisă altfel decât una
 * existentă doar prin majuscule, se lipește de aceea.
 */
async function categoriaPentru(ex: Executor, tip: TipArticol, trimisa: unknown): Promise<string | null> {
  const categorie = textOptional(trimisa, 'categorie', 'Categoria')
  if (categorie === null) return null
  if (tip !== 'produs') throw eroareValidare('Doar produsele au categorie.', 'categorie')
  return categoriaFolosita(ex, 'articol', categorie)
}

/**
 * CONSTRAINT articol_sedinte_ck: un serviciu se face în cel puțin o ședință,
 * un produs în exact una. Lipsa înseamnă „o singură venire”; o valoare pusă
 * pe un produs se refuză, nu se curăță în tăcere — ca la durată.
 */
function numarSedintePentru(tip: TipArticol, trimis: unknown, implicit = 1): number {
  if (trimis === undefined || trimis === null) return tip === 'produs' ? 1 : implicit
  const n = verificaNumarSedinte(trimis)
  if (tip === 'produs' && n !== 1) {
    throw eroareValidare('Un produs nu se face în ședințe.', 'numar_sedinte')
  }
  return n
}

// GET /articole?tip=serviciu&activ=true&q=
router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()

  unde.egal('tip', textDin(req.query['tip']))
  const activ = boolDin(req.query['activ'])
  if (activ !== undefined) unde.egal('activ', activ)

  const q = textDin(req.query['q'])
  if (q) unde.brut(`unaccent(denumire) ILIKE unaccent(${unde.marcaj(`%${q}%`)})`)

  // Rândul întreg, nu o selecție de coloane: interfața primește `Articol` așa
  // cum îl declară tipul ei, cu tot cu `creat_la` și `actualizat_la`.
  // Serviciile înaintea produselor — ordinea în care se caută în formular.
  res.json(await multe<Articol>(
    pool, `SELECT * FROM articol ${unde.where} ORDER BY tip, denumire`, unde.values,
  ))
}))

// POST /articole — doar administrator
router.post('/', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const corp = req.body as Record<string, unknown>

  const tip = verificaTipArticol(corp['tip'])
  const denumire = ceruteText(corp['denumire'], 'denumire', 'Denumirea')
  const pret_lista = verificaPret(numarCerut(corp['pret_lista'], 'pret_lista', 'Prețul'))

  /*
    Durata se verifică așa cum a fost TRIMISĂ, nu după normalizare.

    Baza respinge un INSERT cu `tip='produs'` și `durata_minute` completată
    (`articol_durata_ck`), deci și API-ul trebuie să-l respingă. Normalizată
    tăcut la NULL, greșeala ar trece aici și ar reapărea la prima migrare sau la
    primul import — fără nimeni care să-și amintească de unde vine.
  */
  const trimisa = corp['durata_minute']
  const durata_minute = trimisa === undefined || trimisa === null ? null : Number(trimisa)
  verificaDurataArticol(tip, durata_minute)
  const numar_sedinte = numarSedintePentru(tip, corp['numar_sedinte'])

  const articol = await tranzactie(async (ex: Executor) => {
    const q = dynamicInsert('articol', {
      tip,
      denumire,
      durata_minute: tip === 'serviciu' ? durata_minute : null,
      pret_lista,
      activ: corp['activ'] === undefined ? true : Boolean(corp['activ']),
      numar_sedinte,
      categorie: await categoriaPentru(ex, tip, corp['categorie']),
    })
    const { rows } = await ex.query<Articol>(q.text, q.values)
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'articol',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })
    return rand
  })

  res.status(201).json(articol)
}))

// PATCH /articole/:id — doar administrator
router.patch('/:id', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!
  const corp = req.body as Record<string, unknown>

  const articol = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Articol>(
      ex, `SELECT * FROM articol WHERE id = $1 FOR UPDATE`, [id], 'Articolul',
    )
    const date = alege(corp, CAMPURI)

    const tip = date['tip'] === undefined ? inainte.tip : verificaTipArticol(date['tip'])

    /*
      Schimbarea tipului trage după ea și durata: un serviciu devenit produs ar
      rămâne altfel cu o durată care încalcă `articol_durata_ck`. Excepția este
      durata trimisă EXPLICIT pe un produs — aceea este o greșeală a
      apelantului, nu o valoare de curățat, și se semnalează ca atare.
    */
    if (tip === 'produs' && date['durata_minute'] != null) {
      verificaDurataArticol('produs', Number(date['durata_minute']))
    }
    const durata =
      tip === 'serviciu'
        ? (date['durata_minute'] !== undefined
            ? (date['durata_minute'] === null ? null : Number(date['durata_minute']))
            : inainte.durata_minute)
        : null
    verificaDurataArticol(tip, durata)

    date['tip'] = tip
    date['durata_minute'] = durata
    // Ca durata: un serviciu devenit produs coboară la o singură ședință.
    date['numar_sedinte'] = numarSedintePentru(tip, date['numar_sedinte'], inainte.numar_sedinte)
    // Și categoria: un produs devenit serviciu o pierde; trimisă explicit pe un
    // serviciu, se refuză.
    if (date['categorie'] !== undefined) {
      date['categorie'] = await categoriaPentru(ex, tip, date['categorie'])
    } else if (tip !== 'produs') {
      date['categorie'] = null
    }
    if (date['denumire'] !== undefined) {
      date['denumire'] = ceruteText(date['denumire'], 'denumire', 'Denumirea')
    }
    if (date['pret_lista'] !== undefined) {
      date['pret_lista'] = verificaPret(numarCerut(date['pret_lista'], 'pret_lista', 'Prețul'))
    }
    if (date['activ'] !== undefined) date['activ'] = Boolean(date['activ'])

    const q = dynamicUpdate('articol', date, 'id', id)
    const { rows } = await ex.query<Articol>(q.text, q.values)
    const dupa = rows[0]!

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'articol',
        entitate_id: id,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }
    return dupa
  })

  res.json(articol)
}))

/**
 * De ce nu se poate șterge un articol — cu numerele, ca recepția să vadă că
 * nu e o defecțiune. Același text în implementarea în memorie
 * (frontend/src/api/memory/constraints.ts).
 */
function mesajArticolFolosit(
  tip: TipArticol,
  folosit: { programari: number; linii: number; tratamente: number },
): string {
  const parti: string[] = []
  if (folosit.linii > 0) parti.push(`pe ${folosit.linii} ${folosit.linii === 1 ? 'bon' : 'bonuri'}`)
  if (folosit.programari > 0) {
    parti.push(`în ${folosit.programari} ${folosit.programari === 1 ? 'programare' : 'programări'}`)
  }
  if (folosit.tratamente > 0) {
    parti.push(`în ${folosit.tratamente} ${folosit.tratamente === 1 ? 'tratament' : 'tratamente'}`)
  }
  const cine = tip === 'produs' ? 'Produsul' : 'Serviciul'
  return (
    `${cine} apare ${parti.join(', ')} și nu poate fi șters — istoricul are nevoie de el. ` +
    'Dezactivează-l în schimb: dispare din liste, iar rândurile vechi își păstrează denumirea.'
  )
}

/**
 * DELETE /articole/:id — doar administrator. Butonul „Șterge” din Nomenclator.
 *
 * Doar pentru rândurile nefolosite — create din greșeală sau niciodată
 * vândute. Cel folosit se DEZACTIVEAZĂ (`activ = false`), ca programările,
 * tratamentele și bonurile vechi să-și păstreze denumirea: cheile ON DELETE
 * RESTRICT îl refuză oricum, iar mesajul spune ce e de făcut în schimb.
 */
router.delete('/:id', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']!

  await tranzactie(async (ex: Executor) => {
    const articol = await unu<Articol>(
      ex, `SELECT * FROM articol WHERE id = $1`, [id], 'Articolul',
    )

    // Numărate dinainte, ca mesajul să spună CE anume îl reține. Cheile
    // RESTRICT ar refuza oricum ștergerea, dar cu un 23503 din care nimeni nu
    // înțelege dacă e vorba de o programare de anul trecut sau de un bon.
    const [folosit] = await multe<{ programari: number; linii: number; tratamente: number }>(
      ex,
      `SELECT (SELECT count(*) FROM programare    WHERE articol_id = $1) AS programari,
              (SELECT count(*) FROM vanzare_linie WHERE articol_id = $1) AS linii,
              (SELECT count(*) FROM tratament     WHERE articol_id = $1) AS tratamente`,
      [id],
    )
    const programari = folosit?.programari ?? 0
    const linii = folosit?.linii ?? 0
    const tratamente = folosit?.tratamente ?? 0
    if (programari > 0 || linii > 0 || tratamente > 0) {
      throw eroareConflict(mesajArticolFolosit(articol.tip, { programari, linii, tratamente }), {
        detalii: { programari, linii, tratamente },
      })
    }

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'stergere',
      entitate: 'articol',
      entitate_id: id,
      date_vechi: instantaneu(articol as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })
    await ex.query(`DELETE FROM articol WHERE id = $1`, [id])
  })

  res.status(204).end()
}))

export default router
