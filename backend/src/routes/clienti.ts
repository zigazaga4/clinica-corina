/**
 * /clienti — fișele de client.
 *
 * Fișa este ecranul cel mai des deschis din aplicație, iar întrebarea pe care i
 * se pune cel mai des nu este „ce date are femeia asta”, ci „ce i-am făcut și
 * îmi mai datorează ceva”. De aceea lista și fișa vin cu restanța deja
 * calculată (`de_incasat`), iar `/istoric` întoarce ședințele și încasările
 * într-un singur flux cronologic.
 */

import { Router, Response } from 'express'
import pool, {
  alege,
  dynamicInsert,
  dynamicUpdate,
  multe,
  unu,
  tranzactie,
  type Executor,
} from '../lib/db.js'
import { eroareConflict, eroareValidare, ruta } from '../lib/erori.js'
import {
  boolDin,
  Conditii,
  impacheteaza,
  paginareDin,
  textDin,
  tiparLike,
} from '../lib/filtre.js'
import { adresaCererii, diferenta, instantaneu, scrieJurnal } from '../lib/jurnal.js'
import { DIN_CLIENTI, programariDetaliu, vanzariDetaliu } from '../lib/proiectii.js'
import { ceruteText, esteMomentIso, textOptional } from '../lib/validare.js'
import { requireAuth, requireRole, AuthRequest, cont } from '../middleware/auth.js'
import type {
  Client,
  ClientDetaliu,
  IstoricIntrare,
  NotaClientDetaliu,
} from '../types/database.js'

const router = Router()
router.use(requireAuth)

/**
 * Câmpurile pe care le acceptă un POST sau un PATCH.
 *
 * Fără listă, `dynamicInsert('client', req.body)` scrie orice coloană trimisă:
 * un POST cu `arhivat_la` completat naște fișa deja arhivată, iar un PATCH cu
 * `id` o mută peste alta.
 */
const CAMPURI = ['nume', 'telefon', 'email', 'adresa', 'data_nasterii'] as const

/** Câmpurile enumerate explicit — `SELECT *` dintr-o vedere e destul aici. */
const SELECT_CLIENT = DIN_CLIENTI

/** Coloanele după care se poate sorta. Lista albă ține SQL-ul departe de query string. */
const SORTARI: Record<string, string> = {
  nume: 'nume',
  creat_la: 'creat_la',
  ultima_vizita: 'ultima_vizita',
}

/**
 * Curăță și validează datele unei fișe.
 *
 * Aceeași funcție pentru creare și pentru modificare: altfel regula „numele nu
 * poate fi gol” ajunge să existe într-un singur loc din două, și se descoperă
 * abia când cineva golește câmpul într-un PATCH.
 */
function pregateste(corp: Record<string, unknown>, laCreare: boolean): Record<string, unknown> {
  const date = alege(corp, CAMPURI)

  if (laCreare || date['nume'] !== undefined) {
    date['nume'] = ceruteText(date['nume'], 'nume', 'Numele clientului')
  }
  const etichete: Record<string, string> = {
    telefon: 'Telefonul',
    email: 'Adresa de e-mail',
    adresa: 'Adresa',
    data_nasterii: 'Data nașterii',
  }
  for (const camp of ['telefon', 'email', 'adresa', 'data_nasterii'] as const) {
    if (date[camp] !== undefined) date[camp] = textOptional(date[camp], camp, etichete[camp])
  }

  const nasterea = date['data_nasterii']
  if (typeof nasterea === 'string') {
    /*
      Forma se cere înaintea calendarului.

      `new Date("maine")` nu întoarce „dată invalidă”, ci o dată oarecare din
      2001 — trecută, deci acceptată aici și refuzată abia de coloana `date`, cu
      500. Verificată întâi forma ISO, greșeala rămâne a formularului.
    */
    if (!esteMomentIso(nasterea)) {
      throw eroareValidare('Data nașterii nu este o dată validă.', 'data_nasterii')
    }
    if (new Date(nasterea) > new Date()) {
      throw eroareValidare('Data nașterii trebuie să fie o dată din trecut.', 'data_nasterii')
    }
  }

  return date
}

// ---------------------------------------------------------------------------
// GET /clienti — orice rol
// ---------------------------------------------------------------------------

