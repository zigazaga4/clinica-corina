// TypeScript types generated from the PostgreSQL schema
// Contract CTR-2026-011 | ZIAN BUILDING S.R.L.

export type RolUtilizator = 'administrator' | 'utilizator'
export type StareProgramare = 'programat' | 'onorat' | 'anulat' | 'neprezentat'
export type TipArticol = 'serviciu' | 'produs'
export type ActiuneJurnal = 'creare' | 'modificare' | 'stergere' | 'arhivare' | 'autentificare'
export type StareAbonament = 'activ' | 'epuizat' | 'anulat' | 'expirat'
export type MetodaPlata = 'numerar' | 'card' | 'transfer' | 'online'

export interface Utilizator {
  id: string
  nume: string
  email: string
  parola_hash: string
  rol: RolUtilizator
  activ: boolean
  ultima_autentificare: string | null
  creat_la: string
  actualizat_la: string
}

export interface PunctLucru {
  id: string
  denumire: string
  adresa: string | null
  telefon: string | null
  activ: boolean
  creat_la: string
  actualizat_la: string
}

export interface Articol {
  id: string
  tip: TipArticol
  denumire: string
  durata_minute: number | null
  /**
   * Preț de referință. La un serviciu în mai multe ședințe este prețul
   * ÎNTREGULUI tratament, nu al unei veniri.
   */
  pret_lista: number
  activ: boolean
  creat_la: string
  actualizat_la: string
  /** În câte ședințe se face serviciul; 1 = o singură venire. Produsele: 1. */
  numar_sedinte: number
}

export interface Client {
  id: string
  /**
   * Numele întreg, într-un singur câmp, ca în formular.
   *
   * Despărțit în `nume` + `prenume`, jumătate din fișe ajung cu „Maria Elena”
   * într-una și nimic în cealaltă, iar căutarea trebuie apoi să încerce ambele
   * ordini. Interfața cere „Numele clientului” o singură dată.
   */
  nume: string
  telefon: string | null
  email: string | null
  adresa: string | null
  data_nasterii: string | null
  /** NULL = activ; arhivarea este ștergere logică. */
  arhivat_la: string | null
  creat_de: string | null
  creat_la: string
  actualizat_la: string
}

export interface NotaClient {
  id: string
  client_id: string
  autor_id: string | null
  text: string
  creat_la: string
}

export interface Programare {
  id: string
  client_id: string
  articol_id: string
  articol_tip: TipArticol
  executant_id: string
  punct_lucru_id: string
  incepe_la: string
  se_termina_la: string
  stare: StareProgramare
  /**
   * Cât costă ȘEDINȚA ACEASTA — nu prețul din nomenclator.
   *
   * Se copiază la creare (ultimul preț al aceluiași client pentru același
   * serviciu, altfel `articol.pret_lista`) și rămâne apoi neatins: o scumpire
   * din nomenclator nu are voie să rescrie prețul unei ședințe deja convenite.
   */
  pret: number
  nota: string | null
  creat_de: string | null
  creat_la: string
  actualizat_la: string
  /** Tratamentul din care face parte ședința; NULL la serviciile dintr-o venire. */
  tratament_id: string | null
  /**
   * Programarea din calendar din care face parte rândul. Rândurile cu același
   * `vizita_id` sunt serviciile aceleiași programări: același client, aceeași
   * persoană, același interval, aceeași stare.
   */
  vizita_id: string
}

/**
 * Tabela `tratament` — un serviciu făcut în mai multe ședințe, pentru un client.
 *
 * Ține doar ce s-a convenit la început: câte ședințe și cât în total. Tot
 * restul se numără din programările legate prin `programare.tratament_id`
 * (v. `TratamentDetaliu`). `incheiat_la` NULL = în curs.
 */
export interface Tratament {
  id: string
  client_id: string
  articol_id: string
  articol_tip: TipArticol
  numar_sedinte: number
  pret_total: number
  nota: string | null
  incheiat_la: string | null
  creat_de: string | null
  creat_la: string
  actualizat_la: string
}

export interface Vanzare {
  id: string
  client_id: string
  punct_lucru_id: string
  operator_id: string
  programare_id: string | null
  efectuat_la: string
  nota: string | null
  creat_la: string
  actualizat_la: string
  /** Când a plătit clientul; NULL = neachitată (produse date acum, plătite mai târziu). */
  achitat_la: string | null
}

