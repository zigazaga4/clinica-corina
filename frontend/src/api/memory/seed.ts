/**
 * Datele demo.
 *
 * Scopul lor nu este să umple ecranul, ci să pună interfața în situațiile în
 * care chiar va ajunge: clienți arhivați, conturi dezactivate, programări
 * neprezentate, vânzări cu mai multe linii, un serviciu scos din nomenclator
 * dar prezent în vânzări vechi. O listă de „Client 1 … Client 60” ar arăta
 * bine și nu ar demonstra nimic.
 *
 * Totul este generat cu o sămânță fixă (vezi `generator`), deci de fiecare
 * dată identic.
 */

import type {
  Articol,
  Client,
  NotaClient,
  Notita,
  Programare,
  PunctLucru,
  StareProgramare,
  Tratament,
  Uuid,
  Vanzare,
  VanzareLinie,
} from '@/domain/types'
import { addDays, addMinutes, laTimestamptz, startOfDay } from '@/lib/dates'
import { uuid } from '@/lib/id'
import { totalLinie } from '@/lib/money'
import { alege, generator, goleste, intreg, magazin, sansa, type RandUtilizator } from './store'

/** Parola tuturor conturilor demo, afișată pe ecranul de autentificare. */
export const PAROLA_DEMO = 'parola123'

/** Sămânța fixă a datelor demo. */
const SAMANTA = 20260907

/**
 * Generatorul se REÎNCARCĂ la fiecare `populeaza()`, nu doar la primul import.
 *
 * Altfel a doua populare ar continua șirul din locul în care s-a oprit prima și
 * ar produce alte date — ceea ce ar face testele să depindă de câte ori s-a
 * repopulat magazinul înaintea lor, iar „resetează datele demo” din interfață
 * ar da de fiecare dată altă clinică.
 */
let rnd = generator(SAMANTA)

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Nomenclatoare
// ---------------------------------------------------------------------------

interface SabonServiciu {
  denumire: string
  durata: number
  /** La un serviciu în mai multe ședințe: prețul ÎNTREGULUI tratament. */
  pret: number
  /** În câte veniri se face; lipsă = una singură. */
  sedinte?: number
  activ?: boolean
}

const SERVICII: SabonServiciu[] = [
  { denumire: 'Curățare facială profundă', durata: 75, pret: 220 },
  { denumire: 'Tratament facial hidratant', durata: 60, pret: 180 },
  { denumire: 'Tratament anti-acnee', durata: 60, pret: 760, sedinte: 4 },
  { denumire: 'Microdermabraziune', durata: 45, pret: 250 },
  { denumire: 'Peeling chimic', durata: 40, pret: 300 },
  { denumire: 'Mezoterapie facială', durata: 50, pret: 450 },
  { denumire: 'Masaj facial anti-aging', durata: 40, pret: 160 },
  { denumire: 'Radiofrecvență facială', durata: 45, pret: 280 },
  { denumire: 'Epilare definitivă IPL — față', durata: 20, pret: 150 },
  { denumire: 'Epilare definitivă IPL — axile', durata: 25, pret: 900, sedinte: 6 },
  { denumire: 'Epilare definitivă IPL — picioare complet', durata: 60, pret: 2400, sedinte: 8 },
  { denumire: 'Epilare cu ceară — picioare', durata: 40, pret: 120 },
  { denumire: 'Manichiură clasică', durata: 45, pret: 80 },
  { denumire: 'Manichiură cu gel', durata: 75, pret: 140 },
  { denumire: 'Pedichiură clasică', durata: 60, pret: 110 },
  { denumire: 'Pedichiură cu gel', durata: 90, pret: 170 },
  { denumire: 'Extensii gene — volum rus', durata: 120, pret: 350 },
  { denumire: 'Extensii gene — întreținere', durata: 60, pret: 180 },
  { denumire: 'Laminare sprâncene', durata: 45, pret: 150 },
  { denumire: 'Masaj corporal relaxant', durata: 60, pret: 200 },
  { denumire: 'Masaj anticelulitic', durata: 50, pret: 220 },
  { denumire: 'Drenaj limfatic', durata: 60, pret: 240 },
  { denumire: 'Machiaj profesional', durata: 60, pret: 250 },
  // Scos din ofertă, dar rămâne în vânzările vechi — verifică afișarea
  // articolelor inactive în istoric.
  { denumire: 'Împachetare corporală cu alge', durata: 70, pret: 260, activ: false },
]