router.get('/', ruta(async (req: AuthRequest, res: Response) => {
  const unde = new Conditii()
  const p = paginareDin(req)

  // Implicit se văd doar fișele active; arhivarea este ștergere logică.
  if (!boolDin(req.query['include_arhivati'])) unde.brut('arhivat_la IS NULL')

  const q = textDin(req.query['q'])
  if (q) {
    // `%` și `_` tastate în căutare sunt semne, nu jokeri: fără `tiparLike`,
    // un `q=%` întorcea toată tabela ca și cum aceea ar fi fost potrivirea.
    const tipar = unde.marcaj(`%${tiparLike(q)}%`)
    /*
      Trei căi de căutare, pentru că recepția tastează ce are la îndemână.

      `unaccent` pe ambele capete: „Ștefănescu” trebuie găsită și de cine scrie
      „Stefanescu”, ceea ce se întâmplă mai des decât nu. Telefonul se compară
      din cifre curate — omul îl citește de pe ecran cu spații și liniuțe, iar
      în bază poate fi scris altfel.
    */
    const cifre = q.replace(/\D/g, '')
    const dupaTelefon =
      cifre.length >= 3
        ? ` OR regexp_replace(COALESCE(telefon, ''), '\\D', '', 'g') LIKE ${unde.marcaj(`%${cifre}%`)}`
        : ''
    unde.brut(
      `(unaccent(nume) ILIKE unaccent(${tipar})` +
        ` OR unaccent(COALESCE(email, '')) ILIKE unaccent(${tipar})${dupaTelefon})`,
    )
  }

  const coloana = SORTARI[String(req.query['sortare'] ?? 'nume')] ?? 'nume'
  const directie = req.query['directie'] === 'desc' ? 'DESC' : 'ASC'
  /*
    Clienții fără nicio vizită se așază la coadă, indiferent de direcție.

    `id` la urmă nu este un moft: fără o coloană UNICĂ în ORDER BY, rândurile cu
    același nume nu au între ele o ordine stabilă, iar PostgreSQL nu promite că
    o repetă de la o interogare la alta. Paginarea le taie apoi cu LIMIT/OFFSET
    în interogări DIFERITE: șase omonime plimbate câte una pe pagină ieșeau
    cinci, una dintre ele de două ori, iar una nicăieri. Nimeni nu ar fi bănuit
    sortarea — s-ar fi spus că fișa lipsește din bază.
  */
  const ordine = `ORDER BY ${coloana} ${directie} NULLS LAST, nume ASC, id ASC`

  // Copiate înainte de a adăuga marcajele de LIMIT/OFFSET: numărătoarea
  // folosește aceleași filtre, dar nu și paginarea.
  const doarFiltre = [...unde.values]
  const felie = `LIMIT ${unde.marcaj(p.pe_pagina)} OFFSET ${unde.marcaj(p.offset)}`

  const [randuri, numarate] = await Promise.all([
    multe<ClientDetaliu>(pool, `${SELECT_CLIENT} ${unde.where} ${ordine} ${felie}`, unde.values),
    // Numărătoarea se face pe `client`, nu pe vedere: agregatele de restanțe nu
    // schimbă câte rânduri sunt, iar calculate degeaba costă la fiecare listare.
    multe<{ total: number }>(
      pool,
      `SELECT count(*)::bigint AS total FROM client ${unde.where}`,
      doarFiltre,
    ),
  ])

  res.json(impacheteaza(randuri, numarate[0]?.total ?? 0, p))
}))

// ---------------------------------------------------------------------------
// GET /clienti/:id — orice rol
// ---------------------------------------------------------------------------

router.get('/:id', ruta(async (req: AuthRequest, res: Response) => {
  res.json(await unu<ClientDetaliu>(
    pool, `${SELECT_CLIENT} WHERE id = $1`, [req.params['id']], 'Clientul',
  ))
}))

// ---------------------------------------------------------------------------
// POST /clienti — orice rol
// ---------------------------------------------------------------------------

router.post('/', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const date = pregateste(req.body as Record<string, unknown>, true)

  const client = await tranzactie(async (ex: Executor) => {
    const q = dynamicInsert('client', { ...date, creat_de: autor.id })
    const { rows } = await ex.query<Client>(q.text, q.values)
    const rand = rows[0]!

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'client',
      entitate_id: rand.id,
      date_noi: instantaneu(rand as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })
    return rand
  })

  res.status(201).json(client)
}))

