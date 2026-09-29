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
  // Un serviciu dintr-o singură venire: cele în mai multe ședințe au prețul
  // împărțit pe tratament și se verifică separat, mai jos.
  const serviciu = articole.corp.find((a: any) => a.numar_sedinte === 1) ?? articole.corp[0]
  verifica('articolul are toate coloanele',
    ['id', 'tip', 'denumire', 'durata_minute', 'pret_lista', 'activ', 'creat_la', 'actualizat_la', 'numar_sedinte']
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

  const doarDatorii = await cere('GET', `/vanzari?client_id=${client_id}&achitat=false`, { token: admin })
  verifica('GET /vanzari?achitat=false aduce doar datoriile',
    doarDatorii.corp?.total === 1 && doarDatorii.corp?.randuri?.[0]?.id === datorie_id,
    JSON.stringify(doarDatorii.corp?.randuri?.map((v: any) => v.id)))
  const doarAchitate = await cere('GET', `/vanzari?client_id=${client_id}&achitat=true`, { token: admin })
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
