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
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  DateOnly,
  DateSemnatar,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  NotaClientDetaliu,
  ProgramareDetaliu,
  PunctLucru,
  RolUtilizator,
  StareProgramare,
  Timestamptz,
  TipArticol,
  Utilizator,
  Uuid,
  VanzareDetaliu,
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
  stare?: StareProgramare[]
  /** true = doar ședințele onorate și neîncasate. */
  neachitate?: boolean
}

export interface DateProgramareNoua {
  client_id: Uuid
  /** Trebuie să fie un articol de tip 'serviciu' (CHECK articol_tip). */
  articol_id: Uuid
  executant_id: Uuid
  /** Opțional: clinica are un singur punct de lucru, iar serverul îl completează. */
  punct_lucru_id?: Uuid
  incepe_la: Timestamptz
  /** CHECK (se_termina_la > incepe_la) */
  se_termina_la: Timestamptz
  /**
   * Prețul ședinței. Lipsă = serverul aplică `pretSugerat` (ultimul preț al
   * acestui client pentru acest serviciu, altfel prețul de listă).
   */
  pret?: number
  nota?: string | null
}

export type DateProgramareModificata = Partial<DateProgramareNoua>

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
}

export interface ApiProgramari {
  /** GET /programari — orice rol. Calendar: interval, executant, punct, stare. */
  list(filtru?: FiltruProgramari): Promise<ProgramareDetaliu[]>
  /** Programarea singură, hidratată. */
  get(id: Uuid): Promise<ProgramareDetaliu>
  /**
   * POST /programari — orice rol.
   * Respinsă (409) dacă executantul are deja o programare suprapusă
   * (EXCLUDE USING gist ... WHERE stare <> 'anulat').
   */
  create(date: DateProgramareNoua): Promise<ProgramareDetaliu>
  /** PATCH /programari/:id — orice rol. Modifică sau reprogramează. */
  update(id: Uuid, date: DateProgramareModificata): Promise<ProgramareDetaliu>
  /**
   * PATCH /programari/:id/stare — orice rol.
   *
   * `achitat` are efect doar la trecerea pe 'onorat' și doar o singură dată:
   * true înregistrează pe loc încasarea ședinței, în aceeași tranzacție.
   * Omis sau false, ședința rămâne „de plată” și se încasează mai târziu, prin
   * `vanzari.incaseaza` — cazul clientului care vine de mai multe ori și
   * plătește la final.
   */
  schimbaStarea(
    id: Uuid,
    stare: StareProgramare,
    achitat?: boolean,
  ): Promise<ProgramareDetaliu>
  /**
   * GET /programari/pret-sugerat?client_id=&articol_id= — orice rol.
   * Prețul cu care se deschide formularul, ținând minte ce a plătit clientul
   * ultima dată pentru acel serviciu.
   */
  pretSugerat(client_id: Uuid, articol_id: Uuid): Promise<PretSugerat>
}

// ---------------------------------------------------------------------------
// Vânzări
// ---------------------------------------------------------------------------

export interface FiltruVanzari extends IntervalTimp, ParametriPaginare {
  client_id?: Uuid
  punct_lucru_id?: Uuid
  operator_id?: Uuid
  articol_id?: Uuid
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
}

export interface ApiVanzari {
  /** GET /vanzari — orice rol. Filtrare: client, interval, punct, operator, articol. */
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
}

export type DateArticolModificat = Partial<DateArticolNou>

export interface ApiArticole {
  /** GET /articole — orice rol. Filtrare pe tip și activ. */
  list(filtru?: FiltruArticole): Promise<Articol[]>
  /** POST /articole — doar administrator. */
  create(date: DateArticolNou): Promise<Articol>
  /** PATCH /articole/:id — doar administrator. */
  update(id: Uuid, date: DateArticolModificat): Promise<Articol>
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
  vanzari: ApiVanzari
  articole: ApiArticole
  puncteLucru: ApiPuncteLucru
  utilizatori: ApiUtilizatori
  jurnal: ApiJurnal
}
