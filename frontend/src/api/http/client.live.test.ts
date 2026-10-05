/**
 * Contractul, verificat împotriva serverului real.
 *
 * Restul testelor rulează pe implementarea din memorie, care este o reproducere
 * a serverului — bună, dar scrisă de aceeași mână care a scris ecranele. Testul
 * acesta ia clientul HTTP pe care îl folosește chiar aplicația și îl pune să
 * vorbească cu backend-ul: dacă serverul schimbă un nume de câmp sau forma unei
 * anvelope, aici se vede, nu la prima instalare în clinică.
 *
 * Se sare când nu există server. Rulare:
 *
 *     API_LIVE=http://localhost:3001 npx vitest run src/api/http
 *
 * Scrie date reale în baza spre care arată `API_LIVE`. Se folosește pe baza de
 * dezvoltare, niciodată pe cea a clinicii.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { creeazaApiHttp } from './client'
import { esteEroareApi, esteStatisticiIncuiate } from '@/api/errors'
import { scrieTokenuri, stergeTokenuri, type TokenuriSesiune } from '@/api/session'
import type { ApiClient } from '@/api/contract'
import { aceeasiCategorie, CATEGORIE_CLIENTI } from '@/domain/categorii'
import type { Articol, Uuid } from '@/domain/types'

/*
  `process` există în Node, unde rulează vitest, dar proiectul nu are (și nu are
  nevoie de) `@types/node`: restul codului se compilează pentru browser.
  Declarația îl face vizibil doar în acest fișier, cu exact partea folosită.

  Adresa NU se citește din `import.meta.env`: acolo ajunge `VITE_API_URL`, pe
  care configurația de teste îl golește tocmai ca restul suitei să rămână pe
  datele din memorie.
*/
declare const process: { env: Record<string, string | undefined> }

const ADRESA = process.env['API_LIVE']
const EMAIL = process.env['API_LIVE_EMAIL'] ?? 'admin@clinica.ro'
const PAROLA = process.env['API_LIVE_PAROLA'] ?? 'parola123'

/** Un nume distinct la fiecare rulare, ca datele lăsate în urmă să se recunoască. */
const eticheta = `Test live ${new Date().toISOString().slice(0, 19)}`

/*
  Fiecare rulare își ia propria fereastră din agendă.

  Testul scrie programări adevărate, iar `programare_fara_suprapunere` nu face
  deosebire între o ciocnire reală și una cu propriul rulaj de acum două minute.
  Fixe, orele ar fi mers o singură dată; apoi fiecare rulare ar fi picat cu 409,
  și cine o vede prima ar crede că serverul s-a stricat.

  Fereastra este la un an în viitor, deplasată aleatoriu cu până la aproape un
  an. La ședințe de 45 de minute, două rulaje se pot suprapune cu o șansă sub o
  sutime de procent — iar dacă se întâmplă, o a doua rulare trece.
*/
const DEPLASARE_MINUTE = Math.floor(Math.random() * 500_000)

function slot(indice: number, durataMinute = 45) {
  const incepe = new Date()
  incepe.setFullYear(incepe.getFullYear() + 1)
  incepe.setHours(8, 0, 0, 0)
  incepe.setMinutes(incepe.getMinutes() + DEPLASARE_MINUTE + indice * 120)
  const seTermina = new Date(incepe.getTime() + durataMinute * 60_000)
  return { incepe_la: incepe.toISOString(), se_termina_la: seTermina.toISOString() }
}

