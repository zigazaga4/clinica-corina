/**
 * Verificarea contractului — `npm run test:api` (serverul trebuie să ruleze).
 *
 * Nu testează SQL-ul, ci ce vede aplicația: rutele, numele câmpurilor, forma
 * anvelopelor, codurile de eroare. Interfața are propriile teste împotriva
 * implementării ei în memorie; acestea verifică faptul că serverul răspunde la
 * fel — singura garanție că `VITE_API_URL` poate fi comutat fără surprize.
 *
 * Fiecare verificare spune ce a așteptat și ce a primit. Un test care doar
 * pică nu ajută pe nimeni la ora unu noaptea.
 */

import 'dotenv/config'

const BAZA = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
const EMAIL_ADMIN = 'admin@clinica.ro'
const EMAIL_OPERATOR = 'andreea.popescu@clinica.ro'
const PAROLA = 'parola123'

let trecute = 0
const esuate: string[] = []

function verifica(nume: string, conditie: boolean, detaliu = ''): void {
  if (conditie) {
    trecute++
    console.log(`  ✓ ${nume}`)
  } else {
    esuate.push(nume)
    console.log(`  ✗ ${nume}${detaliu ? `\n      ${detaliu}` : ''}`)
  }
}

interface Raspuns<T> { status: number; corp: T }

async function cere<T = any>(
  metoda: string,
  cale: string,
  optiuni: { corp?: unknown; token?: string } = {},
): Promise<Raspuns<T>> {
  const antete: Record<string, string> = { Accept: 'application/json' }
  if (optiuni.corp !== undefined) antete['Content-Type'] = 'application/json'
  if (optiuni.token) antete['Authorization'] = `Bearer ${optiuni.token}`

  const raspuns = await fetch(`${BAZA}${cale}`, {
    method: metoda,
    headers: antete,
    body: optiuni.corp === undefined ? undefined : JSON.stringify(optiuni.corp),
  })
  const text = await raspuns.text()
  return { status: raspuns.status, corp: (text ? JSON.parse(text) : null) as T }
}

/*
  Un interval liber, propriu acestei rulări.

  Testul scrie programări adevărate și nu are cum să le șteargă după el: nu
  există DELETE pe programări, tocmai ca istoricul să nu se poată pierde. Cu ore
  fixe, prima rulare ar fi trecut, iar a doua ar fi picat cu 409 pe agenda
  aceluiași executant — și cine o vede prima ar crede că serverul s-a stricat.

  Deplasarea aleatorie duce fiecare rulare într-un colț diferit al anului
  următor. La ședințe de 45 de minute, două rulări se ciocnesc sub o sutime de
  procent din cazuri, iar dacă totuși se întâmplă, o a doua rulare trece.
*/
const DEPLASARE_MINUTE = Math.floor(Math.random() * 500_000)

function interval(indice: number, ora: number, minute = 45) {
  const incepe = new Date()
  incepe.setFullYear(incepe.getFullYear() + 1)
  incepe.setHours(ora, 0, 0, 0)
  incepe.setMinutes(incepe.getMinutes() + DEPLASARE_MINUTE + indice * 180)
  const seTermina = new Date(incepe.getTime() + minute * 60_000)
  return { incepe_la: incepe.toISOString(), se_termina_la: seTermina.toISOString() }
}