// ---------------------------------------------------------------------------
// PATCH /clienti/:id — orice rol
// ---------------------------------------------------------------------------

router.patch('/:id', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']
  const date = pregateste(req.body as Record<string, unknown>, false)

  const client = await tranzactie(async (ex: Executor) => {
    const inainte = await unu<Client>(ex, `SELECT * FROM client WHERE id = $1`, [id], 'Clientul')

    const q = dynamicUpdate('client', date, 'id', id)
    const { rows } = await ex.query<Client>(q.text, q.values)
    const dupa = rows[0]!

    const dif = diferenta(
      inainte as unknown as Record<string, unknown>,
      dupa as unknown as Record<string, unknown>,
    )
    if (dif) {
      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: 'modificare',
        entitate: 'client',
        entitate_id: id!,
        ...dif,
        adresa_ip: adresaCererii(req),
      })
    }
    return dupa
  })

  res.json(client)
}))

// ---------------------------------------------------------------------------
// Arhivarea — ștergerea logică, și drumul înapoi
// ---------------------------------------------------------------------------

/**
 * Arhivare și dezarhivare sunt aceeași operațiune cu semn schimbat.
 *
 * Amândouă întorc fișa întreagă, nu un `{ message: 'ok' }`: ecranul care a
 * cerut arhivarea trebuie să arate imediat rândul în noua lui stare, iar un
 * mesaj l-ar obliga să mai ceară o dată ce tocmai a schimbat.
 */
function comutaArhivarea(arhiveaza: boolean) {
  return ruta(async (req: AuthRequest, res: Response) => {
    const autor = cont(req)
    const id = req.params['id']

    const client = await tranzactie(async (ex: Executor) => {
      const inainte = await unu<Client>(ex, `SELECT * FROM client WHERE id = $1`, [id], 'Clientul')
      const deja = arhiveaza ? inainte.arhivat_la !== null : inainte.arhivat_la === null
      // Arhivarea a ceva deja arhivat nu este o eroare — este o cerere fără efect.
      if (deja) return inainte

      const { rows } = await ex.query<Client>(
        `UPDATE client SET arhivat_la = ${arhiveaza ? 'now()' : 'NULL'} WHERE id = $1 RETURNING *`,
        [id],
      )
      const dupa = rows[0]!

      await scrieJurnal(ex, {
        utilizator_id: autor.id,
        actiune: arhiveaza ? 'arhivare' : 'modificare',
        entitate: 'client',
        entitate_id: id!,
        date_vechi: { arhivat_la: inainte.arhivat_la },
        date_noi: { arhivat_la: dupa.arhivat_la },
        adresa_ip: adresaCererii(req),
      })
      return dupa
    })

    res.json(client)
  })
}

router.post('/:id/arhivare', comutaArhivarea(true))
router.post('/:id/dezarhivare', comutaArhivarea(false))

// ---------------------------------------------------------------------------
// DELETE /clienti/:id — doar administrator
// ---------------------------------------------------------------------------

/**
 * Ștergerea definitivă există, dar aproape niciodată nu se poate face.
 *
 * Cheile către `client` din `programare` și `vanzare` sunt ON DELETE RESTRICT:
 * o fișă cu istoric nu poate dispărea fără să lase încasări fără plătitor. Ce
 * se șterge cu adevărat sunt fișele deschise din greșeală, înainte de prima
 * programare. Pentru restul există arhivarea, iar mesajul o spune.
 */
