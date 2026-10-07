/**
 * CONTRACTUL API — singura graniță dintre această interfață și server.
 *
 * Fiecare metodă de mai jos corespunde EXACT unui endpoint din §7 al
 * specificației tehnice (CTR-2026-011). Ruta HTTP și rolul necesar sunt notate
 * în comentariul fiecărei metode.
 *
 * Interfața nu cunoaște decât acest fișier. Există două implementări:
 *
 *   @/api/memory  — date în memorie, cu aceleași constrângeri ca baza de date
 *                   (folosită acum, cât timp backend-ul este în lucru)
 *   @/api/http    — apeluri fetch reale către server
 *
 * Trecerea de la una la alta se face dintr-o variabilă de mediu, fără nicio
 * modificare în module. Vezi @/api/index.ts.
 */

import type {
  Articol,
  CheltuialaDetaliu,
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  DateOnly,
  DateSemnatar,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  MetodaPlata,
  NotaClientDetaliu,
  NotitaDetaliu,
  PasStatistici,
  ProgramLucru,
  ProgramareDetaliu,
  PunctLucru,
  RaportStatistici,
  RolUtilizator,
  StareProgramare,
  Timestamptz,
  TipArticol,
  TratamentDetaliu,
  Utilizator,
  Uuid,
  VanzareDetaliu,
  ZileLucru,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Anvelope comune
// ---------------------------------------------------------------------------

/** Răspuns paginat. `total` este numărul de rânduri înainte de paginare. */
export interface Paginat<T> {
  randuri: T[]
  total: number
  pagina: number
  pe_pagina: number
}

export interface ParametriPaginare {
  pagina?: number
  pe_pagina?: number
}

/** Interval de timp închis la ambele capete, folosit de toate filtrele. */
export interface IntervalTimp {
  de_la?: Timestamptz
  pana_la?: Timestamptz
}

// ---------------------------------------------------------------------------
// Autentificare
// ---------------------------------------------------------------------------

export interface CredentialeLogin {
  email: string
  parola: string
  /** Platformă + versiune aplicație, memorat în `sesiune.dispozitiv`. */
  dispozitiv?: string
}

export interface RaspunsLogin {
  access_token: string
  refresh_token: string
  /** Momentul expirării access token-ului. */
  expira_la: Timestamptz
  utilizator: Utilizator
}

export interface ApiAuth {
  /** POST /auth/login — public. Întoarce access + refresh token. */
  login(credentiale: CredentialeLogin): Promise<RaspunsLogin>
  /** POST /auth/refresh — public. Reînnoiește access token-ul. */
  refresh(refresh_token: string): Promise<RaspunsLogin>
  /** POST /auth/logout — orice rol. Revocă sesiunea curentă. */
  logout(refresh_token: string): Promise<void>
  /** Utilizatorul din spatele access token-ului curent. */
  utilizatorCurent(): Promise<Utilizator | null>
}

// ---------------------------------------------------------------------------
// Clienți
// ---------------------------------------------------------------------------

export interface FiltruClienti extends ParametriPaginare {
  /** Căutare parțială pe nume (trigram) sau telefon. */
  q?: string
  /** Implicit false — lista întoarce doar clienții nearhivați. */
  include_arhivati?: boolean
  /** Ordonare; implicit după nume, crescător. */
  sortare?: 'nume' | 'creat_la' | 'ultima_vizita'
  directie?: 'asc' | 'desc'
}

export interface DateClientNou {
  nume: string
  telefon?: string | null
  email?: string | null
  adresa?: string | null
  data_nasterii?: DateOnly | null
}

export type DateClientModificat = Partial<DateClientNou>

export interface ApiClienti {
  /** GET /clienti — orice rol. Listă paginată, cu căutare și filtre. */
  list(filtru?: FiltruClienti): Promise<Paginat<ClientListItem>>
  /** GET /clienti/:id — orice rol. Fișa completă. */
  get(id: Uuid): Promise<Client>
  /** POST /clienti — orice rol. */
  create(date: DateClientNou): Promise<Client>
  /** PATCH /clienti/:id — orice rol. */
  update(id: Uuid, date: DateClientModificat): Promise<Client>
  /** POST /clienti/:id/arhivare — orice rol. Ștergere logică. */
  arhiveaza(id: Uuid): Promise<Client>
  /** Operațiunea inversă arhivării — readuce fișa între cele active. */
  dezarhiveaza(id: Uuid): Promise<Client>
  /**
   * DELETE /clienti/:id — doar administrator.
   * Refuzată (409) dacă există programări sau vânzări (ON DELETE RESTRICT).
   */
  remove(id: Uuid): Promise<void>
  /** GET /clienti/:id/istoric — orice rol. Cronologic, cel mai recent întâi. */
  istoric(id: Uuid): Promise<IstoricIntrare[]>
  /** GET /clienti/:id/note — orice rol. Cele mai noi întâi. */
  note(id: Uuid): Promise<NotaClientDetaliu[]>
  /** POST /clienti/:id/note — orice rol. Autorul = utilizatorul autentificat. */
  adaugaNota(id: Uuid, text: string): Promise<NotaClientDetaliu>
  /** PATCH /clienti/:id/note/:notaId — orice rol. Textul vechi rămâne în jurnal. */
  modificaNota(id: Uuid, notaId: Uuid, text: string): Promise<NotaClientDetaliu>
}

// ---------------------------------------------------------------------------
// Consimțăminte (acordurile GDPR semnate pe tabletă)
// ---------------------------------------------------------------------------

export interface FiltruConsimtaminte extends ParametriPaginare {
  client_id?: Uuid
  programare_id?: Uuid
}

export interface DateConsimtamantNou {
  client_id: Uuid
  /** Ședința la care s-a semnat; lipsește dacă se semnează în afara uneia. */
  programare_id?: Uuid | null
  /** `VERSIUNE_ACORD` a textului care a fost pe ecran. */
  versiune: string
  /** PDF-ul gata tipărit, cu semnătura pe el, codificat base64. */
  document: string
  date_semnatar: DateSemnatar
  dispozitiv?: string | null
}

/**
 * Acordurile nu se modifică — de aceea nu există `update` aici.
 *
 * Un act semnat pe care cineva îl poate rescrie mai târziu nu mai dovedește
 * nimic. Lipsa metodei este intenționată, nu o scăpare: serverul nu are PATCH,
 * iar tabela nu are `actualizat_la`.
 */
export interface ApiConsimtaminte {
  /** GET /consimtaminte — orice rol. Cele mai noi întâi. */
  list(filtru?: FiltruConsimtaminte): Promise<Paginat<ConsimtamantDetaliu>>
  /** GET /consimtaminte/:id — orice rol. Fără fișier. */
  get(id: Uuid): Promise<ConsimtamantDetaliu>
  /** POST /consimtaminte — orice rol. Amprenta se calculează pe server. */
  create(date: DateConsimtamantNou): Promise<ConsimtamantDetaliu>
  /**
   * GET /consimtaminte/:id/document — orice rol. PDF-ul propriu-zis.
   * Întoarce octeții, nu o adresă: răspunsul cere antetul de autentificare.
   */
  document(id: Uuid): Promise<Blob>
  /**
   * DELETE /consimtaminte/:id — doar administrator.
   * Pentru acordul semnat din greșeală pe fișa altcuiva, nimic altceva.
   */
  remove(id: Uuid): Promise<void>
}

// ---------------------------------------------------------------------------
// Programări
// ---------------------------------------------------------------------------

export interface FiltruProgramari extends IntervalTimp {
  executant_id?: Uuid
  punct_lucru_id?: Uuid
  client_id?: Uuid
  /** Ședințele unui tratament, pentru fișa lui. */
  tratament_id?: Uuid
  /** Serviciile unei programări (`Programare.vizita_id`), pentru fereastra ei. */
  vizita_id?: Uuid
  stare?: StareProgramare[]
  /** true = doar ședințele onorate și neîncasate. */
  neachitate?: boolean
}

/**
 * Un serviciu al programării, așa cum îl trimite formularul.
 *
 * Fiecare devine un rând `programare`, cu prețul, tratamentul și plata lui;
 * toate au clientul, persoana, intervalul și nota programării.
 */
export interface ServiciuProgramare {
  /**
   * Rândul existent, la modificare. Lipsă = serviciu nou, adăugat programării.
   * La creare nu are sens și se ignoră.
   */
  id?: Uuid
  /** Trebuie să fie un articol de tip 'serviciu' (CHECK articol_tip). */
  articol_id: Uuid
  /** Lipsă = prețul sugerat (v. `pretSugerat`). */
  pret?: number
  /**
   * Tratamentul în care intră ședința, doar pentru un serviciu nou. Lipsă:
   * tratamentul în curs al clientului pentru acest serviciu, sau unul nou.
   */
  tratament_id?: Uuid | null
}

export interface DateProgramareNoua {
  client_id: Uuid
  /**
   * Serviciul unei programări cu un singur serviciu — forma de dinainte de
   * `servicii`. Cu `servicii`, se ignoră (ca și `pret` și `tratament_id`).
   * Trebuie să fie un articol de tip 'serviciu' (CHECK articol_tip).
   */
  articol_id?: Uuid
  /**
   * Serviciile programării, în ordinea lor — unul sau mai multe: o manichiură
   * și o ședință de IPL, două ședințe din abonamente diferite, oricâte.
   */
  servicii?: ServiciuProgramare[]
  executant_id: Uuid
  /** Opțional: clinica are un singur punct de lucru, iar serverul îl completează. */
  punct_lucru_id?: Uuid
  incepe_la: Timestamptz
  /** CHECK (se_termina_la > incepe_la) */
  se_termina_la: Timestamptz
  /**
   * Prețul ședinței. Lipsă = serverul aplică `pretSugerat` (ultimul preț al
   * acestui client pentru acest serviciu, altfel prețul de listă; într-un
   * tratament, partea ședinței din el).
   */
  pret?: number
  nota?: string | null
  /**
   * Tratamentul în care intră ședința. Lipsă: serverul o pune singur în
   * tratamentul în curs al clientului pentru acest serviciu, sau deschide
   * unul nou dacă serviciul se face în mai multe ședințe. Trimis explicit —
   * din fișa tratamentului — se verifică să fie al clientului și în curs.
   */
  tratament_id?: Uuid | null
}

/**
 * Clientul, persoana, intervalul și nota sunt ale PROGRAMĂRII: trimise pe
 * oricare serviciu al ei, se schimbă pe toate. `articol_id` și `pret` sunt ale
 * rândului cerut.
 *
 * `servicii` este lista COMPLETĂ a programării de acum încolo: cele cu `id`
 * rămân (cu serviciul și prețul trimise), cele fără `id` se adaugă, iar un
 * serviciu existent care lipsește se scoate — primește o programare a lui și
 * se anulează. Un serviciu deja încasat nu se poate scoate.
 */
export type DateProgramareModificata = Partial<Omit<DateProgramareNoua, 'tratament_id'>>

/** Ce s-ar întâmpla cu tratamentul dacă ședința s-ar salva acum. */
export interface SugestieTratament {
  /** Tratamentul în curs în care ar intra ședința; null = ședința l-ar deschide. */
  id: Uuid | null
  numar_sedinte: number
  /** A câta ședință ar fi. Peste `numar_sedinte` = tratamentul e plin. */
  sedinta_nr: number
  pret_total: number
}

/** Răspunsul la „cât îi cer clientului pentru serviciul ăsta?”. */
export interface PretSugerat {
  pret: number
  /**
   * true = prețul vine din istoricul clientului (i s-a mai făcut acest
   * serviciu la un preț diferit de cel de listă). Interfața îl spune, ca
   * operatoarea să știe de ce câmpul nu arată prețul din nomenclator.
   */
  din_istoric: boolean
  /** Prețul curent din nomenclator, pentru comparație. */
  pret_lista: number
  /**
   * Prezent când ședința ar face parte dintr-un tratament. Atunci `pret` este
   * PARTEA ședinței — restul neplanificat din `pret_total`, împărțit la
   * ședințele rămase — nu prețul din nomenclator.
   */
  tratament?: SugestieTratament
}

/** Ce se poate cere odată cu schimbarea stării unei ședințe. */
export interface OptiuniStare {
  /** true = încasează ședința pe loc, în aceeași tranzacție (doar la 'onorat'). */
  achitat?: boolean
  /**
   * Suma corectată a ședinței — cât s-a luat de fapt. Se aplică înaintea
   * încasării; refuzată pe o ședință deja încasată.
   */
  pret?: number
  /**
   * Sumele corectate ale serviciilor programării, pe rând: `{ [id]: suma }`.
   * Aceleași reguli ca `pret`, pentru fiecare.
   */
  preturi?: Record<Uuid, number>
  /** Numerar sau card — pe bonul încasării făcute odată cu `achitat`. */
  metoda_plata?: MetodaPlata
}

export interface ApiProgramari {
  /** GET /programari — orice rol. Calendar: interval, executant, punct, stare. */
  list(filtru?: FiltruProgramari): Promise<ProgramareDetaliu[]>
  /** Programarea singură, hidratată. */
  get(id: Uuid): Promise<ProgramareDetaliu>
  /**
   * POST /programari — orice rol.
   * Respinsă (409) dacă executantul are deja o programare suprapusă
   * (EXCLUDE USING gist ... WHERE stare <> 'anulat'). Întoarce PRIMUL serviciu
   * al programării; toate se citesc cu `list({ vizita_id })`.
   */
  create(date: DateProgramareNoua): Promise<ProgramareDetaliu>
  /**
   * PATCH /programari/:id — orice rol. Modifică sau reprogramează toată
   * programarea. Întoarce rândul cerut — sau, dacă a fost scos din listă,
   * primul serviciu rămas.
   */
  update(id: Uuid, date: DateProgramareModificata): Promise<ProgramareDetaliu>
  /**
   * PATCH /programari/:id/stare — orice rol.
   *
   * Starea este a programării: se pune pe TOATE serviciile ei, iar `achitat`
   * le încasează pe toate cele neplătite, pe un singur bon.
   *
   * `achitat` are efect doar la trecerea pe 'onorat' și doar o singură dată:
   * true înregistrează pe loc încasarea ședinței, în aceeași tranzacție.
   * Omis sau false, ședința rămâne „de plată” și se încasează mai târziu, prin
   * `vanzari.incaseaza` — cazul clientului care vine de mai multe ori și
   * plătește la final.
   *
   * `pret` corectează suma ședinței în același gest — la casă se află cât s-a
   * luat de fapt. Într-un tratament, ședințele următoare își refac partea din
   * ce a rămas. Ultima ședință onorată a unui tratament îl încheie singură.
   */
  schimbaStarea(
    id: Uuid,
    stare: StareProgramare,
    optiuni?: OptiuniStare,
  ): Promise<ProgramareDetaliu>
  /**
   * GET /programari/pret-sugerat?client_id=&articol_id= — orice rol.
   * Prețul cu care se deschide formularul, ținând minte ce a plătit clientul
   * ultima dată pentru acel serviciu — sau, într-un tratament, partea ședinței.
   */
  pretSugerat(client_id: Uuid, articol_id: Uuid): Promise<PretSugerat>
}

// ---------------------------------------------------------------------------
// Tratamente — servicii în mai multe ședințe
// ---------------------------------------------------------------------------

export interface FiltruTratamente extends ParametriPaginare {
  client_id?: Uuid
  articol_id?: Uuid
  /** true = doar cele în curs; false = doar cele încheiate; lipsă = toate. */
  in_curs?: boolean
  /** Căutare după numele clientului sau denumirea serviciului. */
  q?: string
}

export interface DateTratamentNou {
  client_id: Uuid
  /** Un articol de tip 'serviciu'. */
  articol_id: Uuid
  /** Lipsă = `articol.numar_sedinte`. */
  numar_sedinte?: number
  /** Lipsă = prețul reținut al clientului pentru acest serviciu, altfel `articol.pret_lista`. */
  pret_total?: number
  nota?: string | null
}

export interface DateTratamentModificat {
  /** Nu poate coborî sub ședințele deja programate sau făcute. */
  numar_sedinte?: number
  pret_total?: number
  nota?: string | null
}

/**
 * Ședințele NU se scriu pe aici: se fac prin `programari.create`, ca oricare
 * alta, iar serverul le pune singur în tratamentul în curs. Metodele de mai
 * jos deschid, corectează și încheie înțelegerea. Nu există `remove`:
 * încheierea de mână este „clientul a renunțat”, cu ședințele și banii la
 * locul lor.
 */
export interface ApiTratamente {
  /** GET /tratamente — orice rol. Cele în curs întâi, apoi după următoarea ședință. */
  list(filtru?: FiltruTratamente): Promise<Paginat<TratamentDetaliu>>
  /** GET /tratamente/:id — orice rol. */
  get(id: Uuid): Promise<TratamentDetaliu>
  /**
   * POST /tratamente — orice rol. Deschide un tratament fără ședințe încă.
   * Respins (409) dacă clientul are deja unul în curs la același serviciu.
   */
  create(date: DateTratamentNou): Promise<TratamentDetaliu>
  /** PATCH /tratamente/:id — orice rol. */
  update(id: Uuid, date: DateTratamentModificat): Promise<TratamentDetaliu>
  /** POST /tratamente/:id/incheiere — orice rol. Fără efect dacă e deja încheiat. */
  incheie(id: Uuid): Promise<TratamentDetaliu>
  /**
   * POST /tratamente/:id/redeschidere — orice rol.
   * Respins (409) dacă între timp s-a deschis alt tratament în curs la aceeași pereche.
   */
  redeschide(id: Uuid): Promise<TratamentDetaliu>
  /**
   * DELETE /tratamente/:id — administrator. Șterge și ședințele lui, și banii
   * încasați pe ele: nu mai apar nici în calendar, nici în Statistici.
   */
  remove(id: Uuid): Promise<void>
}

// ---------------------------------------------------------------------------
// Notițe în calendar
// ---------------------------------------------------------------------------

export interface FiltruNotite extends IntervalTimp {
  /**
   * Notițele persoanei ȘI cele ale întregii clinici (`executant_id` NULL).
   * Întrebarea din calendar este „ce o privește pe Irina azi?”, iar „clinica e
   * închisă de la 14” o privește.
   */
  executant_id?: Uuid
}

export interface DateNotitaNoua {
  titlu: string
  detalii?: string | null
  /** Lipsă sau `null` = pentru toată clinica. */
  executant_id?: Uuid | null
  incepe_la: Timestamptz
  /** CHECK (se_termina_la > incepe_la) */
  se_termina_la: Timestamptz
}

/** `executant_id: null` explicit mută notița pe toată clinica. */
export type DateNotitaModificata = Partial<DateNotitaNoua>

export interface ApiNotite {
  /** GET /notite — orice rol. Interval (ca suprapunere) și persoană. */
  list(filtru?: FiltruNotite): Promise<NotitaDetaliu[]>
  /** GET /notite/:id — orice rol. */
  get(id: Uuid): Promise<NotitaDetaliu>
  /** POST /notite — orice rol. Nu verifică suprapunerea: notița e informativă. */
  create(date: DateNotitaNoua): Promise<NotitaDetaliu>
  /** PATCH /notite/:id — orice rol. */
  update(id: Uuid, date: DateNotitaModificata): Promise<NotitaDetaliu>
  /**
   * DELETE /notite/:id — orice rol.
   * Singura entitate din calendar care se poate șterge: nu e o ședință care a
   * avut loc și nu mișcă bani. Ștergerea rămâne în jurnal.
   */
  remove(id: Uuid): Promise<void>
}

// ---------------------------------------------------------------------------
// Vânzări
// ---------------------------------------------------------------------------

export interface FiltruVanzari extends IntervalTimp, ParametriPaginare {
  client_id?: Uuid
  punct_lucru_id?: Uuid
  operator_id?: Uuid
  /**
   * „Făcută de”: vânzările cu măcar o linie câștigată de persoană — ședințe
   * făcute de ea sau produse vândute de ea. Pentru salariu.
   */
  persoana_id?: Uuid
  articol_id?: Uuid
  /** true = doar cele plătite; false = doar cele neachitate; lipsă = toate. */
  achitat?: boolean
}

export interface DateLinieVanzare {
  articol_id: Uuid
  cantitate: number
  /**
   * Prețul efectiv, copiat din articol la momentul vânzării și editabil.
   * Dacă lipsește, serverul folosește `articol.pret_lista` curent.
   */
  pret_unitar?: number
  /** Programarea stinsă de linie. Vezi `VanzareLinie.programare_id`. */
  programare_id?: Uuid | null
}

export interface DateVanzareNoua {
  client_id: Uuid
  /** Opțional: un singur punct de lucru, completat de server. */
  punct_lucru_id?: Uuid
  /** Opțional; implicit utilizatorul autentificat. */
  operator_id?: Uuid
  programare_id?: Uuid | null
  efectuat_la: Timestamptz
  nota?: string | null
  /**
   * false = produsele pleacă acum, banii vin mai târziu: suma intră în
   * `de_incasat` al clientului. Lipsă = achitată pe loc, în `efectuat_la`.
   * Refuzat (400 pe „achitat”) pe o vânzare care stinge ședințe.
   */
  achitat?: boolean
  /** Numerar sau card, pe o vânzare achitată; ignorat pe una neachitată. */
  metoda_plata?: MetodaPlata
  /** Cel puțin o linie. Antetul și liniile se scriu într-o singură tranzacție. */
  linii: DateLinieVanzare[]
}

export interface DateVanzareModificata {
  client_id?: Uuid
  punct_lucru_id?: Uuid
  operator_id?: Uuid
  programare_id?: Uuid | null
  efectuat_la?: Timestamptz
  nota?: string | null
  /**
   * Bifa „Achitat”. true pe una neachitată = plătită ACUM; pe una deja
   * plătită nu mută data. false = datoria revine.
   */
  achitat?: boolean
  /**
   * Numerar sau card — se schimbă și singură (Statistici → Încasări). O
   * vânzare care rămâne neachitată nu are metodă: serverul o golește.
   */
  metoda_plata?: MetodaPlata
  /** Dacă e prezent, înlocuiește integral setul de linii. */
  linii?: DateLinieVanzare[]
}

/**
 * Încasarea ședințelor rămase de plată — POST /vanzari/incasare.
 *
 * Prețurile NU se trimit: serverul le ia din `programare.pret`, adică din ce
 * s-a convenit la programare. Altfel interfața ar putea încasa altă sumă decât
 * cea agreată, iar clientul ar avea dreptate să se supere.
 */
export interface DateIncasare {
  client_id: Uuid
  /** Ședințele care se sting. Trebuie să fie onorate, neîncasate, ale clientului. */
  programare_ids: Uuid[]
  /** Produse cumpărate odată cu plata (o cremă la plecare). */
  linii?: DateLinieVanzare[]
  /** Implicit acum. */
  efectuat_la?: Timestamptz
  nota?: string | null
  /** Numerar sau card. */
  metoda_plata?: MetodaPlata
}

/**
 * Plata unei părți dintr-o vânzare neachitată — POST /vanzari/:id/achitare.
 *
 * Clienta a luat cinci creme pe datorie și plătește azi două (cerința
 * clinicii, 5 oct. 2026). Liniile alese trec pe un bon nou, achitat ACUM, cu
 * aceeași clientă și aceeași dată a vânzării; restul rămâne datorie, cu totalul
 * scăzut. Toate liniile alese = toată vânzarea trece achitată, ca la „Achitat”.
 */
export interface DateAchitareLinii {
  /** Liniile plătite acum — cel puțin una, toate de pe această vânzare. */
  linie_ids: Uuid[]
  /** Numerar sau card. */
  metoda_plata: MetodaPlata
}

export interface ApiVanzari {
  /**
   * GET /vanzari — orice rol, CU STATISTICILE DEBLOCATE (v. `ApiStatistici`).
   * Lista tuturor încasărilor este ea însăși o statistică. Filtrare: client,
   * interval, punct, operator, articol. Încuiată -> 403 pe `acces_statistici`.
   */
  list(filtru?: FiltruVanzari): Promise<Paginat<VanzareDetaliu>>
  /** GET /vanzari/:id — orice rol. Vânzarea cu liniile ei. */
  get(id: Uuid): Promise<VanzareDetaliu>
  /** POST /vanzari — orice rol. O singură tranzacție, antet + linii. */
  create(date: DateVanzareNoua): Promise<VanzareDetaliu>
  /** PATCH /vanzari/:id — orice rol. Corectează antetul sau liniile. */
  update(id: Uuid, date: DateVanzareModificata): Promise<VanzareDetaliu>
  /**
   * POST /vanzari/incasare — orice rol.
   * Stinge într-o singură plată ședințele rămase de achitat ale unui client.
   */
  incaseaza(date: DateIncasare): Promise<VanzareDetaliu>
  /**
   * POST /vanzari/:id/achitare — orice rol. Achită doar liniile alese ale unei
   * vânzări neachitate; v. `DateAchitareLinii`. Întoarce bonul achitat.
   */
  achitaLinii(id: Uuid, date: DateAchitareLinii): Promise<VanzareDetaliu>
  /**
   * DELETE /vanzari/:id — orice rol, CU STATISTICILE DEBLOCATE.
   * Ședințele stinse de bon redevin „de plată”; bonul rămâne în jurnal.
   */
  remove(id: Uuid): Promise<void>
}

// ---------------------------------------------------------------------------
// Statistici — în spatele unei parole separate
// ---------------------------------------------------------------------------

/**
 * Deblocarea statisticilor, așa cum o vede interfața.
 *
 * Jetonul propriu-zis NU iese de aici: îl păstrează clientul API, în memorie,
 * și îl pune singur pe cererile care îl cer. Nu ajunge în `localStorage` —
 * o reîncărcare a paginii încuie din nou statisticile, exact ca ieșirea din ele.
 */
export interface AccesStatistici {
  /**
   * Când se încuie ecranul — pe ceasul ACESTUI calculator (acum + cât ține
   * deblocarea), nu pe al serverului, ca un ceas care o ia înainte să nu
   * încuie ecranul imediat după parolă.
   */
  expira_la: Timestamptz
}

export interface StareParolaStatistici {
  /** false = nimeni n-a ales-o încă; un administrator o alege la prima deschidere. */
  parola_setata: boolean
}

export interface DateParolaStatistici {
  /** Cel puțin 8 caractere, diferită de parola contului care o alege. */
  parola_noua: string
  /** Obligatorie când există deja o parolă: fără ea nu se schimbă. */
  parola_curenta?: string
}

export interface FiltruStatistici {
  /** Prima zi a perioadei, inclusiv. */
  de_la: DateOnly
  /** Ultima zi a perioadei, inclusiv. */
  pana_la: DateOnly
  /** Cât cuprinde o bară. Maximum 400 de bare (un an zi cu zi). */
  pas: PasStatistici
  /** Fusul orar în care se citesc zilele, ex. „Europe/Bucharest”. Lipsă = al clinicii. */
  fus?: string
  /** Perioada cu care se compară totalurile; amândouă capetele sau niciunul. */
  comparatie_de_la?: DateOnly
  comparatie_pana_la?: DateOnly
}

export interface ApiStatistici {
  /** GET /statistici/acces — orice rol. Există parola? */
  stare(): Promise<StareParolaStatistici>
  /**
   * POST /statistici/acces — orice rol. Parola bună deblochează statisticile.
   * Greșită -> 400 pe `parola` (NU 401: sesiunea aplicației rămâne).
   */
  deblocheaza(parola: string): Promise<AccesStatistici>
  /**
   * PUT /statistici/parola — administrator. Prima dată fără `parola_curenta`;
   * apoi numai cu ea. Deblochează pe loc și încuie toate deblocările vechi.
   */
  seteazaParola(date: DateParolaStatistici): Promise<AccesStatistici>
  /** Uită deblocarea. Nu cere nimic serverului — jetonul pur și simplu dispare. */
  blocheaza(): void
  /** GET /statistici — cere deblocarea. Încuiată -> 403 pe `acces_statistici`. */
  raport(filtru: FiltruStatistici): Promise<RaportStatistici>
}

export interface FiltruCheltuieli extends ParametriPaginare {
  de_la?: DateOnly
  pana_la?: DateOnly
  categorie?: string
  /** Căutare în categorie și descriere. */
  q?: string
}

/** Lista cheltuielilor, cu suma TUTUROR celor din filtru — nu doar a paginii. */
export interface ListaCheltuieli extends Paginat<CheltuialaDetaliu> {
  suma: number
}

export interface DateCheltuialaNoua {
  data: DateOnly
  categorie: string
  /** CHECK (suma > 0) */
  suma: number
  descriere?: string | null
}

export type DateCheltuialaModificata = Partial<DateCheltuialaNoua>

/** Toate rutele cer statisticile deblocate. */
export interface ApiCheltuieli {
  /** GET /cheltuieli — cele mai noi întâi. */
  list(filtru?: FiltruCheltuieli): Promise<ListaCheltuieli>
  /** GET /cheltuieli/categorii — cele folosite deja, cele mai folosite întâi. */
  categorii(): Promise<string[]>
  /** POST /cheltuieli */
  create(date: DateCheltuialaNoua): Promise<CheltuialaDetaliu>
  /** PATCH /cheltuieli/:id */
  update(id: Uuid, date: DateCheltuialaModificata): Promise<CheltuialaDetaliu>
  /** DELETE /cheltuieli/:id — urma rămâne în jurnal. */
  remove(id: Uuid): Promise<void>
}

// ---------------------------------------------------------------------------
// Nomenclatoare
// ---------------------------------------------------------------------------

export interface FiltruArticole {
  tip?: TipArticol
  activ?: boolean
  q?: string
}

export interface DateArticolNou {
  tip: TipArticol
  denumire: string
  /** Obligatoriu > 0 pentru 'serviciu', trebuie să lipsească pentru 'produs'. */
  durata_minute?: number | null
  pret_lista: number
  activ?: boolean
  /** >= 1 la servicii; lipsă = 1. Refuzat pe produse (articol_sedinte_ck). */
  numar_sedinte?: number
  /**
   * Doar la produse; refuzată pe servicii (articol_categorie_ck). Goală sau
   * null = fără categorie. Scrisă altfel doar prin majuscule decât una
   * existentă, serverul o lipește de aceea.
   */
  categorie?: string | null
}

export type DateArticolModificat = Partial<DateArticolNou>

export interface ApiArticole {
  /** GET /articole — orice rol. Filtrare pe tip și activ. */
  list(filtru?: FiltruArticole): Promise<Articol[]>
  /** POST /articole — doar administrator. */
  create(date: DateArticolNou): Promise<Articol>
  /** PATCH /articole/:id — doar administrator. */
  update(id: Uuid, date: DateArticolModificat): Promise<Articol>
  /**
   * DELETE /articole/:id — doar administrator, doar un articol nefolosit.
   * Unul aflat pe bonuri, în programări sau în tratamente -> 409: se dezactivează.
   */
  remove(id: Uuid): Promise<void>
}

export interface DatePunctLucruNou {
  denumire: string
  adresa?: string | null
  telefon?: string | null
  activ?: boolean
}

export type DatePunctLucruModificat = Partial<DatePunctLucruNou>

/**
 * Punctele de lucru — rămân în contract, dar NU au ecran.
 *
 * Clinica are o singură locație, așa că interfața nu o cere și nu o arată
 * nicăieri; serverul completează singur punctul implicit. Rutele stau aici
 * pentru că §7 le prevede și pentru ziua în care se deschide al doilea punct.
 */
export interface ApiPuncteLucru {
  /** GET /puncte-lucru — orice rol. */
  list(filtru?: { activ?: boolean }): Promise<PunctLucru[]>
  /** POST /puncte-lucru — doar administrator. */
  create(date: DatePunctLucruNou): Promise<PunctLucru>
  /** PATCH /puncte-lucru/:id — doar administrator. */
  update(id: Uuid, date: DatePunctLucruModificat): Promise<PunctLucru>
}

// ---------------------------------------------------------------------------
// Utilizatori — toate rutele cer rol de administrator
// ---------------------------------------------------------------------------

export interface DateUtilizatorNou {
  nume: string
  email: string
  parola: string
  rol: RolUtilizator
  activ?: boolean
}

export interface DateUtilizatorModificat {
  nume?: string
  email?: string
  rol?: RolUtilizator
  activ?: boolean
  /** Culoarea din calendar, #rrggbb; null = înapoi la cea automată. */
  culoare?: string | null
}

export interface ApiUtilizatori {
  /** GET /utilizatori — administrator. */
  list(filtru?: { activ?: boolean; q?: string }): Promise<Utilizator[]>
  /** POST /utilizatori — administrator. */
  create(date: DateUtilizatorNou): Promise<Utilizator>
  /** PATCH /utilizatori/:id — administrator. Rol sau dezactivare. */
  update(id: Uuid, date: DateUtilizatorModificat): Promise<Utilizator>
  /**
   * POST /utilizatori/:id/reset-parola — administrator.
   * Resetează parola ȘI revocă toate sesiunile contului.
   */
  reseteazaParola(id: Uuid, parola_noua: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Jurnalul operațiunilor — doar administrator
// ---------------------------------------------------------------------------

export interface FiltruJurnal extends IntervalTimp, ParametriPaginare {
  entitate?: string
  entitate_id?: Uuid
  utilizator_id?: Uuid
  actiune?: string[]
}

// ---------------------------------------------------------------------------
// Programul de lucru — zile pare / impare, pe persoană și lună
// ---------------------------------------------------------------------------

export interface FiltruProgramLucru {
  /** Prima zi a intervalului afișat; se întorc lunile care îl ating. */
  de_la: DateOnly
  pana_la: DateOnly
}

export interface DateProgramLucru {
  utilizator_id: Uuid
  /** „AAAA-LL” sau ziua 1 a lunii. */
  luna: string
  /** null = scoate programul lunii (fără program ales). */
  zile: ZileLucru | null
  /** Obligatorii la 'personalizat': numerele zilelor lucrate. */
  zile_alese?: number[]
}

export interface ApiProgramLucru {
  /** GET /program-lucru — orice rol. */
  list(filtru: FiltruProgramLucru): Promise<ProgramLucru[]>
  /** PUT /program-lucru — orice rol. Pune, înlocuiește sau (cu `zile: null`) scoate. */
  seteaza(date: DateProgramLucru): Promise<ProgramLucru | null>
}

export interface ApiJurnal {
  /** GET /jurnal — administrator. Filtrare pe entitate, utilizator, interval. */
  list(filtru?: FiltruJurnal): Promise<Paginat<JurnalOperatiuneDetaliu>>
}

// ---------------------------------------------------------------------------
// Clientul complet
// ---------------------------------------------------------------------------

export interface ApiClient {
  auth: ApiAuth
  clienti: ApiClienti
  consimtaminte: ApiConsimtaminte
  programari: ApiProgramari
  notite: ApiNotite
  programLucru: ApiProgramLucru
  tratamente: ApiTratamente
  vanzari: ApiVanzari
  statistici: ApiStatistici
  cheltuieli: ApiCheltuieli
  articole: ApiArticole
  puncteLucru: ApiPuncteLucru
  utilizatori: ApiUtilizatori
  jurnal: ApiJurnal
}