export interface VanzareLinie {
  id: string
  vanzare_id: string
  articol_id: string
  cantitate: number
  /** COPIAT la momentul vânzării — nu se citește din articol. */
  pret_unitar: number
  /** GENERATED ALWAYS AS round(cantitate * pret_unitar, 2) STORED. */
  total_linie: number
  /**
   * Programarea pe care o stinge această linie; NULL pentru produse.
   *
   * Aici, pe LINIE, nu pe antet: un client poate lăsa trei ședințe neachitate
   * și le plătește pe toate la final, cu o singură încasare. Cu legătura pe
   * antet ar fi încăput o singură ședință, iar restul ar fi rămas veșnic „de
   * plată”.
   *
   * Ea este ȘI răspunsul la „s-a achitat?”: o programare este achitată dacă
   * există o linie care o indică. Nu există coloană `achitat` pe programare —
   * două locuri pentru același adevăr ajung să se contrazică.
   */
  programare_id: string | null
}

export interface Abonament {
  id: string
  client_id: string
  articol_id: string
  punct_lucru_id: string
  creat_de: string | null
  numar_sedinte: number
  sedinte_folosite: number
  pret_total: number
  suma_platita: number
  stare: StareAbonament
  valabil_pana_la: string | null
  nota: string | null
  creat_la: string
  actualizat_la: string
}

export interface AbonamentSedinta {
  id: string
  abonament_id: string
  programare_id: string | null
  inregistrat_de: string | null
  efectuat_la: string
  nota: string | null
}

export interface Plata {
  id: string
  abonament_id: string
  operator_id: string | null
  suma: number
  metoda: MetodaPlata
  efectuat_la: string
  nota: string | null
}

export interface Sesiune {
  id: string
  utilizator_id: string
  token_hash: string
  emisa_la: string
  expira_la: string
  revocata_la: string | null
  dispozitiv: string | null
}

// ── Proiecții compuse întoarse de API ────────────────────────
//
// Vederile din `sql/01_schema.sql` produc exact formele de mai jos. Sufixul
// `_nume` / `_denumire` marchează un câmp adus prin JOIN, care nu se scrie
// niciodată înapoi.

/** Contul, fără `parola_hash` — coloana nu părăsește niciodată serverul. */
export type UtilizatorPublic = Omit<Utilizator, 'parola_hash'>

/** Rând din lista de clienți: `v_client_detaliu`. */
export interface ClientDetaliu extends Client {
  numar_programari: number
  numar_vanzari: number
  ultima_vizita: string | null
  /**
   * Suma ședințelor onorate și neîncasate. 0 = nu datorează nimic.
   * Stă în listă ca recepția să vadă cine are de plătit fără să deschidă fișa.
   */
  de_incasat: number
}

/** Programare hidratată: `v_programare_detaliu`. */
export interface ProgramareDetaliu extends Programare {
  client_nume: string
  client_telefon: string | null
  articol_denumire: string
  articol_durata_minute: number | null
  executant_nume: string
  punct_lucru_denumire: string
  /** DERIVAT: există o linie de vânzare care indică această programare. */
  achitat: boolean
  /** Încasarea care a stins-o, dacă a fost stinsă. */
  vanzare_id: string | null
  /** DERIVAT: `efectuat_la` al încasării care a stins-o. */
  achitat_la: string | null
  /** Câte ședințe are tratamentul din care face parte; NULL în afara unuia. */
  tratament_numar_sedinte: number | null
  /**
   * DERIVAT: a câta ședință a tratamentului este aceasta, numărând doar
   * ședințele programate sau onorate. NULL în afara unui tratament sau la o
   * ședință anulată / neprezentată — aceea nu ocupă un loc.
   */
  sedinta_nr: number | null
}

/**
 * Tratamentul cu tot ce se numără din ședințele lui: `v_tratament_detaliu`.
 *
 * Niciun câmp de mai jos nu este coloană. Se numără doar ședințele programate
 * sau onorate; cele anulate și neprezentările nu ocupă un loc și nu iau bani.
 */
export interface TratamentDetaliu extends Tratament {
  client_nume: string
  client_telefon: string | null
  articol_denumire: string
  articol_durata_minute: number | null
  sedinte_programate: number
  sedinte_onorate: number
  /** Câte mai sunt de programat: `numar_sedinte` minus cele care contează. */
  sedinte_ramase: number
  /** Suma prețurilor ședințelor care contează — cât din `pret_total` e deja împărțit. */
  alocat: number
  incasat: number
  /** Ședințe onorate și neîncasate. */
  de_incasat: number
  /** Partea propusă ședinței următoare: restul neplanificat, împărțit la cele rămase. */
  pret_urmatoarea: number
  /** Prima ședință programată în viitor sau nu; NULL dacă nu e niciuna. */
  urmatoarea_la: string | null
  /** Ultima ședință onorată. */
  ultima_la: string | null
  /** Cine face tratamentul: numele de pe ședințele neanulate, „Anda, Irina”. */
  executanti: string | null
}