router.delete('/:id', requireRole('administrator'), ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']

  await tranzactie(async (ex: Executor) => {
    const client = await unu<Client>(ex, `SELECT * FROM client WHERE id = $1`, [id], 'Clientul')

    const [contoare] = await multe<{ programari: number; vanzari: number }>(
      ex,
      `SELECT (SELECT count(*) FROM programare WHERE client_id = $1) AS programari,
              (SELECT count(*) FROM vanzare    WHERE client_id = $1) AS vanzari`,
      [id],
    )
    const programari = contoare?.programari ?? 0
    const vanzari = contoare?.vanzari ?? 0

    if (programari > 0 || vanzari > 0) {
      const parti: string[] = []
      if (programari > 0) parti.push(`${programari} ${programari === 1 ? 'programare' : 'programări'}`)
      if (vanzari > 0) parti.push(`${vanzari} ${vanzari === 1 ? 'încasare' : 'încasări'}`)
      throw eroareConflict(
        `Clientul nu poate fi șters definitiv: are ${parti.join(' și ')}. Arhivează-l în schimb.`,
        { detalii: { programari, vanzari } },
      )
    }

    // Jurnalul se scrie ÎNAINTE de ștergere: `entitate_id` nu are cheie străină
    // spre client tocmai ca urma să rămână, dar instantaneul rândului nu s-ar
    // mai putea lua după.
    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'stergere',
      entitate: 'client',
      entitate_id: id!,
      date_vechi: instantaneu(client as unknown as Record<string, unknown>),
      adresa_ip: adresaCererii(req),
    })

    await ex.query(`DELETE FROM client WHERE id = $1`, [id])
  })

  res.status(204).end()
}))

// ---------------------------------------------------------------------------
// GET /clienti/:id/istoric — orice rol
// ---------------------------------------------------------------------------

/**
 * Tot ce s-a întâmplat cu acest client, cel mai recent întâi.
 *
 * Ședințele și încasările sunt tabele diferite și rămân așa; se împletesc abia
 * în răspuns. Fișa alege apoi ce arată din fiecare — o încasare care nu face
 * decât să stingă ședințe nu are ce adăuga acolo unde ședința este deja
 * scrisă, cu prețul și cu data plății ei.
 */
router.get('/:id/istoric', ruta(async (req: AuthRequest, res: Response) => {
  const id = req.params['id']
  await unu(pool, `SELECT id FROM client WHERE id = $1`, [id], 'Clientul')

  const [programari, vanzari] = await Promise.all([
    programariDetaliu(pool, 'WHERE client_id = $1', [id], 'ORDER BY incepe_la DESC, creat_la, id'),
    vanzariDetaliu(pool, 'WHERE client_id = $1', [id]),
  ])

  const intrari: IstoricIntrare[] = [
    ...programari.map((programare) => ({
      fel: 'programare' as const,
      la: programare.incepe_la,
      programare,
    })),
    ...vanzari.map((vanzare) => ({
      fel: 'vanzare' as const,
      la: vanzare.efectuat_la,
      vanzare,
    })),
  ]

  intrari.sort((a, b) => new Date(b.la).getTime() - new Date(a.la).getTime())
  res.json(intrari)
}))

// ---------------------------------------------------------------------------
// Note — orice rol. Nu se modifică: o corecție este o notă nouă.
// ---------------------------------------------------------------------------

const SELECT_NOTE = `
  SELECT n.*, u.nume AS autor_nume
  FROM nota_client n
  LEFT JOIN utilizator u ON u.id = n.autor_id`

router.get('/:id/note', ruta(async (req: AuthRequest, res: Response) => {
  const id = req.params['id']
  await unu(pool, `SELECT id FROM client WHERE id = $1`, [id], 'Clientul')

  res.json(await multe<NotaClientDetaliu>(
    pool, `${SELECT_NOTE} WHERE n.client_id = $1 ORDER BY n.creat_la DESC`, [id],
  ))
}))

router.post('/:id/note', ruta(async (req: AuthRequest, res: Response) => {
  const autor = cont(req)
  const id = req.params['id']
  const text = ceruteText((req.body as { text?: unknown }).text, 'text', 'Textul notei')

  const nota = await tranzactie(async (ex: Executor) => {
    await unu(ex, `SELECT id FROM client WHERE id = $1`, [id], 'Clientul')

    const { rows } = await ex.query<{ id: string }>(
      `INSERT INTO nota_client (client_id, autor_id, text) VALUES ($1, $2, $3) RETURNING id`,
      [id, autor.id, text],
    )

    await scrieJurnal(ex, {
      utilizator_id: autor.id,
      actiune: 'creare',
      entitate: 'nota_client',
      entitate_id: rows[0]!.id,
      date_noi: { client_id: id, text },
      adresa_ip: adresaCererii(req),
    })

    return unu<NotaClientDetaliu>(ex, `${SELECT_NOTE} WHERE n.id = $1`, [rows[0]!.id], 'Nota')
  })

  res.status(201).json(nota)
}))

export default router