const PRODUSE: { denumire: string; pret: number; activ?: boolean }[] = [
  { denumire: 'Ser cu acid hialuronic 30 ml', pret: 200 },
  { denumire: 'Ser cu vitamina C 30 ml', pret: 180 },
  { denumire: 'Cremă hidratantă SPF 50', pret: 120 },
  { denumire: 'Cremă de noapte regeneratoare', pret: 160 },
  { denumire: 'Gel de curățare facială', pret: 95 },
  { denumire: 'Loțiune tonică', pret: 85 },
  { denumire: 'Mască facială cu argilă', pret: 75 },
  { denumire: 'Cremă anticelulitică', pret: 140 },
  { denumire: 'Ulei pentru masaj', pret: 70 },
  { denumire: 'Ulei pentru cuticule', pret: 45 },
  { denumire: 'Balsam pentru gene', pret: 90 },
  { denumire: 'Protecție solară corp SPF 30', pret: 110, activ: false },
]

/**
 * Un singur punct de lucru — clinica are o singură locație.
 *
 * Rândul există pentru că schema îl cere și pentru că `punct_lucru_id` este NOT
 * NULL pe programări și pe vânzări; interfața nu îl arată și nu îl cere
 * niciodată. Vezi comentariul de pe `PunctLucru` în @/domain/types.
 */
const PUNCTE: Omit<PunctLucru, 'id' | 'creat_la' | 'actualizat_la'>[] = [
  {
    denumire: 'Clinica Centru',
    adresa: 'Str. Ștefan cel Mare nr. 42, Constanța',
    telefon: '0241 610 220',
    activ: true,
  },
]

interface SablonUtilizator {
  nume: string
  email: string
  rol: 'administrator' | 'utilizator'
  activ?: boolean
}

const UTILIZATORI: SablonUtilizator[] = [
  { nume: 'Mitea Cătălina Irina', email: 'admin@clinica.ro', rol: 'administrator' },
  { nume: 'Andreea Popescu', email: 'andreea.popescu@clinica.ro', rol: 'utilizator' },
  { nume: 'Elena Dumitrescu', email: 'elena.dumitrescu@clinica.ro', rol: 'utilizator' },
  { nume: 'Raluca Ionescu', email: 'raluca.ionescu@clinica.ro', rol: 'utilizator' },
  { nume: 'Mihaela Stan', email: 'mihaela.stan@clinica.ro', rol: 'utilizator' },
  { nume: 'Cristina Marin', email: 'cristina.marin@clinica.ro', rol: 'utilizator' },
  // Cont dezactivat — nu se poate autentifica, dar apare în programări vechi.
  { nume: 'Diana Georgescu', email: 'diana.georgescu@clinica.ro', rol: 'utilizator', activ: false },
]

const PRENUME_F = [
  'Maria', 'Elena', 'Ioana', 'Andreea', 'Alexandra', 'Cristina', 'Gabriela', 'Mihaela',
  'Raluca', 'Simona', 'Daniela', 'Adriana', 'Roxana', 'Corina', 'Bianca', 'Larisa',
  'Georgiana', 'Anca', 'Diana', 'Carmen', 'Iulia', 'Monica', 'Oana', 'Ramona',
  'Teodora', 'Alina', 'Nicoleta', 'Loredana', 'Silvia', 'Camelia',
]

const PRENUME_M = [
  'Andrei', 'Mihai', 'Alexandru', 'Cristian', 'Bogdan', 'Radu', 'Vlad', 'Adrian',
  'Ionuț', 'Răzvan', 'Sorin', 'Marius', 'Gabriel', 'Daniel', 'Florin',
]

