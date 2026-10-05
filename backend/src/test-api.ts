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
import pool from './lib/db.js'

const BAZA = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
const EMAIL_ADMIN = 'admin@clinica.ro'
const EMAIL_OPERATOR = 'andreea.popescu@clinica.ro'
const PAROLA = 'parola123'
/** Parolele statisticilor folosite de test — diferite de cea a conturilor. */
const PAROLA_STATISTICI = 'statistici-test-1'
const PAROLA_STATISTICI_NOUA = 'statistici-test-2'

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
  /** `statistici` = jetonul primit la deblocarea statisticilor. */
  optiuni: { corp?: unknown; token?: string; statistici?: string } = {},
): Promise<Raspuns<T>> {
  const antete: Record<string, string> = { Accept: 'application/json' }
  if (optiuni.corp !== undefined) antete['Content-Type'] = 'application/json'
  if (optiuni.token) antete['Authorization'] = `Bearer ${optiuni.token}`
  if (optiuni.statistici) antete['X-Acces-Statistici'] = optiuni.statistici

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
  console.log('\nStatistici — parola separată')

  /*
    Singurul loc în care testul scrie direct în bază: parola statisticilor nu
    se poate șterge prin API (tocmai asta o apără), iar o parolă rămasă de la
    rularea trecută — sau aleasă de mână pe baza de dezvoltare — ar face
    pașii de mai jos imposibili. Exact ce face `npm run parola-statistici`.
  */
  // Doar pe un server de pe mașina asta: `DATABASE_URL` e baza de aici, iar un
  // `API_URL` spre alt calculator ar fi șters parola unei baze pe care nu o testăm.
  const serverLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BAZA)
  if (!serverLocal) {
    throw new Error(`test:api șterge parola statisticilor din baza locală; ${BAZA} nu e un server local.`)
  }
  await pool.query(`DELETE FROM parola_statistici`)

  const stareInitiala = await cere('GET', '/statistici/acces', { token: operator })
  verifica('GET /statistici/acces -> parola încă nealeasă',
    stareInitiala.status === 200 && stareInitiala.corp?.parola_setata === false,
    JSON.stringify(stareInitiala.corp))

  const deschidereFaraParola = await cere('POST', '/statistici/acces', {
    token: admin, corp: { parola: PAROLA_STATISTICI },
  })
  verifica('deblocare înainte să existe parola -> 400 pe „parola”',
    deschidereFaraParola.status === 400 && deschidereFaraParola.corp?.camp === 'parola',
    JSON.stringify(deschidereFaraParola.corp))

  const raportIncuiat = await cere('GET', '/statistici?de_la=2026-01-01&pana_la=2026-01-31', { token: admin })
  verifica('raportul fără deblocare -> 403 pe „acces_statistici”',
    raportIncuiat.status === 403 && raportIncuiat.corp?.camp === 'acces_statistici',
    JSON.stringify(raportIncuiat.corp))

  const vanzariIncuiate = await cere('GET', '/vanzari', { token: admin })
  verifica('lista încasărilor fără deblocare -> 403 (e și ea o statistică)',
    vanzariIncuiate.status === 403 && vanzariIncuiate.corp?.camp === 'acces_statistici',
    JSON.stringify(vanzariIncuiate.corp))

  const alegereOperator = await cere('PUT', '/statistici/parola', {
    token: operator, corp: { parola_noua: PAROLA_STATISTICI },
  })
  verifica('parola o alege doar un administrator -> 403', alegereOperator.status === 403)

  const preaScurta = await cere('PUT', '/statistici/parola', {
    token: admin, corp: { parola_noua: 'scurta' },
  })
  verifica('parolă sub 8 caractere -> 400 pe „parola_noua”',
    preaScurta.status === 400 && preaScurta.corp?.camp === 'parola_noua',
    JSON.stringify(preaScurta.corp))

  const caAContului = await cere('PUT', '/statistici/parola', {
    token: admin, corp: { parola_noua: PAROLA },
  })
  verifica('parola contului nu poate fi și parola statisticilor -> 400',
    caAContului.status === 400 && caAContului.corp?.camp === 'parola_noua',
    JSON.stringify(caAContului.corp))

  const aleasa = await cere('PUT', '/statistici/parola', {
    token: admin, corp: { parola_noua: PAROLA_STATISTICI },
  })
  verifica('PUT /statistici/parola -> aleasă, cu deblocarea în răspuns',
    aleasa.status === 200 && typeof aleasa.corp?.jeton === 'string'
      && typeof aleasa.corp?.expira_la === 'string',
    JSON.stringify(aleasa.corp))
  verifica('deblocarea expiră în aproximativ o oră',
    Math.abs(new Date(aleasa.corp?.expira_la).getTime() - Date.now() - 3_600_000) < 120_000,
    aleasa.corp?.expira_la)
  verifica('și spune cât ține, ca ecranul să numere pe ceasul lui',
    aleasa.corp?.durata_secunde === 3600, JSON.stringify(aleasa.corp?.durata_secunde))
  verifica('GET /statistici/acces -> parola aleasă',
    (await cere('GET', '/statistici/acces', { token: operator })).corp?.parola_setata === true)

  const faraCurenta = await cere('PUT', '/statistici/parola', {
    token: admin, corp: { parola_noua: PAROLA_STATISTICI_NOUA },
  })
  verifica('o parolă existentă nu se schimbă fără cea curentă -> 400 pe „parola_curenta”',
    faraCurenta.status === 400 && faraCurenta.corp?.camp === 'parola_curenta',
    JSON.stringify(faraCurenta.corp))

  const gresitaOperator = await cere('POST', '/statistici/acces', {
    token: operator, corp: { parola: 'nu-e-asta' },
  })
  verifica('parolă greșită -> 400 pe „parola”, nu 401 (sesiunea rămâne)',
    gresitaOperator.status === 400 && gresitaOperator.corp?.camp === 'parola',
    JSON.stringify(gresitaOperator.corp))

  const deschisaOperator = await cere('POST', '/statistici/acces', {
    token: operator, corp: { parola: PAROLA_STATISTICI },
  })
  verifica('orice rol deschide statisticile cu parola bună',
    deschisaOperator.status === 200 && typeof deschisaOperator.corp?.jeton === 'string')
  const statOperator = deschisaOperator.corp?.jeton as string

  const deschisaAdmin = await cere('POST', '/statistici/acces', {
    token: admin, corp: { parola: PAROLA_STATISTICI },
  })
  const stat = deschisaAdmin.corp?.jeton as string
  verifica('POST /statistici/acces -> jeton', deschisaAdmin.status === 200 && Boolean(stat))

  const jetonStrain = await cere('GET', '/vanzari', { token: admin, statistici: statOperator })
  verifica('jetonul altui cont nu deschide nimic -> 403',
    jetonStrain.status === 403 && jetonStrain.corp?.camp === 'acces_statistici')

  const jetonCaAcces = await cere('GET', '/clienti', { token: stat })
  verifica('jetonul statisticilor nu ține loc de sesiune -> 401', jetonCaAcces.status === 401,
    `a venit ${jetonCaAcces.status}`)

  const deschise = await cere('GET', '/vanzari?pe_pagina=1', { token: admin, statistici: stat })
  verifica('cu jetonul, lista încasărilor se deschide', deschise.status === 200,
    JSON.stringify(deschise.corp))

  // -------------------------------------------------------------------------
  console.log('\nNomenclator')

  const articole = await cere('GET', '/articole?tip=serviciu&activ=true', { token: admin })
  verifica('GET /articole -> listă', Array.isArray(articole.corp) && articole.corp.length > 0)
  // Un serviciu dintr-o singură venire: cele în mai multe ședințe au prețul
  // împărțit pe tratament și se verifică separat, mai jos.
  const serviciu = articole.corp.find((a: any) => a.numar_sedinte === 1) ?? articole.corp[0]
  verifica('articolul are toate coloanele',
    ['id', 'tip', 'denumire', 'durata_minute', 'pret_lista', 'activ', 'creat_la', 'actualizat_la', 'numar_sedinte', 'categorie']
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
  console.log('\nCategorii de produse — listele de prețuri')

  // Inactive, ca să nu umple selectoarele bazei de test la fiecare rulare.
  const listaPreturi = `Lista test ${Date.now()}`
  const pentruClienti = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'produs', denumire: 'Cremă Botox 250 ml', pret_lista: 290, activ: false, categorie: `  ${listaPreturi} ` },
  })
  verifica('produs cu categorie -> 201, categoria fără spațiile de la capete',
    pentruClienti.status === 201 && pentruClienti.corp?.categorie === listaPreturi,
    JSON.stringify(pentruClienti.corp))

  const pentruColaboratori = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'produs', denumire: 'Cremă Botox 250 ml', pret_lista: 185, activ: false, categorie: `${listaPreturi} colaboratori` },
  })
  verifica('aceeași cremă, pe altă listă, cu alt preț -> al doilea produs',
    pentruColaboratori.status === 201 && pentruColaboratori.corp?.id !== pentruClienti.corp?.id &&
      pentruColaboratori.corp?.pret_lista === 185,
    JSON.stringify(pentruColaboratori.corp))

  const altfelScrisa = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'produs', denumire: 'Ser Botox 30 ml', pret_lista: 210, activ: false, categorie: listaPreturi.toUpperCase() },
  })
  verifica('categoria scrisă altfel doar prin majuscule se lipește de cea existentă',
    altfelScrisa.status === 201 && altfelScrisa.corp?.categorie === listaPreturi,
    JSON.stringify(altfelScrisa.corp?.categorie))

  const serviciuCuCategorie = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'serviciu', denumire: 'Serviciu cu categorie', pret_lista: 100, durata_minute: 30, categorie: listaPreturi },
  })
  verifica('serviciu cu categorie -> 400 pe „categorie”',
    serviciuCuCategorie.status === 400 && serviciuCuCategorie.corp?.camp === 'categorie',
    JSON.stringify(serviciuCuCategorie.corp))

  const vazutDeOperator = await cere('GET', '/articole?tip=produs&activ=false', { token: operator })
  verifica('recepția vede categoria fiecărui produs',
    vazutDeOperator.corp?.find((a: any) => a.id === pentruColaboratori.corp?.id)?.categorie === `${listaPreturi} colaboratori`)

  const faraCategorie = await cere('PATCH', `/articole/${altfelScrisa.corp?.id}`, {
    token: admin, corp: { categorie: '' },
  })
  verifica('categoria golită -> produs fără categorie (null)',
    faraCategorie.status === 200 && faraCategorie.corp?.categorie === null,
    JSON.stringify(faraCategorie.corp))

  const devenitServiciu = await cere('PATCH', `/articole/${pentruClienti.corp?.id}`, {
    token: admin, corp: { tip: 'serviciu', durata_minute: 30 },
  })
  verifica('produsul devenit serviciu își pierde categoria',
    devenitServiciu.status === 200 && devenitServiciu.corp?.categorie === null,
    JSON.stringify(devenitServiciu.corp))

  const categoriePeServiciu = await cere('PATCH', `/articole/${pentruClienti.corp?.id}`, {
    token: admin, corp: { categorie: listaPreturi },
  })
  verifica('categorie pusă pe un serviciu -> 400 pe „categorie”',
    categoriePeServiciu.status === 400 && categoriePeServiciu.corp?.camp === 'categorie',
    JSON.stringify(categoriePeServiciu.corp))

  // Curățenie: fiecare categorie e o filă în Nomenclator, iar una de test
  // rămasă după fiecare rulare ar umple bara de file a bazei de lucru.
  const curatat = await cere('PATCH', `/articole/${pentruColaboratori.corp?.id}`, {
    token: admin, corp: { categorie: null },
  })
  verifica('categoria de test se scoate la final (null = fără categorie)',
    curatat.status === 200 && curatat.corp?.categorie === null,
    JSON.stringify(curatat.corp))

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

  // Fișa rapidă, din formularul de programare: numai numele, restul mai târziu.
  const doarNume = await cere('POST', '/clienti', {
    token: operator, corp: { nume: `Client Rapid ${Date.now()}` },
  })
  verifica('client doar cu nume -> 201, restul câmpurilor NULL',
    doarNume.status === 201 && doarNume.corp?.telefon === null && doarNume.corp?.email === null
      && doarNume.corp?.data_nasterii === null,
    JSON.stringify(doarNume.corp))

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
  // Din 2026-10-01: aceeași persoană poate avea mai multe programări deodată.
  verifica('suprapunere pe același executant -> 201',
    suprapusa.status === 201, `a venit ${suprapusa.status}: ${JSON.stringify(suprapusa.corp)}`)
  if (suprapusa.corp?.id) {
    await cere('PATCH', `/programari/${suprapusa.corp.id}/stare`, { token: admin, corp: { stare: 'anulat' } })
  }

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
  console.log('\nNotițe în calendar')

  const candNotita = interval(10, 12, 60)

  const generala = await cere('POST', '/notite', {
    token: operator,
    corp: { titlu: 'Vine furnizorul', detalii: 'Comanda de creme', ...candNotita },
  })
  verifica('POST /notite fără persoană -> 201, executant NULL (toată clinica)',
    generala.status === 201 && generala.corp?.executant_id === null
      && generala.corp?.executant_nume === null && generala.corp?.titlu === 'Vine furnizorul',
    JSON.stringify(generala.corp))
  verifica('notița are toate coloanele din tip',
    ['id', 'titlu', 'detalii', 'executant_id', 'incepe_la', 'se_termina_la', 'creat_de',
      'creat_la', 'actualizat_la', 'executant_nume', 'creat_de_nume']
      .every((c) => c in (generala.corp ?? {})),
    JSON.stringify(Object.keys(generala.corp ?? {})))

  const aPersoanei = await cere('POST', '/notite', {
    token: admin,
    corp: { titlu: 'Concediu', executant_id: executant.id, ...candNotita },
  })
  verifica('POST /notite cu persoană -> 201, cu numele ei',
    aPersoanei.status === 201 && aPersoanei.corp?.executant_id === executant.id
      && aPersoanei.corp?.executant_nume === executant.nume,
    JSON.stringify(aPersoanei.corp))

  // O notiță PESTE programarea din același interval: nu blochează, nu e 409.
  const pesteProgramare = await cere('POST', '/notite', {
    token: admin,
    corp: { titlu: 'Pauză', executant_id: executant.id, ...interval(30, 9) },
  })
  verifica('notița NU blochează intervalul — peste o programare tot 201',
    pesteProgramare.status === 201, `a venit ${pesteProgramare.status}`)

  const alta = executanti.corp.find((u: any) => u.id !== executant.id && u.activ)
  const aAlteia = await cere('POST', '/notite', {
    token: admin,
    corp: { titlu: 'Curs', executant_id: alta?.id, ...candNotita },
  })
  verifica('notiță pentru altă persoană -> 201', aAlteia.status === 201)

  const toateZilei = await cere(
    'GET', `/notite?de_la=${encodeURIComponent(candNotita.incepe_la)}&pana_la=${encodeURIComponent(candNotita.se_termina_la)}`,
    { token: operator },
  )
  const ids = (toateZilei.corp ?? []).map((n: any) => n.id)
  verifica('GET /notite pe interval -> le aduce pe toate trei',
    toateZilei.status === 200 && [generala, aPersoanei, aAlteia].every((n) => ids.includes(n.corp?.id)),
    JSON.stringify(ids.length))

  const alePersoanei = await cere(
    'GET', `/notite?executant_id=${executant.id}&de_la=${encodeURIComponent(candNotita.incepe_la)}&pana_la=${encodeURIComponent(candNotita.se_termina_la)}`,
    { token: operator },
  )
  const idsPersoana = (alePersoanei.corp ?? []).map((n: any) => n.id)
  verifica('filtrul pe persoană aduce ALE EI + ale clinicii, nu ale altcuiva',
    idsPersoana.includes(aPersoanei.corp?.id) && idsPersoana.includes(generala.corp?.id)
      && !idsPersoana.includes(aAlteia.corp?.id),
    JSON.stringify(idsPersoana))

  const faraTitlu = await cere('POST', '/notite', { token: admin, corp: { titlu: '  ', ...candNotita } })
  verifica('notiță fără titlu -> 400 pe „titlu”',
    faraTitlu.status === 400 && faraTitlu.corp?.camp === 'titlu', JSON.stringify(faraTitlu.corp))

  const intervalInvers = await cere('POST', '/notite', {
    token: admin,
    corp: { titlu: 'Invers', incepe_la: candNotita.se_termina_la, se_termina_la: candNotita.incepe_la },
  })
  verifica('sfârșit înainte de început -> 400 pe „se_termina_la”',
    intervalInvers.status === 400 && intervalInvers.corp?.camp === 'se_termina_la',
    JSON.stringify(intervalInvers.corp))

  const redenumita = await cere('PATCH', `/notite/${generala.corp?.id}`, {
    token: operator, corp: { titlu: 'Vine furnizorul Dermalogica' },
  })
  verifica('PATCH /notite/:id -> titlu nou, restul neatins',
    redenumita.status === 200 && redenumita.corp?.titlu === 'Vine furnizorul Dermalogica'
      && redenumita.corp?.detalii === 'Comanda de creme',
    JSON.stringify(redenumita.corp))

  const mutataPeClinica = await cere('PATCH', `/notite/${aPersoanei.corp?.id}`, {
    token: admin, corp: { executant_id: null },
  })
  verifica('PATCH executant_id: null -> notița trece pe toată clinica',
    mutataPeClinica.status === 200 && mutataPeClinica.corp?.executant_id === null
      && mutataPeClinica.corp?.executant_nume === null,
    JSON.stringify(mutataPeClinica.corp))

  const stearsa = await cere('DELETE', `/notite/${aAlteia.corp?.id}`, { token: operator })
  verifica('DELETE /notite/:id -> 204 (orice rol)', stearsa.status === 204, `a venit ${stearsa.status}`)

  const dupaStergere = await cere('GET', `/notite/${aAlteia.corp?.id}`, { token: admin })
  verifica('notița ștearsă -> 404', dupaStergere.status === 404)

  const urmaStergerii = await cere(
    'GET', `/jurnal?entitate=notita&entitate_id=${aAlteia.corp?.id}`, { token: admin },
  )
  verifica('ștergerea a lăsat urmă în jurnal',
    urmaStergerii.corp?.randuri?.some((r: any) => r.actiune === 'stergere'),
    JSON.stringify(urmaStergerii.corp?.randuri?.map((r: any) => r.actiune)))

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

  const vanzari = await cere('GET', `/vanzari?client_id=${client_id}`, { token: admin, statistici: stat })
  verifica('GET /vanzari -> anvelopă paginată cu linii',
    Array.isArray(vanzari.corp?.randuri) && vanzari.corp.randuri[0]?.linii?.length === 2
      && typeof vanzari.corp.total === 'number')

  const dupaArticol = await cere('GET', `/vanzari?articol_id=${produs.id}`, { token: admin, statistici: stat })
  verifica('GET /vanzari filtrează pe articolul de pe linii',
    dupaArticol.corp?.randuri?.every((v: any) =>
      v.linii.some((l: any) => l.articol_id === produs.id)),
    `${dupaArticol.corp?.randuri?.length} bonuri`)

  // -------------------------------------------------------------------------
  console.log('\nProduse pe datorie — vânzări neachitate')

  verifica('încasarea ședințelor este achitată în momentul ei',
    incasare.corp?.achitat === true && incasare.corp?.achitat_la === incasare.corp?.efectuat_la,
    JSON.stringify({ achitat: incasare.corp?.achitat, la: incasare.corp?.achitat_la }))

  const datorie = await cere('POST', '/vanzari', {
    token: admin,
    corp: {
      client_id,
      efectuat_la: new Date().toISOString(),
      achitat: false,
      linii: [{ articol_id: produs.id, cantitate: 2, pret_unitar: 150 }],
    },
  })
  verifica('POST /vanzari cu achitat:false -> 201, neachitată',
    datorie.status === 201 && datorie.corp?.achitat === false && datorie.corp?.achitat_la === null,
    JSON.stringify(datorie.corp))
  const datorie_id = datorie.corp?.id

  const fisaDatoare = await cere('GET', `/clienti/${client_id}`, { token: admin })
  verifica('produsele neachitate intră în de_incasat', fisaDatoare.corp?.de_incasat === 300,
    JSON.stringify(fisaDatoare.corp?.de_incasat))

  const doarDatorii = await cere('GET', `/vanzari?client_id=${client_id}&achitat=false`, {
    token: admin, statistici: stat,
  })
  verifica('GET /vanzari?achitat=false aduce doar datoriile',
    doarDatorii.corp?.total === 1 && doarDatorii.corp?.randuri?.[0]?.id === datorie_id,
    JSON.stringify(doarDatorii.corp?.randuri?.map((v: any) => v.id)))
  const doarAchitate = await cere('GET', `/vanzari?client_id=${client_id}&achitat=true`, {
    token: admin, statistici: stat,
  })
  verifica('GET /vanzari?achitat=true le lasă deoparte',
    doarAchitate.corp?.randuri?.every((v: any) => v.achitat === true)
      && !doarAchitate.corp?.randuri?.some((v: any) => v.id === datorie_id))

  const achitatText = await cere('POST', '/vanzari', {
    token: admin,
    corp: {
      client_id, efectuat_la: new Date().toISOString(), achitat: 'false',
      linii: [{ articol_id: produs.id, cantitate: 1 }],
    },
  })
  verifica('„achitat” trimis ca text -> 400 pe „achitat”',
    achitatText.status === 400 && achitatText.corp?.camp === 'achitat',
    JSON.stringify(achitatText.corp))

  const sedintePeDatorie = await cere('PATCH', `/vanzari/${incasare.corp?.id}`, {
    token: admin, corp: { achitat: false },
  })
  verifica('încasarea unor ședințe nu poate rămâne neachitată -> 400',
    sedintePeDatorie.status === 400 && sedintePeDatorie.corp?.camp === 'achitat',
    JSON.stringify(sedintePeDatorie.corp))
  verifica('ședința a rămas achitată după refuz',
    (await cere('GET', `/programari/${programare_id}`, { token: admin })).corp?.achitat === true)

  const achitata = await cere('PATCH', `/vanzari/${datorie_id}`, { token: admin, corp: { achitat: true } })
  verifica('PATCH { achitat: true } -> achitată acum',
    achitata.status === 200 && achitata.corp?.achitat === true
      && new Date(achitata.corp?.achitat_la) >= new Date(datorie.corp?.efectuat_la),
    JSON.stringify(achitata.corp?.achitat_la))
  verifica('datoria a dispărut de pe fișă',
    (await cere('GET', `/clienti/${client_id}`, { token: admin })).corp?.de_incasat === 0)

  const aDouaOara = await cere('PATCH', `/vanzari/${datorie_id}`, { token: admin, corp: { achitat: true } })
  verifica('a doua bifă nu mută data plății',
    aDouaOara.corp?.achitat_la === achitata.corp?.achitat_la)

  const debifata = await cere('PATCH', `/vanzari/${datorie_id}`, { token: admin, corp: { achitat: false } })
  verifica('PATCH { achitat: false } -> datoria revine',
    debifata.corp?.achitat === false
      && (await cere('GET', `/clienti/${client_id}`, { token: admin })).corp?.de_incasat === 300)
  await cere('PATCH', `/vanzari/${datorie_id}`, { token: admin, corp: { achitat: true } })

  // -------------------------------------------------------------------------
  console.log('\nRecepția, fără parola statisticilor — vede datoria și încasează')

  /*
    Parola statisticilor încuie rapoartele și lista TUTUROR încasărilor, nu
    banii unui client anume. Totul de aici e făcut cu contul de operator și
    FĂRĂ antetul statisticilor: exact ce are recepția la îndemână.
  */
  const clientRec = (await cere('POST', '/clienti', {
    token: operator, corp: { nume: `Client Recepție ${Date.now()}` },
  })).corp
  const sedintaRec = await cere('POST', '/programari', {
    token: operator,
    corp: {
      client_id: clientRec?.id, articol_id: serviciu.id, executant_id: executant.id,
      pret: 200, ...interval(33, 9),
    },
  })
  await cere('PATCH', `/programari/${sedintaRec.corp?.id}/stare`, {
    token: operator, corp: { stare: 'onorat' },
  })
  const datorieRec = await cere('POST', '/vanzari', {
    token: operator,
    corp: {
      client_id: clientRec?.id, efectuat_la: new Date().toISOString(), achitat: false,
      linii: [{ articol_id: produs.id, cantitate: 1, pret_unitar: 50 }],
    },
  })
  verifica('operatorul programează, onorează și vinde pe datorie fără parola statisticilor',
    sedintaRec.status === 201 && datorieRec.status === 201,
    JSON.stringify({ sedinta: sedintaRec.corp?.mesaj, vanzare: datorieRec.corp?.mesaj }))

  const listaRec = await cere('GET', '/vanzari', { token: operator })
  verifica('pentru el, lista tuturor încasărilor rămâne încuiată -> 403',
    listaRec.status === 403 && listaRec.corp?.camp === 'acces_statistici')

  const fisaRec = await cere('GET', `/clienti/${clientRec?.id}`, { token: operator })
  verifica('dar vede pe fișă cât are clientul de plată (ședința + produsul)',
    fisaRec.status === 200 && fisaRec.corp?.de_incasat === 250,
    JSON.stringify(fisaRec.corp?.de_incasat ?? fisaRec.corp))

  const cautareRec = await cere('GET', `/clienti?q=${encodeURIComponent(clientRec?.nume ?? '')}`, {
    token: operator,
  })
  verifica('și în lista clienților, pe coloana „De plată”',
    cautareRec.corp?.randuri?.find((c: any) => c.id === clientRec?.id)?.de_incasat === 250,
    JSON.stringify(cautareRec.corp?.randuri?.map((c: any) => c.de_incasat)))

  const istoricRec = await cere('GET', `/clienti/${clientRec?.id}/istoric`, { token: operator })
  verifica('istoricul clientului arată ce e neachitat, cu prețul',
    istoricRec.status === 200
      && istoricRec.corp?.some((i: any) => i.fel === 'programare'
        && i.programare.achitat === false && i.programare.pret === 200)
      && istoricRec.corp?.some((i: any) => i.fel === 'vanzare'
        && i.vanzare.achitat === false && i.vanzare.total === 50),
    JSON.stringify(istoricRec.corp?.map((i: any) => i.fel)))

  const bonRec = await cere('GET', `/vanzari/${datorieRec.corp?.id}`, { token: operator })
  verifica('un bon anume se deschide fără parolă', bonRec.status === 200 && bonRec.corp?.total === 50)

  const incasareRec = await cere('POST', '/vanzari/incasare', {
    token: operator, corp: { client_id: clientRec?.id, programare_ids: [sedintaRec.corp?.id] },
  })
  const achitareRec = await cere('PATCH', `/vanzari/${datorieRec.corp?.id}`, {
    token: operator, corp: { achitat: true },
  })
  verifica('operatorul încasează ședința și produsele luate pe datorie',
    incasareRec.status === 201 && achitareRec.status === 200 && achitareRec.corp?.achitat === true,
    JSON.stringify({ incasare: incasareRec.corp?.mesaj, achitare: achitareRec.corp?.mesaj }))
  verifica('după plată, fișa nu mai are nimic de încasat',
    (await cere('GET', `/clienti/${clientRec?.id}`, { token: operator })).corp?.de_incasat === 0)

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

  // Numele e unic în bază (`utilizator_nume_uk`), la fel ca e-mailul: al doilea
  // rulaj cu același „Cont Test” ar fi primit 409 în loc de 201.
  const marcaj = Date.now()
  const contNou = await cere('POST', '/utilizatori', {
    token: admin,
    corp: {
      nume: `Cont Test ${marcaj}`, email: `test.${marcaj}@clinica.ro`,
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
  console.log('\nTratamente — servicii în mai multe ședințe')

  // Un serviciu propriu acestei rulări, cu 3 ședințe la 300 în total; un
  // client propriu, ca numărătorile de mai jos să pornească de la zero.
  const marcajT = Date.now()
  const cura = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'serviciu', denumire: `Cură Test ${marcajT}`, durata_minute: 30, pret_lista: 300, numar_sedinte: 3 },
  })
  verifica('POST /articole cu numar_sedinte -> 201, coloana se întoarce',
    cura.status === 201 && cura.corp?.numar_sedinte === 3, JSON.stringify(cura.corp))

  const produsCuSedinte = await cere('POST', '/articole', {
    token: admin,
    corp: { tip: 'produs', denumire: `Cremă în rate ${marcajT}`, pret_lista: 10, numar_sedinte: 4 },
  })
  verifica('produs cu numar_sedinte -> 400 pe „numar_sedinte”',
    produsCuSedinte.status === 400 && produsCuSedinte.corp?.camp === 'numar_sedinte',
    JSON.stringify(produsCuSedinte.corp))

  const pacient = (await cere('POST', '/clienti', {
    token: admin, corp: { nume: `Client Tratament ${marcajT}` },
  })).corp
  const cura_id = cura.corp?.id as string

  const sugestieCura = await cere(
    'GET', `/programari/pret-sugerat?client_id=${pacient.id}&articol_id=${cura_id}`, { token: admin },
  )
  verifica('pret-sugerat la un serviciu în 3 ședințe -> a treia parte, cu tratament nou (id null)',
    sugestieCura.corp?.pret === 100 && sugestieCura.corp?.tratament?.id === null
      && sugestieCura.corp?.tratament?.numar_sedinte === 3 && sugestieCura.corp?.tratament?.sedinta_nr === 1
      && sugestieCura.corp?.tratament?.pret_total === 300,
    JSON.stringify(sugestieCura.corp))

  const s1 = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: cura_id, executant_id: executant.id, ...interval(40, 9, 30) },
  })
  verifica('prima ședință deschide tratamentul singură: tratament_id completat, sedinta_nr 1 din 3',
    s1.status === 201 && typeof s1.corp?.tratament_id === 'string'
      && s1.corp?.sedinta_nr === 1 && s1.corp?.tratament_numar_sedinte === 3 && s1.corp?.pret === 100,
    JSON.stringify(s1.corp))
  const tratament_id = s1.corp?.tratament_id as string

  const t1 = await cere('GET', `/tratamente/${tratament_id}`, { token: admin })
  verifica('GET /tratamente/:id -> hidratat, numărat din ședințe',
    t1.status === 200 && t1.corp?.sedinte_programate === 1 && t1.corp?.sedinte_onorate === 0
      && t1.corp?.sedinte_ramase === 2 && t1.corp?.alocat === 100 && t1.corp?.incasat === 0
      && t1.corp?.pret_urmatoarea === 100 && t1.corp?.incheiat_la === null
      && t1.corp?.client_nume === pacient.nume,
    JSON.stringify(t1.corp))
  verifica('tratamentul are toate coloanele din tip',
    ['id', 'client_id', 'articol_id', 'numar_sedinte', 'pret_total', 'nota', 'incheiat_la', 'creat_de',
      'creat_la', 'actualizat_la', 'client_nume', 'articol_denumire', 'sedinte_programate', 'sedinte_onorate',
      'sedinte_ramase', 'alocat', 'incasat', 'de_incasat', 'pret_urmatoarea', 'urmatoarea_la', 'ultima_la']
      .every((c) => c in (t1.corp ?? {})),
    JSON.stringify(Object.keys(t1.corp ?? {})))

  // Prima ședință se închide cu 130 în loc de 100: suma se corectează pe loc.
  const s1Onorata = await cere('PATCH', `/programari/${s1.corp.id}/stare`, {
    token: admin, corp: { stare: 'onorat', achitat: true, pret: 130 },
  })
  verifica('PATCH stare cu pret corectat și achitat -> ședința are prețul nou și e achitată',
    s1Onorata.status === 200 && s1Onorata.corp?.pret === 130 && s1Onorata.corp?.achitat === true,
    JSON.stringify(s1Onorata.corp))

  const t2 = await cere('GET', `/tratamente/${tratament_id}`, { token: admin })
  verifica('restul se reîmparte: (300 - 130) / 2 = 85 pe ședința următoare, încasat 130',
    t2.corp?.pret_urmatoarea === 85 && t2.corp?.incasat === 130 && t2.corp?.sedinte_onorate === 1,
    JSON.stringify(t2.corp))

  const sugestie2 = await cere(
    'GET', `/programari/pret-sugerat?client_id=${pacient.id}&articol_id=${cura_id}`, { token: admin },
  )
  verifica('pret-sugerat pentru a doua ședință -> 85, în tratamentul existent, ședința 2',
    sugestie2.corp?.pret === 85 && sugestie2.corp?.tratament?.id === tratament_id
      && sugestie2.corp?.tratament?.sedinta_nr === 2,
    JSON.stringify(sugestie2.corp))

  const s2 = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: cura_id, executant_id: executant.id, tratament_id, ...interval(41, 9, 30) },
  })
  const s3 = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: cura_id, executant_id: executant.id, ...interval(42, 9, 30) },
  })
  verifica('ședințele 2 și 3 intră în același tratament, cu partea lor (85 și 85)',
    s2.corp?.tratament_id === tratament_id && s3.corp?.tratament_id === tratament_id
      && s2.corp?.pret === 85 && s3.corp?.pret === 85 && s3.corp?.sedinta_nr === 3,
    JSON.stringify([s2.corp?.pret, s3.corp?.pret, s3.corp?.sedinta_nr]))

  const s4 = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: cura_id, executant_id: executant.id, ...interval(43, 9, 30) },
  })
  verifica('a patra ședință într-un tratament de 3 -> 409',
    s4.status === 409 && s4.corp?.camp === 'tratament_id', `a venit ${s4.status}: ${JSON.stringify(s4.corp)}`)

  const mutataPeAltClient = await cere('PATCH', `/programari/${s3.corp.id}`, {
    token: admin, corp: { client_id },
  })
  verifica('ședința unui tratament nu se mută pe alt client -> 400',
    mutataPeAltClient.status === 400 && mutataPeAltClient.corp?.camp === 'client_id',
    JSON.stringify(mutataPeAltClient.corp))

  const anulata = await cere('PATCH', `/programari/${s3.corp.id}/stare`, {
    token: admin, corp: { stare: 'anulat' },
  })
  const t3 = await cere('GET', `/tratamente/${tratament_id}`, { token: admin })
  verifica('ședința anulată nu mai ocupă locul: rămâne 1 de programat, iar ea nu are sedinta_nr',
    anulata.corp?.sedinta_nr === null && t3.corp?.sedinte_ramase === 1 && t3.corp?.pret_urmatoarea === 85,
    JSON.stringify(t3.corp))

  const maiPutine = await cere('PATCH', `/tratamente/${tratament_id}`, {
    token: admin, corp: { numar_sedinte: 1 },
  })
  verifica('PATCH /tratamente sub ședințele existente -> 400',
    maiPutine.status === 400 && maiPutine.corp?.camp === 'numar_sedinte', JSON.stringify(maiPutine.corp))

  const maiMulte = await cere('PATCH', `/tratamente/${tratament_id}`, {
    token: admin, corp: { numar_sedinte: 4, pret_total: 400, nota: 'Încă o ședință, cadou.' },
  })
  verifica('PATCH /tratamente -> 4 ședințe, 400 lei; următoarea = (400 - 215) / 2 = 92,5',
    maiMulte.status === 200 && maiMulte.corp?.numar_sedinte === 4 && maiMulte.corp?.pret_total === 400
      && maiMulte.corp?.sedinte_ramase === 2 && maiMulte.corp?.pret_urmatoarea === 92.5
      && maiMulte.corp?.nota === 'Încă o ședință, cadou.',
    JSON.stringify(maiMulte.corp))

  const listaInCurs = await cere('GET', `/tratamente?client_id=${pacient.id}&in_curs=true`, { token: admin })
  verifica('GET /tratamente?in_curs=true -> anvelopă paginată cu tratamentul',
    listaInCurs.corp?.total === 1 && listaInCurs.corp?.randuri?.[0]?.id === tratament_id,
    JSON.stringify(listaInCurs.corp))

  const sedinteleLui = await cere('GET', `/programari?tratament_id=${tratament_id}`, { token: admin })
  verifica('GET /programari?tratament_id= -> ședințele lui, toate trei (și cea anulată)',
    Array.isArray(sedinteleLui.corp) && sedinteleLui.corp.length === 3,
    `${sedinteleLui.corp?.length}`)

  const alDoilea = await cere('POST', '/tratamente', {
    token: admin, corp: { client_id: pacient.id, articol_id: cura_id },
  })
  verifica('al doilea tratament în curs pentru aceeași pereche -> 409',
    alDoilea.status === 409, `a venit ${alDoilea.status}: ${JSON.stringify(alDoilea.corp)}`)

  const incheiat = await cere('POST', `/tratamente/${tratament_id}/incheiere`, { token: admin })
  verifica('POST /tratamente/:id/incheiere -> incheiat_la completat',
    incheiat.status === 200 && typeof incheiat.corp?.incheiat_la === 'string', JSON.stringify(incheiat.corp))

  const peIncheiat = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: cura_id, executant_id: executant.id, tratament_id, ...interval(44, 9, 30) },
  })
  verifica('ședință explicit într-un tratament încheiat -> 400',
    peIncheiat.status === 400 && peIncheiat.corp?.camp === 'tratament_id', JSON.stringify(peIncheiat.corp))

  const dupaIncheiere = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: cura_id, executant_id: executant.id, ...interval(45, 9, 30) },
  })
  // Cel precedent avea 4 ședințe la 400; nomenclatorul spune 3. Prețul reținut
  // nu se aplică la alt număr de ședințe: pornește de la listă, 300 / 3.
  verifica('după încheiere, o ședință nouă deschide ALT tratament; 400 pe 4 ședințe nu se reține pentru 3',
    dupaIncheiere.status === 201 && dupaIncheiere.corp?.tratament_id !== tratament_id
      && dupaIncheiere.corp?.sedinta_nr === 1 && dupaIncheiere.corp?.pret === 100,
    JSON.stringify(dupaIncheiere.corp))
  const alDoilea_id = dupaIncheiere.corp?.tratament_id as string

  const redeschis = await cere('POST', `/tratamente/${tratament_id}/redeschidere`, { token: admin })
  verifica('redeschiderea cu alt tratament în curs -> 409',
    redeschis.status === 409, `a venit ${redeschis.status}: ${JSON.stringify(redeschis.corp)}`)

  // Același număr de ședințe, alt preț convenit: ACELA se reține data viitoare.
  await cere('PATCH', `/tratamente/${alDoilea_id}`, { token: admin, corp: { pret_total: 270 } })
  await cere('POST', `/tratamente/${alDoilea_id}/incheiere`, { token: admin })
  const sugestieRetinuta = await cere(
    'GET', `/programari/pret-sugerat?client_id=${pacient.id}&articol_id=${cura_id}`, { token: admin },
  )
  verifica('prețul total convenit (270 pe 3 ședințe) se reține: 90 pe ședință, din_istoric',
    sugestieRetinuta.corp?.pret === 90 && sugestieRetinuta.corp?.din_istoric === true
      && sugestieRetinuta.corp?.tratament?.pret_total === 270 && sugestieRetinuta.corp?.tratament?.id === null,
    JSON.stringify(sugestieRetinuta.corp))

  // Un tratament de o singură ședință se încheie singur la onorarea ei.
  const scurt = await cere('POST', '/tratamente', {
    token: admin, corp: { client_id: pacient.id, articol_id: serviciu.id, numar_sedinte: 1, pret_total: 50 },
  })
  const unica = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: pacient.id, articol_id: serviciu.id, executant_id: executant.id, ...interval(46, 9, 30) },
  })
  await cere('PATCH', `/programari/${unica.corp.id}/stare`, { token: admin, corp: { stare: 'onorat' } })
  const scurtDupa = await cere('GET', `/tratamente/${scurt.corp?.id}`, { token: admin })
  verifica('ultima ședință onorată încheie tratamentul singură',
    unica.corp?.tratament_id === scurt.corp?.id && typeof scurtDupa.corp?.incheiat_la === 'string'
      && scurtDupa.corp?.sedinte_onorate === 1 && scurtDupa.corp?.de_incasat === 50,
    JSON.stringify(scurtDupa.corp))

  // -------------------------------------------------------------------------
  console.log('\nMai multe servicii într-o programare')

  // Un client propriu, ca prețurile să pornească de la listă; cura de 3 ședințe
  // de mai sus are ambele tratamente încheiate, deci deschide unul nou.
  const altServiciu = articole.corp.find((a: any) => a.numar_sedinte === 1 && a.id !== serviciu.id)
  const vizitator = (await cere('POST', '/clienti', {
    token: admin, corp: { nume: `Client Vizită ${marcajT}` },
  })).corp
  const locVizita = interval(60, 10, 90)
  const serviciileVizitei = async (vizita_id: string) =>
    (await cere('GET', `/programari?vizita_id=${vizita_id}`, { token: admin })).corp as any[]

  const multipla = await cere('POST', '/programari', {
    token: admin,
    corp: {
      client_id: vizitator.id, executant_id: executant.id, ...locVizita, nota: 'Trei deodată',
      servicii: [
        { articol_id: serviciu.id, pret: 120 },
        { articol_id: cura_id },
        { articol_id: altServiciu.id },
      ],
    },
  })
  verifica('POST /programari cu 3 servicii -> 201, cu primul serviciu și vizita_id',
    multipla.status === 201 && multipla.corp?.articol_id === serviciu.id && multipla.corp?.pret === 120
      && typeof multipla.corp?.vizita_id === 'string',
    `a venit ${multipla.status}: ${JSON.stringify(multipla.corp)}`)
  const vizita_id = multipla.corp?.vizita_id as string

  const cele3 = await serviciileVizitei(vizita_id)
  verifica('GET /programari?vizita_id= -> toate 3, în ordinea trimisă, cu același client, interval și notă',
    cele3?.length === 3
      && cele3.map((s) => s.articol_id).join() === [serviciu.id, cura_id, altServiciu.id].join()
      && cele3.every((s) => s.client_id === vizitator.id && s.incepe_la === multipla.corp.incepe_la
        && s.se_termina_la === multipla.corp.se_termina_la && s.nota === 'Trei deodată'),
    JSON.stringify(cele3?.map((s) => [s.articol_denumire, s.incepe_la])))
  const [sPrim, sCura, sAl3lea] = cele3
  verifica('ședința de cură își deschide tratamentul și ia partea ei (300 / 3 = 100)',
    typeof sCura?.tratament_id === 'string' && sCura?.sedinta_nr === 1 && sCura?.pret === 100,
    JSON.stringify(sCura))
  verifica('serviciul fără preț ia prețul de listă', sAl3lea?.pret === altServiciu.pret_lista,
    `${sAl3lea?.pret} vs ${altServiciu.pret_lista}`)

  const pesteVizita = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id, articol_id: serviciu.id, executant_id: executant.id, ...locVizita },
  })
  verifica('altă programare peste ea, la aceeași persoană -> 409', pesteVizita.status === 409,
    `a venit ${pesteVizita.status}`)

  const cuProdus = await cere('POST', '/programari', {
    token: admin,
    corp: {
      client_id: vizitator.id, executant_id: executant.id, ...interval(61, 10),
      servicii: [{ articol_id: serviciu.id }, { articol_id: produs.id }],
    },
  })
  verifica('un produs pe locul al doilea -> 400 pe „servicii.1.articol_id”',
    cuProdus.status === 400 && cuProdus.corp?.camp === 'servicii.1.articol_id', JSON.stringify(cuProdus.corp))
  const faraServicii = await cere('POST', '/programari', {
    token: admin,
    corp: { client_id: vizitator.id, executant_id: executant.id, ...interval(61, 10), servicii: [] },
  })
  verifica('servicii: [] -> 400 pe „servicii”',
    faraServicii.status === 400 && faraServicii.corp?.camp === 'servicii', JSON.stringify(faraServicii.corp))
  const alVizitatorului = await cere('GET', `/programari?client_id=${vizitator.id}`, { token: admin })
  verifica('programările refuzate nu au lăsat niciun serviciu scris', alVizitatorului.corp?.length === 3,
    `${alVizitatorului.corp?.length}`)

  const dubla = await cere('POST', '/programari', {
    token: admin,
    corp: {
      client_id: vizitator.id, executant_id: executant.id, ...interval(62, 10, 60),
      servicii: [{ articol_id: cura_id }, { articol_id: cura_id }],
    },
  })
  const douaSedinte = await serviciileVizitei(dubla.corp?.vizita_id)
  verifica('două ședințe din același tratament într-o programare -> ședințele 2 și 3, câte 100',
    douaSedinte?.length === 2 && douaSedinte.every((s) => s.tratament_id === sCura.tratament_id && s.pret === 100)
      && douaSedinte.map((s) => s.sedinta_nr).sort().join() === '2,3',
    JSON.stringify(douaSedinte?.map((s) => [s.sedinta_nr, s.pret])))
  const aPatra = await cere('POST', '/programari', {
    token: admin,
    corp: {
      client_id: vizitator.id, executant_id: executant.id, ...interval(63, 10),
      servicii: [{ articol_id: cura_id }],
    },
  })
  verifica('a patra ședință într-un tratament de 3 -> 409 pe „servicii.0.tratament_id”',
    aPatra.status === 409 && aPatra.corp?.camp === 'servicii.0.tratament_id', JSON.stringify(aPatra.corp))

  const loculNou = interval(64, 10, 90)
  const mutataToata = await cere('PATCH', `/programari/${sAl3lea.id}`, { token: admin, corp: loculNou })
  const dupaMutare = await serviciileVizitei(vizita_id)
  verifica('PATCH pe un singur serviciu mută TOATĂ programarea',
    mutataToata.status === 200 && dupaMutare.every((s) =>
      s.incepe_la === loculNou.incepe_la && s.se_termina_la === loculNou.se_termina_la),
    JSON.stringify(dupaMutare?.map((s) => s.incepe_la)))

  const editata = await cere('PATCH', `/programari/${sPrim.id}`, {
    token: admin,
    corp: {
      servicii: [
        { id: sCura.id, articol_id: cura_id, pret: sCura.pret },
        { id: sAl3lea.id, articol_id: altServiciu.id, pret: 55 },
        { articol_id: serviciu.id, pret: 70 },
      ],
    },
  })
  verifica('PATCH cu lista de servicii -> 200; cel cerut a fost scos, deci răspunde primul rămas',
    editata.status === 200 && editata.corp?.id === sCura.id, `a venit ${editata.status}: ${JSON.stringify(editata.corp)}`)
  const dupaEditare = await serviciileVizitei(vizita_id)
  verifica('lista nouă: ședința neatinsă, prețul nou, serviciul adăugat în același interval',
    dupaEditare?.map((s) => s.pret).join() === '100,55,70'
      && dupaEditare[2]?.articol_id === serviciu.id && dupaEditare[2]?.incepe_la === loculNou.incepe_la,
    JSON.stringify(dupaEditare?.map((s) => [s.articol_denumire, s.pret])))
  const scos = await cere('GET', `/programari/${sPrim.id}`, { token: admin })
  verifica('serviciul scos rămâne în istoric: anulat, într-o programare a lui',
    scos.corp?.stare === 'anulat' && scos.corp?.vizita_id !== vizita_id, JSON.stringify(scos.corp))

  const adaugat = dupaEditare[2]
  const onorataToata = await cere('PATCH', `/programari/${sCura.id}/stare`, {
    token: admin, corp: { stare: 'onorat', achitat: true, preturi: { [adaugat.id]: 80 } },
  })
  const dupaOnorare = await serviciileVizitei(vizita_id)
  verifica('onorat + achitat pe un serviciu -> toate serviciile onorate și achitate',
    onorataToata.status === 200 && dupaOnorare.every((s) => s.stare === 'onorat' && s.achitat === true),
    JSON.stringify(dupaOnorare?.map((s) => [s.stare, s.achitat])))
  const bonuri = new Set(dupaOnorare.map((s) => s.vanzare_id))
  const bonulVizitei = await cere('GET', `/vanzari/${[...bonuri][0]}`, { token: admin })
  verifica('toate pe UN bon, câte o linie pe serviciu, cu suma corectată (100 + 55 + 80 = 235)',
    bonuri.size === 1 && bonulVizitei.corp?.linii?.length === 3 && bonulVizitei.corp?.total === 235,
    JSON.stringify({ bonuri: bonuri.size, total: bonulVizitei.corp?.total }))

  const anulareRefuzata = await cere('PATCH', `/programari/${sAl3lea.id}/stare`, {
    token: admin, corp: { stare: 'anulat' },
  })
  verifica('o programare cu servicii încasate nu se anulează -> 400 pe „stare”',
    anulareRefuzata.status === 400 && anulareRefuzata.corp?.camp === 'stare', JSON.stringify(anulareRefuzata.corp))
  const scoatereRefuzata = await cere('PATCH', `/programari/${sCura.id}`, {
    token: admin, corp: { servicii: [{ id: sCura.id, articol_id: cura_id }] },
  })
  verifica('un serviciu încasat nu se scoate din programare -> 400 pe „servicii”',
    scoatereRefuzata.status === 400 && scoatereRefuzata.corp?.camp === 'servicii', JSON.stringify(scoatereRefuzata.corp))
  const acelasiPret = await cere('PATCH', `/programari/${sAl3lea.id}`, {
    token: admin, corp: { pret: 55, nota: 'Doar nota, prețul la fel' },
  })
  verifica('pe un serviciu încasat, prețul retrimis NESCHIMBAT nu mai cade -> 200',
    acelasiPret.status === 200 && acelasiPret.corp?.nota === 'Doar nota, prețul la fel',
    `a venit ${acelasiPret.status}: ${JSON.stringify(acelasiPret.corp)}`)

  const cuUnulInPlus = await cere('PATCH', `/programari/${sCura.id}`, {
    token: admin,
    corp: {
      servicii: [
        ...dupaOnorare.map((s) => ({ id: s.id, articol_id: s.articol_id })),
        { articol_id: altServiciu.id, pret: 40 },
      ],
    },
  })
  const cuPatru = await serviciileVizitei(vizita_id)
  const fisaVizitator = await cere('GET', `/clienti/${vizitator.id}`, { token: admin })
  verifica('adăugat la o programare onorată, serviciul e onorat și rămâne de plată (40 pe fișă)',
    cuUnulInPlus.status === 200 && cuPatru?.length === 4 && cuPatru[3]?.stare === 'onorat'
      && cuPatru[3]?.achitat === false && fisaVizitator.corp?.de_incasat === 40,
    JSON.stringify({ n: cuPatru?.length, ultimul: cuPatru?.[3]?.stare, de_incasat: fisaVizitator.corp?.de_incasat }))

  // -------------------------------------------------------------------------
  console.log('\nStatistici — raportul și cheltuielile')

  /*
    O zi numai a acestei rulări, departe în viitor: raportul numără TOT ce are
    loc în perioadă, deci cifrele se pot aștepta exact doar într-o zi în care
    nu mai scrie nimeni altcineva. Între 2080 și 2099 sunt 7300 de zile; două
    rulări nimeresc aceeași zi o dată la câteva mii.
  */
  const ZI_MS = 86_400_000
  const ziText = (d: Date) => d.toISOString().slice(0, 10)
  const D = new Date(Date.UTC(2080, 0, 1) + Math.floor(Math.random() * 7300) * ZI_MS)
  const ziua = ziText(D)
  const ziuaDinainte = ziText(new Date(D.getTime() - ZI_MS))
  // Orele sunt UTC; 07:00–13:00 UTC cad în aceeași zi și la București (+2/+3).
  const la = (ora: number) => new Date(D.getTime() + ora * 3_600_000).toISOString()
  const ora = (inceput: number) => ({ incepe_la: la(inceput), se_termina_la: la(inceput + 0.75) })

  const clientStat = (await cere('POST', '/clienti', {
    token: admin, corp: { nume: `Test Statistici ${Date.now()}` },
  })).corp
  const programeaza = async (inceput: number, pret: number) =>
    (await cere('POST', '/programari', {
      token: admin,
      corp: { client_id: clientStat.id, articol_id: serviciu.id, executant_id: executant.id, pret, ...ora(inceput) },
    })).corp

  // A: onorată și plătită, cu două produse pe același bon. B: onorată, neplătită.
  // C: neprezentare.
  const sedintaA = await programeaza(7, 200)
  const sedintaB = await programeaza(8, 80)
  const sedintaC = await programeaza(9, 150)
  await cere('PATCH', `/programari/${sedintaA.id}/stare`, { token: admin, corp: { stare: 'onorat' } })
  await cere('PATCH', `/programari/${sedintaB.id}/stare`, { token: admin, corp: { stare: 'onorat' } })
  await cere('PATCH', `/programari/${sedintaC.id}/stare`, { token: admin, corp: { stare: 'neprezentat' } })
  const bonStat = await cere('POST', '/vanzari/incasare', {
    token: admin,
    corp: {
      client_id: clientStat.id,
      programare_ids: [sedintaA.id],
      efectuat_la: la(12),
      linii: [{ articol_id: produs.id, cantitate: 2, pret_unitar: 50 }],
    },
  })
  verifica('pregătire: bonul zilei, 300 lei', bonStat.corp?.total === 300, JSON.stringify(bonStat.corp))
  // O cremă dată pe datorie în aceeași zi.
  await cere('POST', '/vanzari', {
    token: admin,
    corp: {
      client_id: clientStat.id, efectuat_la: la(10), achitat: false,
      linii: [{ articol_id: produs.id, cantitate: 1, pret_unitar: 40 }],
    },
  })

  const cheltuieliIncuiate = await cere('GET', '/cheltuieli', { token: admin })
  verifica('cheltuielile fără deblocare -> 403', cheltuieliIncuiate.status === 403
    && cheltuieliIncuiate.corp?.camp === 'acces_statistici')

  const acces = { token: admin, statistici: stat }
  const chirie = await cere('POST', '/cheltuieli', {
    ...acces, corp: { data: ziua, categorie: 'Chirie test', suma: 120, descriere: 'Chiria lunii' },
  })
  verifica('POST /cheltuieli -> 201, cu autorul',
    chirie.status === 201 && chirie.corp?.suma === 120 && chirie.corp?.data === ziua
      && typeof chirie.corp?.creat_de_nume === 'string',
    JSON.stringify(chirie.corp))
  const chirieMica = await cere('POST', '/cheltuieli', {
    ...acces, corp: { data: ziua, categorie: '  chirie TEST ', suma: 30 },
  })
  verifica('categoria scrisă altfel se lipește de cea existentă',
    chirieMica.status === 201 && chirieMica.corp?.categorie === 'Chirie test',
    JSON.stringify(chirieMica.corp?.categorie))

  for (const [corp, camp] of [
    [{ data: ziua, categorie: 'X', suma: 0 }, 'suma'],
    [{ data: '2081-02-30', categorie: 'X', suma: 5 }, 'data'],
    [{ data: `${ziua}T10:00:00Z`, categorie: 'X', suma: 5 }, 'data'],
    [{ data: ziua, categorie: '   ', suma: 5 }, 'categorie'],
  ] as const) {
    const r = await cere('POST', '/cheltuieli', { ...acces, corp })
    verifica(`cheltuială greșită -> 400 pe „${camp}”`, r.status === 400 && r.corp?.camp === camp,
      JSON.stringify(r.corp))
  }

  const cheltuieliZilei = await cere('GET', `/cheltuieli?de_la=${ziua}&pana_la=${ziua}`, acces)
  verifica('GET /cheltuieli -> paginat, cu suma filtrului',
    cheltuieliZilei.corp?.total === 2 && cheltuieliZilei.corp?.suma === 150
      && cheltuieliZilei.corp?.randuri?.length === 2,
    JSON.stringify({ total: cheltuieliZilei.corp?.total, suma: cheltuieliZilei.corp?.suma }))
  const categorii = await cere('GET', '/cheltuieli/categorii', acces)
  verifica('GET /cheltuieli/categorii -> listă de texte',
    Array.isArray(categorii.corp) && categorii.corp.includes('Chirie test'))

  const raportZi = (extra = '') =>
    cere('GET', `/statistici?de_la=${ziua}&pana_la=${ziua}&pas=zi&fus=Europe/Bucharest${extra}`, acces)
  const raport = await raportZi(`&comparatie_de_la=${ziuaDinainte}&comparatie_pana_la=${ziuaDinainte}`)
  const t = raport.corp?.total
  verifica('GET /statistici -> 200', raport.status === 200, JSON.stringify(raport.corp))
  verifica('încasat = bonul plătit (300 = 200 ședință + 100 produse)',
    t?.incasat === 300 && t?.incasat_servicii === 200 && t?.incasat_produse === 100 && t?.incasari === 1,
    JSON.stringify(t))
  verifica('cheltuieli 150, profit 150', t?.cheltuieli === 150 && t?.profit === 150, JSON.stringify(t))
  verifica('neachitat = ședința neplătită (80) + crema pe datorie (40)', t?.neachitat === 120,
    JSON.stringify(t?.neachitat))
  verifica('programările după stare: 2 onorate, 1 neprezentată',
    t?.programari_onorate === 2 && t?.programari_neprezentate === 1
      && t?.programari_anulate === 0 && t?.programari_programate === 0,
    JSON.stringify(t))
  verifica('un client servit, niciunul nou în ziua aceea', t?.clienti === 1 && t?.clienti_noi === 0,
    JSON.stringify(t))
  verifica('comparația cu ziua dinainte e goală',
    raport.corp?.comparatie?.incasat === 0 && raport.corp?.comparatie?.programari_onorate === 0,
    JSON.stringify(raport.corp?.comparatie))
  verifica('o bară pe zi, cu banii ei',
    raport.corp?.perioade?.length === 1 && raport.corp.perioade[0].inceput === ziua
      && raport.corp.perioade[0].incasat_servicii === 200
      && raport.corp.perioade[0].incasat_produse === 100
      && raport.corp.perioade[0].cheltuieli === 150,
    JSON.stringify(raport.corp?.perioade))
  verifica('serviciile și produsele, după bani',
    raport.corp?.servicii?.[0]?.articol_id === serviciu.id && raport.corp.servicii[0].suma === 200
      && raport.corp.servicii[0].cantitate === 1
      && raport.corp?.produse?.[0]?.articol_id === produs.id && raport.corp.produse[0].cantitate === 2,
    JSON.stringify({ s: raport.corp?.servicii, p: raport.corp?.produse }))
  const persoana = raport.corp?.persoane?.find((p: any) => p.utilizator_id === executant.id)
  verifica('pe persoane: ședințele ei și banii din ele',
    persoana?.incasat === 200 && persoana?.programari_onorate === 2, JSON.stringify(raport.corp?.persoane))
  verifica('cheltuielile pe categorii',
    raport.corp?.cheltuieli?.length === 1 && raport.corp.cheltuieli[0].categorie === 'Chirie test'
      && raport.corp.cheltuieli[0].suma === 150 && raport.corp.cheltuieli[0].numar === 2,
    JSON.stringify(raport.corp?.cheltuieli))
  const isodow = ((D.getUTCDay() + 6) % 7) + 1
  verifica('zilele săptămânii: toate șapte, cu cele două onorate în ziua lor',
    raport.corp?.zile_saptamana?.length === 7
      && raport.corp.zile_saptamana.find((z: any) => z.zi === isodow)?.programari === 2,
    JSON.stringify(raport.corp?.zile_saptamana))
  verifica('clienții după bani',
    raport.corp?.clienti?.[0]?.client_id === clientStat.id && raport.corp.clienti[0].incasat === 300
      && raport.corp.clienti[0].incasari === 1,
    JSON.stringify(raport.corp?.clienti))

  const peSaptamani = await cere('GET',
    `/statistici?de_la=${ziua}&pana_la=${ziText(new Date(D.getTime() + 20 * ZI_MS))}&pas=saptamana`, acces)
  const lunile = (peSaptamani.corp?.perioade ?? []) as any[]
  verifica('pe săptămâni: bare care încep lunea, la 7 zile una de alta',
    lunile.length >= 3 && lunile.every((p, i) =>
      new Date(`${p.inceput}T00:00:00Z`).getUTCDay() === 1
      && (i === 0 || new Date(p.inceput).getTime() - new Date(lunile[i - 1].inceput).getTime() === 7 * ZI_MS)),
    JSON.stringify(lunile.map((p) => p.inceput)))
  verifica('suma barelor = totalul perioadei',
    lunile.reduce((s, p) => s + p.incasat_servicii + p.incasat_produse, 0) === peSaptamani.corp?.total?.incasat)

  const peLuni = await cere('GET',
    `/statistici?de_la=${ziua}&pana_la=${ziText(new Date(D.getTime() + 40 * ZI_MS))}&pas=luna`, acces)
  verifica('pe luni: prima bară începe pe 1',
    peLuni.corp?.perioade?.[0]?.inceput === `${ziua.slice(0, 7)}-01`,
    JSON.stringify(peLuni.corp?.perioade?.map((p: any) => p.inceput)))

  for (const [interogare, camp] of [
    [`de_la=${ziua}&pana_la=${ziuaDinainte}`, 'pana_la'],
    [`de_la=${ziua}&pana_la=${ziua}&pas=ora`, 'pas'],
    [`de_la=${ziua}&pana_la=${ziua}&fus=Marte/Olimp`, 'fus'],
    [`de_la=${ziua}&pana_la=${ziua}&fus=${encodeURIComponent('+02:00')}`, 'fus'],
    [`de_la=${ziua}&pana_la=${ziua}&pas=toString`, 'pas'],
    [`de_la=${ziua}&pana_la=${ziua}&pas=__proto__`, 'pas'],
    [`de_la=ieri&pana_la=${ziua}`, 'de_la'],
    [`de_la=2080-01-01&pana_la=2082-01-01&pas=zi`, 'pas'],
    [`de_la=${ziua}&pana_la=${ziua}&comparatie_de_la=${ziua}`, 'comparatie_pana_la'],
  ] as const) {
    const r = await cere('GET', `/statistici?${interogare}`, acces)
    verifica(`raport cerut greșit -> 400 pe „${camp}”`, r.status === 400 && r.corp?.camp === camp,
      `${r.status} ${JSON.stringify(r.corp)}`)
  }
  verifica('un an întreg zi cu zi încape',
    (await cere('GET', '/statistici?de_la=2081-01-01&pana_la=2081-12-31&pas=zi', acces)).status === 200)

  const corectata = await cere('PATCH', `/cheltuieli/${chirieMica.corp?.id}`, { ...acces, corp: { suma: 60 } })
  verifica('PATCH /cheltuieli/:id -> suma nouă', corectata.status === 200 && corectata.corp?.suma === 60)
  const cheltuialaStearsa = await cere('DELETE', `/cheltuieli/${chirie.corp?.id}`, acces)
  verifica('DELETE /cheltuieli/:id -> 204', cheltuialaStearsa.status === 204)
  const dupaCorectii = (await raportZi()).corp?.total
  verifica('profitul urmează cheltuielile corectate (300 − 60)',
    dupaCorectii?.cheltuieli === 60 && dupaCorectii?.profit === 240, JSON.stringify(dupaCorectii))
  const urmaChirie = await cere('GET', `/jurnal?entitate=cheltuiala&entitate_id=${chirie.corp?.id}`, acces)
  verifica('ștergerea cheltuielii rămâne în jurnal, întreagă cu deblocarea',
    urmaChirie.corp?.randuri?.some((r: any) => r.actiune === 'stergere' && r.date_vechi?.suma === 120),
    JSON.stringify(urmaChirie.corp?.randuri?.map((r: any) => r.date_vechi)))
  const urmaAscunsa = await cere('GET', `/jurnal?entitate=cheltuiala&entitate_id=${chirie.corp?.id}`, { token: admin })
  verifica('fără deblocare, jurnalul arată cine și când, dar nu sumele cheltuielilor',
    urmaAscunsa.corp?.randuri?.length > 0
      && urmaAscunsa.corp.randuri.every((r: any) => r.date_vechi === null && r.date_noi === null),
    JSON.stringify(urmaAscunsa.corp?.randuri?.map((r: any) => [r.date_vechi, r.date_noi])))
  const urmaDeschideri = await cere('GET', '/jurnal?entitate=statistici', { token: admin })
  verifica('fiecare deschidere a statisticilor rămâne în jurnal',
    urmaDeschideri.corp?.randuri?.some((r: any) => r.actiune === 'autentificare'))

  const schimbata = await cere('PUT', '/statistici/parola', {
    token: admin, corp: { parola_curenta: PAROLA_STATISTICI, parola_noua: PAROLA_STATISTICI_NOUA },
  })
  verifica('parola se schimbă cu cea curentă -> 200 și deblocare nouă',
    schimbata.status === 200 && typeof schimbata.corp?.jeton === 'string', JSON.stringify(schimbata.corp))
  const vechea = await raportZi()
  verifica('schimbarea parolei încuie deblocările vechi -> 403',
    vechea.status === 403 && vechea.corp?.camp === 'acces_statistici', JSON.stringify(vechea.corp))
  const nouaMerge = await cere('GET', `/statistici?de_la=${ziua}&pana_la=${ziua}`, {
    token: admin, statistici: schimbata.corp?.jeton,
  })
  verifica('deblocarea nouă merge', nouaMerge.status === 200)
  const veche = await cere('POST', '/statistici/acces', { token: admin, corp: { parola: PAROLA_STATISTICI } })
  verifica('parola veche nu mai deschide', veche.status === 400 && veche.corp?.camp === 'parola')

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

ruleaza()
  .catch((e) => {
    console.error('\nTestul s-a oprit:', e)
    process.exitCode = 1
  })
  // Legătura directă cu baza, deschisă pentru parola statisticilor, ar ține
  // procesul în viață după ultima verificare.
  .finally(() => pool.end())