/** Linie hidratată: `v_vanzare_linie_detaliu`. */
export interface VanzareLinieDetaliu extends VanzareLinie {
  articol_denumire: string
  articol_tip: TipArticol
  /** Când a avut loc ședința stinsă de linie — NULL pentru produse. */
  programare_incepe_la: string | null
}

/** Încasare hidratată: `v_vanzare_detaliu` + liniile aduse separat. */
export interface VanzareDetaliu extends Vanzare {
  client_nume: string
  punct_lucru_denumire: string
  operator_nume: string
  /** DERIVAT: `achitat_la IS NOT NULL`. */
  achitat: boolean
  linii: VanzareLinieDetaliu[]
  /** Suma liniilor; calculată de server, niciodată editabilă direct. */
  total: number
}

export interface NotaClientDetaliu extends NotaClient {
  autor_nume: string | null
}

/**
 * Tabela `notita` — o însemnare în calendar, care NU este o programare.
 *
 * Fără client, serviciu sau preț. `executant_id` NULL = pentru toată clinica.
 * Nu blochează intervalul și se poate șterge; vezi comentariul din schemă.
 */
export interface Notita {
  id: string
  titlu: string
  detalii: string | null
  executant_id: string | null
  incepe_la: string
  se_termina_la: string
  creat_de: string | null
  creat_la: string
  actualizat_la: string
}

/** `v_notita_detaliu`. `executant_nume` NULL = notiță pentru toată clinica. */
export interface NotitaDetaliu extends Notita {
  executant_nume: string | null
  creat_de_nume: string | null
}

/** O cheltuială — banii ieșiți. `data` este ziua plății, `YYYY-MM-DD`. */
export interface Cheltuiala {
  id: string
  data: string
  categorie: string
  descriere: string | null
  suma: number
  creat_de: string | null
  creat_la: string
  actualizat_la: string
}

/** `v_cheltuiala_detaliu`. */
export interface CheltuialaDetaliu extends Cheltuiala {
  creat_de_nume: string | null
}

// ── Statistici — GET /statistici ─────────────────────────────
//
// Gemene cu `src/domain/types.ts` din aplicație; vezi comentariile de acolo.

export type PasStatistici = 'zi' | 'saptamana' | 'luna'

export interface TotaluriStatistici {
  incasat: number
  incasat_servicii: number
  incasat_produse: number
  incasari: number
  cheltuieli: number
  profit: number
  neachitat: number
  programari_onorate: number
  programari_neprezentate: number
  programari_anulate: number
  programari_programate: number
  clienti: number
  clienti_noi: number
}

export interface PerioadaStatistici {
  inceput: string
  incasat_servicii: number
  incasat_produse: number
  cheltuieli: number
}

export interface StatisticaArticol {
  articol_id: string
  denumire: string
  cantitate: number
  suma: number
}

export interface StatisticaPersoana {
  utilizator_id: string
  nume: string
  programari_onorate: number
  incasat: number
}

export interface StatisticaCategorie {
  categorie: string
  suma: number
  numar: number
}

export interface StatisticaClient {
  client_id: string
  nume: string
  incasat: number
  incasari: number
}

export interface RaportStatistici {
  de_la: string
  pana_la: string
  pas: PasStatistici
  total: TotaluriStatistici
  comparatie: TotaluriStatistici | null
  perioade: PerioadaStatistici[]
  servicii: StatisticaArticol[]
  produse: StatisticaArticol[]
  persoane: StatisticaPersoana[]
  cheltuieli: StatisticaCategorie[]
  zile_saptamana: { zi: number; programari: number }[]
  clienti: StatisticaClient[]
}

/**
 * Datele clientului așa cum arătau în clipa semnării.
 *
 * Copiate, nu citite din fișă la afișare: omul își schimbă adresa peste un an,
 * iar acordul trebuie să arate în continuare ce scria pe el atunci.
 */
export interface DateSemnatar {
  nume: string
  telefon: string | null
  email: string | null
  adresa: string | null
}

/**
 * Un acord GDPR semnat. Nu se modifică niciodată — vezi `sql/01_schema.sql`.
 *
 * `document` este PDF-ul întreg, exact cum l-a văzut clientul. Rutele care
 * întorc liste NU îl citesc: pentru ele există `ConsimtamantDetaliu`, care
 * vine din vedere și nu are coloana.
 */