const NUME = [
  'Popescu', 'Ionescu', 'Popa', 'Radu', 'Dumitrescu', 'Stan', 'Stoica', 'Gheorghiu',
  'Constantin', 'Marin', 'Diaconu', 'Munteanu', 'Nistor', 'Ciobanu', 'Matei',
  'Vasilescu', 'Ene', 'Anghel', 'Georgescu', 'Barbu', 'Nedelcu', 'Toma', 'Sandu',
  'Petrescu', 'Iliescu', 'Grigore', 'Dobre', 'Voicu', 'Lungu', 'Cristea',
  'Șerban', 'Tudor', 'Manole', 'Neagu', 'Călin',
]

const NOTE_CLIENT = [
  'Preferă produse fără parfum. Piele sensibilă în zona obrajilor.',
  'Alergie declarată la nichel — a se evita instrumentarul metalic.',
  'Vine de obicei însoțită; preferă programările de dimineață.',
  'A cerut factură pe firmă. Datele sunt la recepție.',
  'Ține legătura pe WhatsApp, nu răspunde la apeluri în timpul programului.',
  'Nu tolerează bine peelingul; s-a trecut pe variantă enzimatică.',
  'Client fidel din 2023. Vine lunar la întreținere gene.',
  'A amânat de două ori consecutiv — se confirmă telefonic cu o zi înainte.',
  'Recomandată de doamna Ionescu. Prima ședință a fost în martie.',
  'Preferă să lucreze doar cu Andreea.',
  'Sensibilitate la lumina IPL — se începe cu intensitate redusă.',
  'A achiziționat pachet de 5 ședințe; au rămas 2.',
]

const NOTE_PROGRAMARE = [
  'Confirmată telefonic.',
  'A cerut să fie prima programare a zilei.',
  'Vine direct de la serviciu, posibilă întârziere de 10 minute.',
  'Ședința 3 din pachetul de 5.',
  'De verificat dacă mai are produsul de acasă.',
  null, null, null, null, null,
]

const NOTE_VANZARE = [
  'Plată numerar.',
  'Plată card.',
  'A folosit voucher cadou.',
  'Discount 10% — client fidel.',
  null, null, null, null,
]

// ---------------------------------------------------------------------------
// Construcția setului
// ---------------------------------------------------------------------------

/** Program de lucru al clinicii: 09:00–19:00. */
const ORA_DESCHIDERE = 9
const ORA_INCHIDERE = 19

/** Câte zile în urmă și în viitor se generează programări. */
const ZILE_TRECUT = 28
const ZILE_VIITOR = 21