describe.skipIf(!ADRESA)('clientul HTTP împotriva serverului real', () => {
  let api: ApiClient
  let serviciu: Articol
  let produs: Articol
  let executant_id: Uuid
  let client_id: Uuid
  let tokenuri: TokenuriSesiune

  beforeAll(async () => {
    stergeTokenuri()
    api = creeazaApiHttp(ADRESA!)

    const intrare = await api.auth.login({ email: EMAIL, parola: PAROLA, dispozitiv: 'vitest' })
    // Exact ce face ecranul de autentificare după un login reușit.
    tokenuri = {
      access_token: intrare.access_token,
      refresh_token: intrare.refresh_token,
      expira_la: intrare.expira_la,
    }
    scrieTokenuri(tokenuri)

    const servicii = await api.articole.list({ tip: 'serviciu', activ: true })
    const produse = await api.articole.list({ tip: 'produs', activ: true })
    const utilizatori = await api.utilizatori.list({ activ: true })

    /*
      Serviciul se alege dintr-o singură ședință, nu primul din listă.

      Testele de mai jos verifică „prețul reținut”: ultima ședință a clientului
      dictează. La un serviciu în mai multe ședințe regula este alta — prețul
      este partea ședinței din tratament, deci ce a rămas din `pret_total`
      împărțit la ședințele rămase. Amândouă sunt corecte; se exclud reciproc.

      Luat cu `servicii[0]`, testul depindea de ce se află în bază: era de ajuns
      o cură rămasă de la un rulaj al suitei de API ca primul serviciu să aibă
      trei ședințe, iar „preț din nomenclator” să pice cu a treia parte din el.
    */
    const serviciuSimplu = servicii.find((s) => s.numar_sedinte === 1)
    // De pe lista clienților, ca vânzarea de pe fișa clientei.
    const produsClienti = produse.find((p) => aceeasiCategorie(p.categorie, CATEGORIE_CLIENTI))
    if (!serviciuSimplu || !produsClienti || !utilizatori[0]) {
      throw new Error('Baza nu are date de pornire. Rulează `npm run seed` în backend.')
    }
    serviciu = serviciuSimplu
    produs = produsClienti
    executant_id = utilizatori[0].id

    client_id = (await api.clienti.create({ nume: eticheta, telefon: '0700111222' })).id
  })

  /*
    Sesiunea se rescrie înaintea fiecărui test.

    `src/test/setup.ts` șterge token-urile în `beforeEach` — corect pentru
    testele care rulează pe implementarea din memorie, unde fiecare test
    pornește de la zero. Hook-ul din fișierul de setup se înregistrează primul,
    deci rulează primul; acesta îl urmează și pune sesiunea la loc, fără o nouă
    autentificare la fiecare test.
  */
  beforeEach(() => {
    scrieTokenuri(tokenuri)
  })

  it('autentificarea întoarce un utilizator fără parolă', async () => {
    const eu = await api.auth.utilizatorCurent()
    expect(eu?.email).toBe(EMAIL)
    expect(eu).not.toHaveProperty('parola_hash')
  })

  it('lista de clienți vine paginată, cu restanța calculată', async () => {
    const pagina = await api.clienti.list({ q: eticheta })
    expect(pagina.pagina).toBe(1)
    expect(typeof pagina.total).toBe('number')

    const gasit = pagina.randuri.find((c) => c.id === client_id)
    expect(gasit).toBeDefined()
    // Sumele trebuie să sosească drept numere: `numeric` ajunge text dacă
    // driverul nu este configurat, iar totalurile din interfață devin
    // concatenări de șiruri în loc de adunări.
    expect(typeof gasit?.de_incasat).toBe('number')
    expect(gasit?.de_incasat).toBe(0)
  })

  it('prețul unei ședințe noi vine din nomenclator', async () => {
    const sugerat = await api.programari.pretSugerat(client_id, serviciu.id)
    expect(sugerat.pret).toBe(serviciu.pret_lista)
    expect(sugerat.din_istoric).toBe(false)
  })

  it('parcurge drumul întreg: programare -> onorat -> încasare', async () => {
    const programare = await api.programari.create({
      client_id,
      articol_id: serviciu.id,
      executant_id,
      ...slot(0),
      pret: 175,
    })

    expect(programare.stare).toBe('programat')
    expect(programare.pret).toBe(175)
    expect(programare.achitat).toBe(false)
    expect(programare.achitat_la).toBeNull()
    // Punctul de lucru nu se mai cere nicăieri în interfață; serverul îl pune.
    expect(programare.punct_lucru_denumire).toBeTruthy()

    const onorata = await api.programari.schimbaStarea(programare.id, 'onorat')
    expect(onorata.stare).toBe('onorat')
    expect(onorata.achitat).toBe(false)

    const fisa = await api.clienti.list({ q: eticheta })
    expect(fisa.randuri.find((c) => c.id === client_id)?.de_incasat).toBe(175)

    const incasare = await api.vanzari.incaseaza({
      client_id,
      programare_ids: [programare.id],
      linii: [{ articol_id: produs.id, cantitate: 2 }],
    })

    expect(incasare.linii).toHaveLength(2)
    expect(incasare.total).toBe(175 + 2 * produs.pret_lista)
    // Linia ședinței poartă prețul convenit, nu cel din nomenclatorul de azi.
    const linieSedinta = incasare.linii.find((l) => l.programare_id === programare.id)
    expect(linieSedinta?.pret_unitar).toBe(175)

    const dupa = await api.programari.get(programare.id)
    expect(dupa.achitat).toBe(true)
    expect(dupa.vanzare_id).toBe(incasare.id)
    expect(typeof dupa.achitat_la).toBe('string')

    // Prețul reținut: data viitoare formularul se deschide pe 175, nu pe listă.
    const reamintit = await api.programari.pretSugerat(client_id, serviciu.id)
    expect(reamintit.pret).toBe(175)
    expect(reamintit.din_istoric).toBe(true)
    expect(reamintit.pret_lista).toBe(serviciu.pret_lista)
  })

  it('istoricul întoarce ședințele și încasările într-un singur flux', async () => {
    const istoric = await api.clienti.istoric(client_id)
    expect(istoric.length).toBeGreaterThanOrEqual(2)
    expect(istoric.some((i) => i.fel === 'programare')).toBe(true)
    expect(istoric.some((i) => i.fel === 'vanzare')).toBe(true)

    // Cel mai recent întâi — pe asta se sprijină cronologia fișei.
    const momente = istoric.map((i) => new Date(i.la).getTime())
    expect([...momente].sort((a, b) => b - a)).toEqual(momente)
  })

  it('erorile serverului ajung ca EroareApi, cu mesaj și câmp', async () => {
    // Fără traducerea corectă a corpului, formularul ar afișa „Cererea a eșuat
    // (400)” și nu ar ști ce căsuță să înroșească.
    const gresita = await api.clienti.create({ nume: '   ' }).catch((e: unknown) => e)

    expect(esteEroareApi(gresita)).toBe(true)
    if (!esteEroareApi(gresita)) return
    expect(gresita.cod).toBe('validare')
    expect(gresita.camp).toBe('nume')
    expect(gresita.message).not.toMatch(/Cererea a eșuat/)
  })

  it('aceeași persoană poate avea două programări suprapuse', async () => {
    const date = {
      client_id,
      articol_id: serviciu.id,
      executant_id,
      ...slot(1, 60),
    }

    await api.programari.create(date)
    await expect(api.programari.create(date)).resolves.toBeTruthy()
  })

  /*
    Statisticile, prin antetul lor. Parola de pe baza de dezvoltare poate fi
    deja aleasă — de rularea trecută sau de `npm run test:api`, care o lasă pe
    a lui. Se încearcă cele cunoscute; altfel testul spune ce parolă îi lipsește.
  */
  it('statisticile se deschid cu parola lor și trimit singure deblocarea', async () => {
    api.statistici.blocheaza()
    const incuiata = await api.vanzari.list({ pe_pagina: 1 }).catch((e: unknown) => e)
    expect(esteStatisticiIncuiate(incuiata)).toBe(true)

    const cunoscute = [process.env['API_LIVE_PAROLA_STATISTICI'], 'statistici-test-2', 'statistici-live-1']
    if (!(await api.statistici.stare()).parola_setata) {
      await api.statistici.seteazaParola({ parola_noua: 'statistici-live-1' })
    } else {
      let deschisa = false
      for (const parola of cunoscute) {
        if (!parola) continue
        deschisa = await api.statistici.deblocheaza(parola).then(() => true, () => false)
        if (deschisa) break
      }
      if (!deschisa) {
        throw new Error('Parola statisticilor nu e una cunoscută testului: dă-o în API_LIVE_PAROLA_STATISTICI.')
      }
    }

    const lista = await api.vanzari.list({ pe_pagina: 1 })
    expect(typeof lista.total).toBe('number')

    const azi = new Date().toISOString().slice(0, 10)
    const cheltuiala = await api.cheltuieli.create({ data: azi, categorie: eticheta, suma: 12.5 })
    expect(cheltuiala.suma).toBe(12.5)
    const raport = await api.statistici.raport({ de_la: azi, pana_la: azi, pas: 'zi' })
    expect(raport.cheltuieli.find((c) => c.categorie === eticheta)?.suma).toBe(12.5)
    expect(raport.perioade).toHaveLength(1)
    await api.cheltuieli.remove(cheltuiala.id)

    // Încuiată la loc: nici măcar nu mai pleacă spre server.
    api.statistici.blocheaza()
    expect(esteStatisticiIncuiate(await api.cheltuieli.list().catch((e: unknown) => e))).toBe(true)
  })
})