export interface Consimtamant {
  id: string
  client_id: string
  programare_id: string | null
  versiune: string
  document: Buffer
  marime: number
  /** sha256 hex al documentului, calculat la semnare. */
  amprenta: string
  date_semnatar: DateSemnatar
  dispozitiv: string | null
  semnat_la: string
  creat_de: string | null
}

/** Acordul fără fișier — forma cu care lucrează listele și fișa clientului. */
export interface ConsimtamantDetaliu extends Omit<Consimtamant, 'document'> {
  client_nume: string
  creat_de_nume: string | null
}

export interface JurnalOperatiune {
  id: number
  utilizator_id: string | null
  actiune: ActiuneJurnal
  entitate: string
  entitate_id: string | null
  date_vechi: Record<string, unknown> | null
  date_noi: Record<string, unknown> | null
  adresa_ip: string | null
  creat_la: string
}

export interface JurnalOperatiuneDetaliu extends JurnalOperatiune {
  utilizator_nume: string | null
}

/**
 * O intrare din istoricul clientului — GET /clienti/:id/istoric.
 * Programările și încasările sosesc într-un singur flux cronologic.
 */
export type IstoricIntrare =
  | { fel: 'programare'; la: string; programare: ProgramareDetaliu }
  | { fel: 'vanzare'; la: string; vanzare: VanzareDetaliu }

// ── API request/response shapes ──────────────────────────────

export interface LoginRequest {
  email: string
  /** Numele din contractul interfeței. `password` este acceptat ca alias. */
  parola?: string
  password?: string
  /** Platformă + versiune aplicație, memorat în `sesiune.dispozitiv`. */
  dispozitiv?: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  /** Momentul expirării access token-ului, ca interfața să-l reînnoiască din timp. */
  expira_la: string
  utilizator: UtilizatorPublic
}

export interface CreateClientRequest {
  nume: string
  telefon?: string
  email?: string
  adresa?: string
  data_nasterii?: string
}

export interface CreateProgramareRequest {
  client_id: string
  articol_id: string
  executant_id: string
  /** Opțional: clinica are un singur punct de lucru, iar serverul îl completează. */
  punct_lucru_id?: string
  incepe_la: string
  se_termina_la: string
  /** Lipsă = serverul aplică prețul reținut al clientului pentru acest serviciu. */
  pret?: number
  nota?: string
  /**
   * Tratamentul în care intră ședința. Lipsă: la un serviciu în mai multe
   * ședințe, serverul o pune singur în tratamentul în curs al clientului sau
   * deschide unul nou.
   */
  tratament_id?: string | null
}

/** O linie trimisă de interfață la crearea sau corectarea unei încasări. */
export interface DateLinieVanzare {
  articol_id: string
  cantitate: number
  /** Lipsă = `articol.pret_lista` curent, copiat pe linie. */
  pret_unitar?: number
  programare_id?: string | null
}

export interface CreateVanzareRequest {
  client_id: string
  punct_lucru_id?: string
  operator_id?: string
  programare_id?: string | null
  efectuat_la: string
  nota?: string | null
  /**
   * false = produsele pleacă acum, banii vin mai târziu. Lipsă = true: o
   * aplicație mai veche, care nu știe de câmp, înregistrează ca până acum.
   */
  achitat?: boolean
  linii: DateLinieVanzare[]
}

/**
 * Încasarea ședințelor rămase de plată — POST /vanzari/incasare.
 *
 * Prețurile NU se trimit: serverul le ia din `programare.pret`, adică din ce
 * s-a convenit la programare. Altfel interfața ar putea încasa altă sumă decât
 * cea agreată, iar clienta ar avea dreptate să se supere.
 */
export interface IncasareRequest {
  client_id: string
  programare_ids: string[]
  /** Produse cumpărate odată cu plata — o cremă la plecare. */
  linii?: DateLinieVanzare[]
  efectuat_la?: string
  nota?: string | null
}

export interface CreateAbonamentRequest {
  client_id: string
  articol_id: string
  punct_lucru_id: string
  numar_sedinte: 6 | 8 | number
  pret_total: number
  valabil_pana_la?: string
  nota?: string
}

export interface CreatePlataRequest {
  suma: number
  metoda: MetodaPlata
  nota?: string
}

// ── JWT payload ──────────────────────────────────────────────

export interface JwtPayload {
  sub: string           // utilizator.id
  email: string
  rol: RolUtilizator
  sesiune_id: string
  iat?: number
  exp?: number
}