export function populeaza(): void {
  goleste()
  rnd = generator(SAMANTA)

  const creat_la = nowIso()
  const azi = startOfDay(new Date())

  // --- utilizatori ---------------------------------------------------------
  const utilizatori: RandUtilizator[] = UTILIZATORI.map((s) => {
    const rand: RandUtilizator = {
      id: uuid(),
      nume: s.nume,
      email: s.email,
      parola_hash: PAROLA_DEMO,
      rol: s.rol,
      activ: s.activ ?? true,
      ultima_autentificare: s.activ === false ? null : laTimestamptz(addDays(azi, -intreg(rnd, 0, 6))),
      creat_la,
      actualizat_la: creat_la,
    }
    magazin.utilizator.set(rand.id, rand)
    return rand
  })

  /** Cine poate executa servicii: conturile active. */
  const executanti = utilizatori.filter((u) => u.activ)

  // --- puncte de lucru -----------------------------------------------------
  const puncte: PunctLucru[] = PUNCTE.map((p) => {
    const rand: PunctLucru = { id: uuid(), ...p, creat_la, actualizat_la: creat_la }
    magazin.punct_lucru.set(rand.id, rand)
    return rand
  })
  const puncteActive = puncte.filter((p) => p.activ)

  // --- articole ------------------------------------------------------------
  const servicii: Articol[] = SERVICII.map((s) => {
    const rand: Articol = {
      id: uuid(),
      tip: 'serviciu',
      denumire: s.denumire,
      durata_minute: s.durata,
      pret_lista: s.pret,
      activ: s.activ ?? true,
      creat_la,
      actualizat_la: creat_la,
      numar_sedinte: s.sedinte ?? 1,
    }
    magazin.articol.set(rand.id, rand)
    return rand
  })

  const produse: Articol[] = PRODUSE.map((p) => {
    const rand: Articol = {
      id: uuid(),
      tip: 'produs',
      denumire: p.denumire,
      durata_minute: null,
      pret_lista: p.pret,
      activ: p.activ ?? true,
      creat_la,
      actualizat_la: creat_la,
      numar_sedinte: 1,
    }
    magazin.articol.set(rand.id, rand)
    return rand
  })

  const serviciiActive = servicii.filter((s) => s.activ)

  // --- clienți -------------------------------------------------------------
  const clienti: Client[] = []
  const numeFolosite = new Set<string>()

  for (let i = 0; i < 64; i++) {
    // Clientela unei clinici de înfrumusețare este majoritar feminină; păstrăm
    // și bărbați, ca lista să nu ascundă cazul.
    const prenume = sansa(rnd, 0.85) ? alege(rnd, PRENUME_F) : alege(rnd, PRENUME_M)
    const numeFamilie = alege(rnd, NUME)
    let nume = `${numeFamilie} ${prenume}`
    if (numeFolosite.has(nume)) nume = `${numeFamilie} ${prenume} ${['A.', 'C.', 'M.', 'I.'][i % 4]}`
    numeFolosite.add(nume)

    const areEmail = sansa(rnd, 0.72)
    const slug = `${prenume}.${numeFamilie}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z.]/g, '')

    const rand: Client = {
      id: uuid(),
      nume,
      telefon: sansa(rnd, 0.94) ? telefonRo() : null,
      email: areEmail ? `${slug}${intreg(rnd, 1, 99)}@${alege(rnd, ['gmail.com', 'yahoo.com', 'outlook.com'])}` : null,
      adresa: sansa(rnd, 0.45) ? adresaRo() : null,
      data_nasterii: sansa(rnd, 0.6) ? dataNasterii() : null,
      // ~6% arhivați, ca lista implicită să chiar filtreze ceva.
      arhivat_la: sansa(rnd, 0.06) ? laTimestamptz(addDays(azi, -intreg(rnd, 10, 120))) : null,
      creat_de: alege(rnd, utilizatori).id,
      creat_la: laTimestamptz(addDays(azi, -intreg(rnd, 30, 700))),
      actualizat_la: creat_la,
    }
    magazin.client.set(rand.id, rand)
    clienti.push(rand)
  }

  const clientiActivi = clienti.filter((c) => c.arhivat_la === null)

  // --- note pe fișe --------------------------------------------------------
  for (const client of clienti) {
    if (!sansa(rnd, 0.42)) continue
    const cate = intreg(rnd, 1, 3)
    for (let i = 0; i < cate; i++) {
      const nota: NotaClient = {
        id: uuid(),
        client_id: client.id,
        autor_id: alege(rnd, utilizatori).id,
        text: alege(rnd, NOTE_CLIENT),
        creat_la: laTimestamptz(addDays(azi, -intreg(rnd, 1, 300))),
      }
      magazin.nota_client.set(nota.id, nota)
    }
  }

  // --- programări ----------------------------------------------------------
  //
  // Generate PE EXECUTANT ȘI PE ZI, avansând cronologic prin program. Este
  // singurul mod de a respecta `programare_fara_suprapunere` fără să încerci
  // și să reîncerci intervale la întâmplare.
  const programari: Programare[] = []

  /*
    Prețurile negociate, ținute minte pe (client, serviciu).

    O parte dintre cliente au un preț al lor la un serviciu anume — fidelitate,
    abonament, o reducere dată cândva la recepție. Odată stabilit, se aplică la
    fiecare ședință următoare a aceleiași perechi, exact cum face `pretPentru`
    în implementarea API: prețul se citește din ultima ședință, nu dintr-o
    tabelă separată. Fără rândurile acestea în datele demo, funcția ar exista
    fără să se vadă vreodată.
  */
  const preturiNegociate = new Map<string, number>()
  const pretPentruSedinta = (client_id: Uuid, serviciu: Articol): number => {
    const cheie = `${client_id}:${serviciu.id}`
    const retinut = preturiNegociate.get(cheie)
    if (retinut !== undefined) return retinut

    // O pereche din șase are preț propriu: 10% sau 15% sub listă, rotunjit la leu.
    const pret = sansa(rnd, 1 / 6)
      ? Math.round(serviciu.pret_lista * alege(rnd, [0.85, 0.9]))
      : serviciu.pret_lista
    preturiNegociate.set(cheie, pret)
    return pret
  }

  /*
    Tratamentele se deschid pe măsură ce apar ședințele lor, exact cum face
    API-ul: prima ședință a unui serviciu în mai multe veniri deschide
    tratamentul, următoarele intră în el, iar una peste numărul convenit nu
    se face. Ședințele care contează (programate, onorate) primesc partea lor
    din preț; cele anulate sau neprezentate nu ocupă loc — ca în vedere.
  */
  const tratamente = new Map<string, { rand: Tratament; contate: number }>()
  const tratamentPentru = (client_id: Uuid, serviciu: Articol) => {
    const cheie = `${client_id}:${serviciu.id}`
    let intrare = tratamente.get(cheie)
    if (!intrare) {
      const rand: Tratament = {
        id: uuid(),
        client_id,
        articol_id: serviciu.id,
        articol_tip: 'serviciu',
        numar_sedinte: serviciu.numar_sedinte,
        // O parte din cliente au un preț convenit sub listă, ca la ședințe.
        pret_total: sansa(rnd, 1 / 5) ? Math.round(serviciu.pret_lista * 0.9) : serviciu.pret_lista,
        nota: null,
        incheiat_la: null,
        creat_de: alege(rnd, utilizatori).id,
        creat_la,
        actualizat_la: creat_la,
      }
      intrare = { rand, contate: 0 }
      tratamente.set(cheie, intrare)
    }
    return intrare
  }

  for (let deplasare = -ZILE_TRECUT; deplasare <= ZILE_VIITOR; deplasare++) {
    const zi = addDays(azi, deplasare)
    // Duminica este închis.
    if (zi.getDay() === 0) continue
    const esteSambata = zi.getDay() === 6

    for (const executant of executanti) {
      // Administratorul operează mai mult decât execută.
      if (executant.rol === 'administrator' && !sansa(rnd, 0.25)) continue
      if (esteSambata && !sansa(rnd, 0.5)) continue

      let cursor = new Date(zi)
      cursor.setHours(ORA_DESCHIDERE, 0, 0, 0)
      // Pornire decalată, ca agenda să nu arate ca un grafic generat.
      cursor = addMinutes(cursor, intreg(rnd, 0, 3) * 30)

      const limita = new Date(zi)
      limita.setHours(esteSambata ? 15 : ORA_INCHIDERE, 0, 0, 0)

      while (cursor < limita) {
        if (sansa(rnd, 0.22)) {
          // Pauză în agendă.
          cursor = addMinutes(cursor, 30)
          continue
        }

        const serviciu = alege(rnd, serviciiActive)
        const durata = serviciu.durata_minute ?? 60
        const sfarsit = addMinutes(cursor, durata)
        if (sfarsit > limita) break

        const client_id = alege(rnd, clientiActivi).id
        const stare = stareInFunctieDeMoment(deplasare)

        let tratament: { rand: Tratament; contate: number } | null = null
        let pret: number
        if (serviciu.numar_sedinte > 1) {
          tratament = tratamentPentru(client_id, serviciu)
          // Tratamentul e plin: clienta nu mai vine la el, locul rămâne liber.
          if (tratament.contate >= tratament.rand.numar_sedinte) {
            cursor = addMinutes(cursor, 30)
            continue
          }
          pret = Math.round((tratament.rand.pret_total / tratament.rand.numar_sedinte) * 100) / 100
          if (stare === 'programat' || stare === 'onorat') tratament.contate++
        } else {
          pret = pretPentruSedinta(client_id, serviciu)
        }

        const rand: Programare = {
          id: uuid(),
          client_id,
          articol_id: serviciu.id,
          articol_tip: 'serviciu',
          executant_id: executant.id,
          punct_lucru_id: alege(rnd, puncteActive).id,
          incepe_la: laTimestamptz(cursor),
          se_termina_la: laTimestamptz(sfarsit),
          stare,
          pret,
          nota: alege(rnd, NOTE_PROGRAMARE),
          creat_de: alege(rnd, utilizatori).id,
          creat_la: laTimestamptz(addDays(cursor, -intreg(rnd, 1, 14))),
          actualizat_la: creat_la,
          tratament_id: tratament?.rand.id ?? null,
        }
        magazin.programare.set(rand.id, rand)
        programari.push(rand)

        // Interval tampon între programări.
        cursor = addMinutes(sfarsit, alege(rnd, [0, 15, 15, 30]))
      }
    }
  }

  // Tratamentele cu toate ședințele onorate s-au încheiat de la sine, la
  // sfârșitul ultimei — exact ce face API-ul la marcarea ei.
  for (const { rand } of tratamente.values()) {
    const onorate = programari.filter((p) => p.tratament_id === rand.id && p.stare === 'onorat')
    if (onorate.length >= rand.numar_sedinte) {
      rand.incheiat_la = onorate.reduce((max, p) => (p.se_termina_la > max ? p.se_termina_la : max), '')
    }
    magazin.tratament.set(rand.id, rand)
  }

  // --- notițe în calendar --------------------------------------------------
  //
  // Câteva însemnări care nu sunt programări: una pentru toată clinica, una a
  // unei persoane, una care se întinde pe o zi întreagă. Fără ele, calendarul
  // demo nu ar arăta niciodată cum se deosebește o notiță de o ședință.
  const laOra = (zi: Date, ora: number, minute = 0) => {
    const d = new Date(zi)
    d.setHours(ora, minute, 0, 0)
    return d
  }
  const notite: Array<Omit<Notita, 'id' | 'creat_de' | 'creat_la' | 'actualizat_la'>> = [
    {
      titlu: 'Vine furnizorul de creme',
      detalii: 'Comanda lunară — de verificat lotul înainte de semnare.',
      executant_id: null,
      incepe_la: laTimestamptz(laOra(addDays(azi, 1), 15)),
      se_termina_la: laTimestamptz(laOra(addDays(azi, 1), 15, 30)),
    },
    {
      titlu: 'Concediu',
      detalii: null,
      executant_id: executanti[1]?.id ?? null,
      incepe_la: laTimestamptz(laOra(addDays(azi, 3), ORA_DESCHIDERE)),
      se_termina_la: laTimestamptz(laOra(addDays(azi, 3), ORA_INCHIDERE)),
    },
    {
      titlu: 'Curățenie generală',
      detalii: 'Sala 2 este indisponibilă până la 10:00.',
      executant_id: null,
      incepe_la: laTimestamptz(laOra(azi, 8)),
      se_termina_la: laTimestamptz(laOra(azi, 10)),
    },
    {
      titlu: 'Curs de perfecționare',
      detalii: 'Revine după-amiază.',
      executant_id: executanti[0]?.id ?? null,
      incepe_la: laTimestamptz(laOra(addDays(azi, -2), ORA_DESCHIDERE)),
      se_termina_la: laTimestamptz(laOra(addDays(azi, -2), 13)),
    },
  ]
  for (const n of notite) {
    const rand: Notita = {
      id: uuid(),
      ...n,
      creat_de: alege(rnd, utilizatori).id,
      creat_la,
      actualizat_la: creat_la,
    }
    magazin.notita.set(rand.id, rand)
  }

  // --- încasări ------------------------------------------------------------
  //
  // Majoritatea ședințelor onorate se încasează pe loc: o vânzare cu o linie
  // care indică programarea. Restul rămân „de plată” — cazul clientei care mai
  // vine o dată săptămâna viitoare și achită atunci tot.
  //
  // Ele nu sunt un artificiu de demonstrație: `de_incasat` de pe fișă și de pe
  // lista de clienți se calculează exact din ele, iar fără câteva neîncasate
  // fiecare fișă ar arăta zero și butonul de încasare nu s-ar vedea niciodată.
  const onorate = programari.filter((p) => p.stare === 'onorat')

  for (const programare of onorate) {
    if (!sansa(rnd, 0.82)) continue

    const vanzare: Vanzare = {
      id: uuid(),
      client_id: programare.client_id,
      punct_lucru_id: programare.punct_lucru_id,
      operator_id: alege(rnd, executanti).id,
      programare_id: programare.id,
      efectuat_la: programare.se_termina_la,
      nota: alege(rnd, NOTE_VANZARE),
      creat_la: programare.se_termina_la,
      actualizat_la: programare.se_termina_la,
      achitat_la: programare.se_termina_la,
    }
    magazin.vanzare.set(vanzare.id, vanzare)

    // Prețul convenit la programare, NU cel din nomenclator: pe asta se
    // sprijină prețurile negociate de mai sus.
    adaugaLinie(vanzare.id, programare.articol_id, 1, programare.pret, programare.id)

    // Uneori clientul pleacă și cu un produs.
    if (sansa(rnd, 0.3)) {
      const produs = alege(rnd, produse.filter((p) => p.activ))
      adaugaLinie(vanzare.id, produs.id, intreg(rnd, 1, 2), produs.pret_lista)
    }
  }

  // Vânzări de produse la recepție, fără programare.
  //
  // Câteva rămân NEACHITATE — cremele au plecat, banii vin data viitoare — ca
  // banda „De plată” și bifa „Achitat” să aibă pe ce să se vadă. Alese după
  // poziție, nu cu `rnd`: o tragere în plus ar muta tot restul datelor demo.
  for (let i = 0; i < 45; i++) {
    const neachitata = i % 9 === 4
    const cand = addMinutes(
      addDays(azi, -intreg(rnd, 0, ZILE_TRECUT)),
      intreg(rnd, ORA_DESCHIDERE * 60, ORA_INCHIDERE * 60),
    )
    const vanzare: Vanzare = {
      id: uuid(),
      client_id: alege(rnd, clientiActivi).id,
      punct_lucru_id: alege(rnd, puncteActive).id,
      operator_id: alege(rnd, executanti).id,
      programare_id: null,
      efectuat_la: laTimestamptz(cand),
      nota: alege(rnd, NOTE_VANZARE),
      creat_la: laTimestamptz(cand),
      actualizat_la: laTimestamptz(cand),
      achitat_la: neachitata ? null : laTimestamptz(cand),
    }
    magazin.vanzare.set(vanzare.id, vanzare)

    const cateLinii = intreg(rnd, 1, 3)
    const alese = new Set<Uuid>()
    for (let l = 0; l < cateLinii; l++) {
      const produs = alege(rnd, produse)
      if (alese.has(produs.id)) continue
      alese.add(produs.id)
      // Prețul practicat poate diferi de cel de listă — de aceea se copiază.
      const pret = sansa(rnd, 0.15) ? produs.pret_lista * 0.9 : produs.pret_lista
      adaugaLinie(vanzare.id, produs.id, intreg(rnd, 1, 3), pret)
    }
  }

  // --- jurnal --------------------------------------------------------------
  // Câteva autentificări recente, ca ecranul de jurnal să nu fie gol înainte
  // ca cineva să facă vreo operațiune. Restul se scrie natural, la fiecare
  // mutație prin API.
  for (let i = 0; i < 30; i++) {
    const utilizator = alege(rnd, executanti)
    magazin.jurnal_operatiuni.push({
      id: magazin.urmatorId_jurnal++,
      utilizator_id: utilizator.id,
      actiune: 'autentificare',
      entitate: 'sesiune',
      entitate_id: null,
      date_vechi: null,
      date_noi: { email: utilizator.email },
      adresa_ip: null,
      creat_la: laTimestamptz(
        addMinutes(addDays(azi, -intreg(rnd, 0, 14)), intreg(rnd, 8 * 60, 10 * 60)),
      ),
    })
  }
  magazin.jurnal_operatiuni.sort((a, b) => a.creat_la.localeCompare(b.creat_la))

  // Renumerotare, ca `id`-urile să crească odată cu timpul, la fel ca bigserial.
  magazin.jurnal_operatiuni.forEach((j, i) => {
    j.id = i + 1
  })
  magazin.urmatorId_jurnal = magazin.jurnal_operatiuni.length + 1
}

// ---------------------------------------------------------------------------
// Ajutătoare
// ---------------------------------------------------------------------------

function adaugaLinie(
  vanzare_id: Uuid,
  articol_id: Uuid,
  cantitate: number,
  pret_unitar: number,
  /** Ședința stinsă de linie; lipsă la produse. */
  programare_id: Uuid | null = null,
): void {
  const linie: VanzareLinie = {
    id: uuid(),
    vanzare_id,
    articol_id,
    cantitate,
    pret_unitar,
    total_linie: totalLinie(cantitate, pret_unitar),
    programare_id,
  }
  magazin.vanzare_linie.set(linie.id, linie)
}

/**
 * Starea unei programări, potrivit poziției ei față de azi.
 * Trecutul este în majoritate onorat, cu procentele obișnuite de anulări și
 * neprezentări; viitorul este programat, cu câteva anulări deja anunțate.
 */
function stareInFunctieDeMoment(deplasareZile: number): StareProgramare {
  if (deplasareZile < 0) {
    const p = rnd()
    if (p < 0.82) return 'onorat'
    if (p < 0.92) return 'anulat'
    return 'neprezentat'
  }
  if (deplasareZile === 0) {
    const p = rnd()
    if (p < 0.35) return 'onorat'
    if (p < 0.92) return 'programat'
    return 'anulat'
  }
  return sansa(rnd, 0.06) ? 'anulat' : 'programat'
}

function telefonRo(): string {
  const prefixe = ['072', '073', '074', '075', '076', '077', '078']
  const rest = String(intreg(rnd, 1000000, 9999999))
  return `${alege(rnd, prefixe)}${rest.slice(0, 1)} ${rest.slice(1, 4)} ${rest.slice(4)}`
}

function adresaRo(): string {
  const strazi = [
    'Str. Ștefan cel Mare', 'Bd. Tomis', 'Str. Mircea cel Bătrân', 'Bd. Ferdinand',
    'Str. Traian', 'Bd. Mamaia', 'Str. Decebal', 'Aleea Zmeurei', 'Str. Unirii',
    'Bd. Alexandru Lăpușneanu', 'Str. Soveja', 'Str. Cuza Vodă',
  ]
  const orase = ['Constanța', 'Constanța', 'Constanța', 'Năvodari', 'Mamaia', 'Ovidiu']
  return `${alege(rnd, strazi)} nr. ${intreg(rnd, 1, 180)}, ${alege(rnd, orase)}`
}

function dataNasterii(): string {
  const an = intreg(rnd, 1962, 2006)
  const luna = String(intreg(rnd, 1, 12)).padStart(2, '0')
  const zi = String(intreg(rnd, 1, 28)).padStart(2, '0')
  return `${an}-${luna}-${zi}`
}