async function ruleaza(): Promise<void> {
  console.log(`\n=== Contractul API === ${BAZA}\n`)

  // -------------------------------------------------------------------------
  console.log('Autentificare')

  const gresit = await cere('POST', '/auth/login', {
    corp: { email: EMAIL_ADMIN, parola: 'gresita' },
  })
  verifica('parolă greșită -> 400', gresit.status === 400, `a venit ${gresit.status}`)
  verifica(
    'eroarea are „mesaj” și „camp”',
    typeof gresit.corp?.mesaj === 'string' && gresit.corp?.camp === 'parola',
    JSON.stringify(gresit.corp),
  )

  const intrare = await cere('POST', '/auth/login', {
    corp: { email: EMAIL_ADMIN, parola: PAROLA, dispozitiv: 'test-api' },
  })
  verifica('login -> 200', intrare.status === 200, JSON.stringify(intrare.corp))
  const { access_token, refresh_token, expira_la, utilizator } = intrare.corp ?? {}
  verifica('răspunsul are access_token, refresh_token, expira_la',
    Boolean(access_token && refresh_token && expira_la))
  verifica('utilizatorul NU conține parola_hash', utilizator && !('parola_hash' in utilizator))
  verifica('utilizatorul are toate câmpurile din tip',
    ['id', 'nume', 'email', 'rol', 'activ', 'creat_la', 'actualizat_la']
      .every((c) => c in (utilizator ?? {})),
    JSON.stringify(utilizator))

  const admin = access_token as string

  const eu = await cere('GET', '/auth/eu', { token: admin })
  verifica('GET /auth/eu -> contul curent', eu.status === 200 && eu.corp?.email === EMAIL_ADMIN)

  const faraToken = await cere('GET', '/clienti')
  verifica('fără token -> 401', faraToken.status === 401)

  const operator = (await cere('POST', '/auth/login', {
    corp: { email: EMAIL_OPERATOR, parola: PAROLA },
  })).corp.access_token as string

  // -------------------------------------------------------------------------
  console.log('\nNomenclator')

  const articole = await cere('GET', '/articole?tip=serviciu&activ=true', { token: admin })
  verifica('GET /articole -> listă', Array.isArray(articole.corp) && articole.corp.length > 0)
  const serviciu = articole.corp[0]
  verifica('articolul are toate coloanele',
    ['id', 'tip', 'denumire', 'durata_minute', 'pret_lista', 'activ', 'creat_la', 'actualizat_la']
      .every((c) => c in (serviciu ?? {})),
    JSON.stringify(serviciu))
  verifica('pret_lista este NUMĂR, nu text', typeof serviciu?.pret_lista === 'number',
    `a venit ${typeof serviciu?.pret_lista}: ${JSON.stringify(serviciu?.pret_lista)}`)

  const produse = await cere('GET', '/articole?tip=produs&activ=true', { token: admin })
  const produs = produse.corp[0]
  verifica('produsele nu au durată', produs?.durata_minute === null)

  const scrieCaOperator = await cere('POST', '/articole', {
    token: operator,
    corp: { tip: 'produs', denumire: 'Test interzis', pret_lista: 10 },
  })
  verifica('POST /articole ca operator -> 403', scrieCaOperator.status === 403,
    `a venit ${scrieCaOperator.status}`)

  const durataGresita = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'produs', denumire: 'Cremă cu durată', pret_lista: 10, durata_minute: 30 },
  })
  verifica('produs cu durată -> 400 pe „durata_minute”',
    durataGresita.status === 400 && durataGresita.corp?.camp === 'durata_minute',
    JSON.stringify(durataGresita.corp))

  // -------------------------------------------------------------------------
  console.log('\nClienți')

  const lista = await cere('GET', '/clienti?pe_pagina=3', { token: admin })
  verifica('GET /clienti -> anvelopa { randuri, total, pagina, pe_pagina }',
    Array.isArray(lista.corp?.randuri) && typeof lista.corp?.total === 'number'
      && lista.corp?.pagina === 1 && lista.corp?.pe_pagina === 3,
    JSON.stringify(Object.keys(lista.corp ?? {})))
  verifica('rândul are contoarele și restanța',
    ['numar_programari', 'numar_vanzari', 'ultima_vizita', 'de_incasat']
      .every((c) => c in (lista.corp?.randuri?.[0] ?? {})),
    JSON.stringify(lista.corp?.randuri?.[0]))
  verifica('de_incasat este NUMĂR', typeof lista.corp?.randuri?.[0]?.de_incasat === 'number')

  const cautare = await cere('GET', '/clienti?q=Stefanescu', { token: admin })
  verifica('căutarea ignoră diacriticele („Stefanescu” -> „Ștefănescu”)',
    cautare.corp?.randuri?.some((c: any) => c.nume.includes('Ștefănescu')),
    JSON.stringify(cautare.corp?.randuri?.map((c: any) => c.nume)))

  const nou = await cere('POST', '/clienti', {
    token: admin,
    corp: { nume: 'Test Contract', telefon: '0700000000' },
  })
  verifica('POST /clienti -> 201', nou.status === 201, JSON.stringify(nou.corp))
  const client_id = nou.corp?.id

  const injectat = await cere('POST', '/clienti', {
    token: admin,
    corp: { nume: 'Test Injectat', arhivat_la: '2020-01-01T00:00:00Z' },
  })
  verifica('câmpurile nepermise sunt ignorate (nu se naște arhivat)',
    injectat.status === 201 && injectat.corp?.arhivat_la === null,
    JSON.stringify(injectat.corp?.arhivat_la))

  const faraNume = await cere('POST', '/clienti', { token: admin, corp: { telefon: '07' } })
  verifica('client fără nume -> 400 pe „nume”',
    faraNume.status === 400 && faraNume.corp?.camp === 'nume', JSON.stringify(faraNume.corp))

  // -------------------------------------------------------------------------
  console.log('\nProgramări')

  const executanti = await cere('GET', '/utilizatori?activ=true', { token: admin })
  const executant = executanti.corp.find((u: any) => u.email === EMAIL_OPERATOR)

  const sugerat = await cere(
    'GET', `/programari/pret-sugerat?client_id=${client_id}&articol_id=${serviciu.id}`,
    { token: admin },
  )
  verifica('GET /programari/pret-sugerat -> { pret, din_istoric, pret_lista }',
    sugerat.status === 200 && sugerat.corp?.din_istoric === false
      && sugerat.corp?.pret === serviciu.pret_lista,
    JSON.stringify(sugerat.corp))

  const cand = interval(30, 9)
  const programare = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id, articol_id: serviciu.id, executant_id: executant.id, ...cand },
  })
  verifica('POST /programari -> 201', programare.status === 201, JSON.stringify(programare.corp))
  verifica('prețul se completează din nomenclator când lipsește',
    programare.corp?.pret === serviciu.pret_lista, JSON.stringify(programare.corp?.pret))
  verifica('punctul de lucru e completat de server',
    Boolean(programare.corp?.punct_lucru_id && programare.corp?.punct_lucru_denumire))
  verifica('programarea vine hidratată',
    ['client_nume', 'articol_denumire', 'executant_nume', 'achitat', 'vanzare_id', 'achitat_la']
      .every((c) => c in (programare.corp ?? {})),
    JSON.stringify(Object.keys(programare.corp ?? {})))
  verifica('o programare nouă nu este achitată',
    programare.corp?.achitat === false && programare.corp?.vanzare_id === null
      && programare.corp?.achitat_la === null)

  const programare_id = programare.corp?.id

  const suprapusa = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id, articol_id: serviciu.id, executant_id: executant.id, ...cand },
  })
  verifica('suprapunere pe același executant -> 409',
    suprapusa.status === 409, `a venit ${suprapusa.status}: ${JSON.stringify(suprapusa.corp)}`)
  verifica('409-ul spune cine este ocupat',
    typeof suprapusa.corp?.mesaj === 'string' && suprapusa.corp.mesaj.includes(executant.nume),
    JSON.stringify(suprapusa.corp?.mesaj))

  const inversat = await cere('POST', '/programari', {
    token: admin,
    corp: {
      client_id, articol_id: serviciu.id, executant_id: executant.id,
      incepe_la: cand.se_termina_la, se_termina_la: cand.incepe_la,
    },
  })
  verifica('sfârșit înaintea începutului -> 400', inversat.status === 400)

  const produsProgramat = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id, articol_id: produs.id, executant_id: executant.id, ...interval(31, 9) },
  })
  verifica('un produs nu poate fi programat -> 400 pe „articol_id”',
    produsProgramat.status === 400 && produsProgramat.corp?.camp === 'articol_id',
    JSON.stringify(produsProgramat.corp))

  const calendar = await cere(
    'GET', `/programari?de_la=${encodeURIComponent(cand.incepe_la)}&stare=programat&client_id=${client_id}`,
    { token: admin },
  )
  verifica('GET /programari filtrează pe interval, stare și client',
    Array.isArray(calendar.corp) && calendar.corp.length === 1
      && calendar.corp[0].id === programare_id,
    JSON.stringify(calendar.corp?.length))

  const onorata = await cere('PATCH', `/programari/${programare_id}/stare`, {
    token: admin, corp: { stare: 'onorat' },
  })
  verifica('PATCH stare -> onorat, încă neachitată',
    onorata.status === 200 && onorata.corp?.stare === 'onorat' && onorata.corp?.achitat === false)

  const fisa = await cere('GET', `/clienti/${client_id}`, { token: admin })
  verifica('ședința onorată apare ca restanță pe fișă',
    fisa.corp?.de_incasat === serviciu.pret_lista,
    `de_incasat = ${JSON.stringify(fisa.corp?.de_incasat)}`)

  // -------------------------------------------------------------------------
  console.log('\nÎncasări')

  const incasare = await cere('POST', '/vanzari/incasare', {
    token: admin,
    corp: {
      client_id,
      programare_ids: [programare_id],
      linii: [{ articol_id: produs.id, cantitate: 2 }],
    },
  })
  verifica('POST /vanzari/incasare -> 201', incasare.status === 201, JSON.stringify(incasare.corp))
  verifica('bonul are antetul hidratat și liniile',
    ['client_nume', 'operator_nume', 'punct_lucru_denumire', 'linii', 'total']
      .every((c) => c in (incasare.corp ?? {})))
  verifica('bonul are 2 linii: ședința și produsul', incasare.corp?.linii?.length === 2)
  verifica('totalul este suma corectă, ca număr',
    incasare.corp?.total === serviciu.pret_lista + 2 * produs.pret_lista,
    `total = ${JSON.stringify(incasare.corp?.total)}`)
  verifica('linia ședinței poartă prețul CONVENIT, nu cel de listă de azi',
    incasare.corp?.linii?.some((l: any) => l.programare_id === programare_id
      && l.pret_unitar === serviciu.pret_lista))
  verifica('linia ședinței spune când a avut loc',
    incasare.corp?.linii?.some((l: any) => l.programare_id === programare_id
      && typeof l.programare_incepe_la === 'string'))
  verifica('liniile de produs nu au programare_id',
    incasare.corp?.linii?.some((l: any) => l.articol_id === produs.id && l.programare_id === null))

  const dinNou = await cere('POST', '/vanzari/incasare', {
    token: admin, corp: { client_id, programare_ids: [programare_id] },
  })
  verifica('aceeași ședință nu se poate încasa de două ori -> 409',
    dinNou.status === 409, `a venit ${dinNou.status}`)

  const dupaPlata = await cere('GET', `/programari/${programare_id}`, { token: admin })
  verifica('ședința se știe achitată',
    dupaPlata.corp?.achitat === true && dupaPlata.corp?.vanzare_id === incasare.corp?.id)
  verifica('ședința știe CÂND a fost achitată (achitat_la)',
    typeof dupaPlata.corp?.achitat_la === 'string', JSON.stringify(dupaPlata.corp?.achitat_la))

  const fisaAchitata = await cere('GET', `/clienti/${client_id}`, { token: admin })
  verifica('restanța a dispărut de pe fișă', fisaAchitata.corp?.de_incasat === 0,
    JSON.stringify(fisaAchitata.corp?.de_incasat))

  const pretDupa = await cere(
    'GET', `/programari/pret-sugerat?client_id=${client_id}&articol_id=${serviciu.id}`,
    { token: admin },
  )
  verifica('prețul de listă neschimbat nu se raportează ca „din istoric”',
    pretDupa.corp?.din_istoric === false)

  const istoric = await cere('GET', `/clienti/${client_id}/istoric`, { token: admin })
  verifica('GET /clienti/:id/istoric -> uniune discriminată',
    Array.isArray(istoric.corp) && istoric.corp.length === 2
      && istoric.corp.every((i: any) => (i.fel === 'programare' && i.programare)
        || (i.fel === 'vanzare' && i.vanzare)),
    JSON.stringify(istoric.corp?.map((i: any) => i.fel)))
  verifica('istoricul e ordonat descrescător',
    new Date(istoric.corp[0].la) >= new Date(istoric.corp[1].la))

  const vanzari = await cere('GET', `/vanzari?client_id=${client_id}`, { token: admin })
  verifica('GET /vanzari -> anvelopă paginată cu linii',
    Array.isArray(vanzari.corp?.randuri) && vanzari.corp.randuri[0]?.linii?.length === 2
      && typeof vanzari.corp.total === 'number')

  const dupaArticol = await cere('GET', `/vanzari?articol_id=${produs.id}`, { token: admin })
  verifica('GET /vanzari filtrează pe articolul de pe linii',
    dupaArticol.corp?.randuri?.every((v: any) =>
      v.linii.some((l: any) => l.articol_id === produs.id)),
    `${dupaArticol.corp?.randuri?.length} bonuri`)

  // -------------------------------------------------------------------------
  console.log('\nCorecții — reprogramare, bon editat, nomenclator')

  const mutata = interval(32, 14)
  const reprogramata = await cere('PATCH', `/programari/${programare_id}`, {
    token: admin, corp: mutata,
  })
  verifica('PATCH /programari/:id mută ședința',
    reprogramata.status === 200 && reprogramata.corp?.incepe_la === mutata.incepe_la,
    JSON.stringify(reprogramata.corp?.incepe_la ?? reprogramata.corp))
  verifica('reprogramarea nu se ciocnește de propria variantă veche',
    reprogramata.status !== 409)

  const pretDupaIncasare = await cere('PATCH', `/programari/${programare_id}`, {
    token: admin, corp: { pret: 1 },
  })
  verifica('prețul unei ședințe deja încasate nu se mai poate schimba -> 400',
    pretDupaIncasare.status === 400 && pretDupaIncasare.corp?.camp === 'pret',
    JSON.stringify(pretDupaIncasare.corp))

  const bon_id = incasare.corp?.id
  const bonEditat = await cere('PATCH', `/vanzari/${bon_id}`, {
    token: admin,
    corp: {
      nota: 'Corectat din testul de contract.',
      linii: [
        { articol_id: serviciu.id, cantitate: 1, pret_unitar: serviciu.pret_lista, programare_id },
        { articol_id: produs.id, cantitate: 1 },
      ],
    },
  })
  verifica('PATCH /vanzari/:id înlocuiește liniile și recalculează totalul',
    bonEditat.status === 200 && bonEditat.corp?.linii?.length === 2
      && bonEditat.corp?.total === serviciu.pret_lista + produs.pret_lista,
    `total = ${JSON.stringify(bonEditat.corp?.total)}`)
  verifica('ședința rămâne achitată după rescrierea liniilor',
    (await cere('GET', `/programari/${programare_id}`, { token: admin })).corp?.achitat === true)

  const bonGol = await cere('PATCH', `/vanzari/${bon_id}`, { token: admin, corp: { linii: [] } })
  verifica('un bon nu poate rămâne fără linii -> 400',
    bonGol.status === 400 && bonGol.corp?.camp === 'linii')

  const articolNou = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'serviciu', denumire: `Serviciu test ${Date.now()}`, durata_minute: 30, pret_lista: 99 },
  })
  verifica('POST /articole -> 201', articolNou.status === 201, JSON.stringify(articolNou.corp))

  const devenitProdus = await cere('PATCH', `/articole/${articolNou.corp.id}`, {
    token: admin, corp: { tip: 'produs' },
  })
  verifica('serviciul devenit produs își pierde durata (articol_durata_ck)',
    devenitProdus.status === 200 && devenitProdus.corp?.durata_minute === null,
    JSON.stringify(devenitProdus.corp))

  const stersNefolosit = await cere('DELETE', `/articole/${articolNou.corp.id}`, { token: admin })
  verifica('DELETE articol nefolosit -> 204', stersNefolosit.status === 204)

  const stersFolosit = await cere('DELETE', `/articole/${serviciu.id}`, { token: admin })
  verifica('DELETE articol folosit -> 409, cu îndemn la dezactivare',
    stersFolosit.status === 409 && /[Dd]ezactiv/.test(stersFolosit.corp?.mesaj ?? ''),
    JSON.stringify(stersFolosit.corp?.mesaj))

  const punctNou = await cere('POST', '/puncte-lucru', {
    token: admin, corp: { denumire: `Punct test ${Date.now()}` },
  })
  verifica('POST /puncte-lucru -> 201', punctNou.status === 201)

  const punctDuplicat = await cere('POST', '/puncte-lucru', {
    token: admin, corp: { denumire: punctNou.corp.denumire },
  })
  verifica('denumire de punct duplicată -> 409 pe câmpul „denumire”',
    punctDuplicat.status === 409 && punctDuplicat.corp?.camp === 'denumire',
    JSON.stringify(punctDuplicat.corp))

  await cere('PATCH', `/puncte-lucru/${punctNou.corp.id}`, { token: admin, corp: { activ: false } })

  // -------------------------------------------------------------------------
  console.log('\nNote, utilizatori, jurnal')

  const contNou = await cere('POST', '/utilizatori', {
    token: admin,
    corp: {
      nume: 'Cont Test', email: `test.${Date.now()}@clinica.ro`,
      parola: 'parolaTest1', rol: 'utilizator',
    },
  })
  verifica('POST /utilizatori -> 201, fără parola_hash în răspuns',
    contNou.status === 201 && !('parola_hash' in (contNou.corp ?? {})),
    JSON.stringify(contNou.corp))

  const emailDuplicat = await cere('POST', '/utilizatori', {
    token: admin,
    corp: { nume: 'Alt cont', email: EMAIL_ADMIN, parola: 'parolaTest1', rol: 'utilizator' },
  })
  verifica('e-mail duplicat -> 409 pe câmpul „email”',
    emailDuplicat.status === 409 && emailDuplicat.corp?.camp === 'email',
    JSON.stringify(emailDuplicat.corp))

  const parolaScurta = await cere('POST', '/utilizatori', {
    token: admin, corp: { nume: 'X', email: `x.${Date.now()}@clinica.ro`, parola: '123', rol: 'utilizator' },
  })
  verifica('parolă prea scurtă -> 400 pe „parola”',
    parolaScurta.status === 400 && parolaScurta.corp?.camp === 'parola')

  const propriulRol = await cere('PATCH', `/utilizatori/${utilizator.id}`, {
    token: admin, corp: { rol: 'utilizator' },
  })
  verifica('administratorul nu-și poate schimba propriul rol -> 400',
    propriulRol.status === 400 && propriulRol.corp?.camp === 'rol',
    JSON.stringify(propriulRol.corp?.mesaj))

  const propriulCont = await cere('PATCH', `/utilizatori/${utilizator.id}`, {
    token: admin, corp: { activ: false },
  })
  verifica('administratorul nu-și poate dezactiva propriul cont -> 400',
    propriulCont.status === 400 && propriulCont.corp?.camp === 'activ')

  // Un cont care se autentifică, apoi i se resetează parola: sesiunea trebuie
  // să moară pe loc, altfel resetarea nu rezolvă nimic.
  const sesiuneaLui = (await cere('POST', '/auth/login', {
    corp: { email: contNou.corp.email, parola: 'parolaTest1' },
  })).corp.access_token as string
  verifica('contul nou se poate autentifica',
    (await cere('GET', '/auth/eu', { token: sesiuneaLui })).status === 200)

  const resetat = await cere('POST', `/utilizatori/${contNou.corp.id}/reset-parola`, {
    token: admin, corp: { parola_noua: 'parolaNoua1' },
  })
  verifica('POST reset-parola -> 204', resetat.status === 204)
  verifica('resetarea revocă sesiunile deschise -> 401',
    (await cere('GET', '/auth/eu', { token: sesiuneaLui })).status === 401)
  verifica('parola nouă funcționează',
    (await cere('POST', '/auth/login', {
      corp: { email: contNou.corp.email, parola: 'parolaNoua1' },
    })).status === 200)

  const dezactivat = await cere('PATCH', `/utilizatori/${contNou.corp.id}`, {
    token: admin, corp: { activ: false },
  })
  verifica('dezactivarea unui cont -> 200 și activ = false',
    dezactivat.status === 200 && dezactivat.corp?.activ === false)
  verifica('contul dezactivat nu se mai poate autentifica -> 403',
    (await cere('POST', '/auth/login', {
      corp: { email: contNou.corp.email, parola: 'parolaNoua1' },
    })).status === 403)

  const nota = await cere('POST', `/clienti/${client_id}/note`, {
    token: admin, corp: { text: 'Notă din testul de contract.' },
  })
  verifica('POST notă -> 201, cu numele autorului',
    nota.status === 201 && nota.corp?.autor_nume === utilizator.nume,
    JSON.stringify(nota.corp))

  const note = await cere('GET', `/clienti/${client_id}/note`, { token: admin })
  verifica('GET note -> listă cu autor_nume',
    Array.isArray(note.corp) && note.corp[0]?.autor_nume === utilizator.nume)

  const utilizatoriCaOperator = await cere('GET', '/utilizatori', { token: operator })
  verifica('GET /utilizatori ca operator -> 403', utilizatoriCaOperator.status === 403)

  const puncte = await cere('GET', '/puncte-lucru', { token: admin })
  verifica('GET /puncte-lucru -> listă', Array.isArray(puncte.corp) && puncte.corp.length >= 1)

  const jurnal = await cere('GET', '/jurnal?entitate=vanzare&pe_pagina=5', { token: admin })
  verifica('GET /jurnal -> paginat, cu numele utilizatorului',
    Array.isArray(jurnal.corp?.randuri) && jurnal.corp.randuri.length > 0
      && jurnal.corp.randuri[0].utilizator_nume === utilizator.nume,
    JSON.stringify(jurnal.corp?.randuri?.[0]))
  verifica('id-ul de jurnal este NUMĂR, nu text',
    typeof jurnal.corp?.randuri?.[0]?.id === 'number')

  const jurnalCaOperator = await cere('GET', '/jurnal', { token: operator })
  verifica('GET /jurnal ca operator -> 403', jurnalCaOperator.status === 403)

  // -------------------------------------------------------------------------
  console.log('\nArhivare, ștergere, sesiuni')

  const arhivat = await cere('POST', `/clienti/${injectat.corp.id}/arhivare`, { token: admin })
  verifica('POST arhivare -> fișa, cu arhivat_la completat',
    arhivat.status === 200 && typeof arhivat.corp?.arhivat_la === 'string')

  const dezarhivat = await cere('POST', `/clienti/${injectat.corp.id}/dezarhivare`, { token: admin })
  verifica('POST dezarhivare -> arhivat_la revine la null',
    dezarhivat.status === 200 && dezarhivat.corp?.arhivat_la === null)

  const stergereCuIstoric = await cere('DELETE', `/clienti/${client_id}`, { token: admin })
  verifica('DELETE client cu istoric -> 409',
    stergereCuIstoric.status === 409, JSON.stringify(stergereCuIstoric.corp?.mesaj))

  const stergereCaOperator = await cere('DELETE', `/clienti/${injectat.corp.id}`, { token: operator })
  verifica('DELETE client ca operator -> 403', stergereCaOperator.status === 403)

  const stergere = await cere('DELETE', `/clienti/${injectat.corp.id}`, { token: admin })
  verifica('DELETE client fără istoric -> 204', stergere.status === 204)

  const inexistent = await cere('GET', '/clienti/00000000-0000-0000-0000-000000000000', { token: admin })
  verifica('identificator inexistent -> 404', inexistent.status === 404)

  const stricat = await cere('GET', '/clienti/nu-e-uuid', { token: admin })
  verifica('identificator care nu e UUID -> 404, nu 500', stricat.status === 404,
    `a venit ${stricat.status}`)

  const reinnoit = await cere('POST', '/auth/refresh', { corp: { refresh_token } })
  verifica('POST /auth/refresh -> token nou',
    reinnoit.status === 200 && Boolean(reinnoit.corp?.access_token) && Boolean(reinnoit.corp?.expira_la))

  const delogare = await cere('POST', '/auth/logout', { token: admin, corp: { refresh_token } })
  verifica('POST /auth/logout -> 204', delogare.status === 204)

  const dupaDelogare = await cere('GET', '/clienti', { token: admin })
  verifica('token-ul de acces nu mai merge după delogare -> 401',
    dupaDelogare.status === 401, `a venit ${dupaDelogare.status}`)

  const reinnoireDupaDelogare = await cere('POST', '/auth/refresh', { corp: { refresh_token } })
  verifica('nici reînnoirea nu mai merge -> 401', reinnoireDupaDelogare.status === 401)

  // -------------------------------------------------------------------------
  console.log(`\n${trecute} trecute, ${esuate.length} eșuate`)
  if (esuate.length) {
    console.log('\nEșuate:')
    for (const e of esuate) console.log(`  - ${e}`)
    process.exitCode = 1
  }
}

ruleaza().catch((e) => {
  console.error('\nTestul s-a oprit:', e)
  process.exitCode = 1
})
