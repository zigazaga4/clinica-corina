/**
 * Modelul de domeniu.
 *
 * Numele câmpurilor sunt IDENTICE cu cele din specificația tehnică backend
 * (CTR-2026-011, §3 Tabele și Structura Datelor). Nu există strat de mapare
 * între JSON-ul serverului și tipurile de aici: ce trimite backend-ul, asta
 * consumă interfața. Orice redenumire trebuie făcută în ambele locuri simultan.
 *
 * Convenții de tip:
 *   uuid           -> string
 *   timestamptz    -> string ISO 8601 (ex. "2026-09-07T14:30:00.000Z")
 *   date           -> string "YYYY-MM-DD"
 *   numeric(p,s)   -> number (vezi @/lib/money pentru rotunjire)
 *   NULL           -> null (explicit, niciodată undefined, pentru a reflecta baza)
 */

export type Uuid = string
/** timestamptz serializat ISO 8601, în UTC. */
export type Timestamptz = string
/** date serializat "YYYY-MM-DD". */
export type DateOnly = string

// ---------------------------------------------------------------------------
// §5 Tipuri enumerate (ENUM)
// ---------------------------------------------------------------------------

/** CREATE TYPE rol_utilizator AS ENUM (...) */
export const ROL_UTILIZATOR = ['administrator', 'utilizator'] as const
export type RolUtilizator = (typeof ROL_UTILIZATOR)[number]

/** CREATE TYPE stare_programare AS ENUM (...) — starea inițială este 'programat'. */
export const STARE_PROGRAMARE = ['programat', 'onorat', 'anulat', 'neprezentat'] as const
export type StareProgramare = (typeof STARE_PROGRAMARE)[number]

/** CREATE TYPE tip_articol AS ENUM (...) — doar 'serviciu' poate fi programat. */
export const TIP_ARTICOL = ['serviciu', 'produs'] as const
export type TipArticol = (typeof TIP_ARTICOL)[number]

/** CREATE TYPE actiune_jurnal AS ENUM (...) */
export const ACTIUNE_JURNAL = [
  'creare',
  'modificare',
  'stergere',
  'arhivare',
  'autentificare',
] as const
export type ActiuneJurnal = (typeof ACTIUNE_JURNAL)[number]

// ---------------------------------------------------------------------------
// §3 Entități
// ---------------------------------------------------------------------------

/**
 * Tabela `utilizator` — conturile personalului.
 * `parola_hash` NU apare niciodată în răspunsurile API și nu există aici.
 */
export interface Utilizator {
  id: Uuid
  nume: string
  email: string
  rol: RolUtilizator
  /** false = cont dezactivat, nu se poate autentifica. */
  activ: boolean
  ultima_autentificare: Timestamptz | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/**
 * Tabela `punct_lucru` — locațiile clinicii. Răspunde la „unde”.
 *
 * Clinica are O SINGURĂ locație, deci punctul de lucru NU apare nicăieri în
 * interfață: fără câmp în formulare, fără filtru, fără secțiune de nomenclator.
 * Tipul și coloana rămân, iar serverul completează tăcut punctul implicit.
 *
 * Rămân pentru că specificația tehnică §3 le prevede, iar backend-ul se scrie
 * după ea: scoaterea lor ar rupe contractul cu celălalt dezvoltator ca să
 * câștige o coloană. Dacă se deschide vreodată un al doilea punct, revenirea
 * înseamnă reafișarea selectorului, nu o migrare de bază de date.
 */
export interface PunctLucru {
  id: Uuid
  denumire: string
  adresa: string | null
  telefon: string | null
  /** Punctele închise se dezactivează, nu se șterg. */
  activ: boolean
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/** Tabela `articol` — nomenclator unic de servicii ȘI produse. Răspunde la „ce”. */
export interface Articol {
  id: Uuid
  tip: TipArticol
  denumire: string
  /** Obligatoriu > 0 la servicii, NULL la produse (articol_durata_ck). */
  durata_minute: number | null
  /** Preț de referință; prețul efectiv se copiază pe linia de vânzare. */
  pret_lista: number
  activ: boolean
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/** Tabela `client` — fișa de client. */
export interface Client {
  id: Uuid
  nume: string
  telefon: string | null
  email: string | null
  adresa: string | null
  data_nasterii: DateOnly | null
  /** NULL = activ; arhivarea este ștergere logică. */
  arhivat_la: Timestamptz | null
  creat_de: Uuid | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/**
 * Tabela `nota_client` — note libere pe fișa clientului.
 * Notele nu se modifică; corecțiile se adaugă ca notă nouă.
 */
export interface NotaClient {
  id: Uuid
  client_id: Uuid
  autor_id: Uuid | null
  text: string
  creat_la: Timestamptz
}

/**
 * Fișa clientului așa cum a fost TIPĂRITĂ în acord, nu cum arată azi.
 *
 * Se ia de pe ecran în clipa semnării și rămâne neatinsă. Dacă peste un an
 * clientul își schimbă telefonul, acordul semnat trebuie să spună în
 * continuare ce scria pe hârtia pe care a semnat-o.
 */
export interface DateSemnatar {
  nume: string
  telefon: string | null
  email: string | null
  adresa: string | null
}

/**
 * Tabela `consimtamant` — acordul GDPR semnat pe tabletă.
 *
 * Rândul nu se modifică NICIODATĂ: nu are `actualizat_la`, iar serverul nu
 * expune PATCH. O greșeală se îndreaptă printr-o semnătură nouă, iar amândouă
 * rămân în fișă.
 */
export interface Consimtamant {
  id: Uuid
  client_id: Uuid
  /** Ședința la care s-a semnat; NULL dacă programarea a fost ștearsă între timp. */
  programare_id: Uuid | null
  /** `VERSIUNE_ACORD` din textul semnat — fără ea nu s-ar ști ce a acceptat. */
  versiune: string
  marime: number
  /** SHA-256 al PDF-ului, calculat de server. Dovedește că fișierul e neatins. */
  amprenta: string
  date_semnatar: DateSemnatar
  /** Aparatul care a cules semnătura, ex. „signotec Sigma (S/N 1000444927)”. */
  dispozitiv: string | null
  semnat_la: Timestamptz
  creat_de: Uuid | null
}

/** Tabela `programare` — o programare în calendar. */
export interface Programare {
  id: Uuid
  client_id: Uuid
  articol_id: Uuid
  /** Fixat pe 'serviciu' prin CHECK — doar serviciile pot fi programate. */
  articol_tip: 'serviciu'
  executant_id: Uuid
  punct_lucru_id: Uuid
  incepe_la: Timestamptz
  /** CHECK (se_termina_la > incepe_la) */
  se_termina_la: Timestamptz
  stare: StareProgramare
  /**
   * Cât costă ȘEDINȚA ACEASTA — nu prețul din nomenclator.
   *
   * Se copiază la creare (ultimul preț al aceluiași client pentru același
   * serviciu, altfel `articol.pret_lista`) și rămâne apoi neatins: o scumpire
   * din nomenclator nu are voie să rescrie prețul unei ședințe deja convenite.
   * Editabil în formular — de acolo vine „prețul reținut” al clientului.
   */
  pret: number
  nota: string | null
  creat_de: Uuid | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/**
 * Tabela `notita` — o însemnare în calendar, care NU este o programare.
 *
 * „Irina e în concediu”, „vine furnizorul la 15:00”. Ocupă un loc în calendar,
 * dar nu are client, serviciu sau preț — toate obligatorii la `programare`.
 * Fără tabela asta, recepția ar fi inventat un client „Concediu” și un
 * serviciu de zero lei, iar lista de clienți, prețul reținut și `de_incasat`
 * s-ar fi umplut de ele.
 *
 * `executant_id` NULL = pentru toată clinica. Cu o persoană, notița stă în
 * coloana și în culoarea ei.
 *
 * Nu blochează intervalul (nu intră în `programare_fara_suprapunere`) și se
 * poate șterge — nu e o ședință care a avut loc și nu mișcă bani.
 */
export interface Notita {
  id: Uuid
  titlu: string
  detalii: string | null
  executant_id: Uuid | null
  incepe_la: Timestamptz
  /** CHECK (se_termina_la > incepe_la) */
  se_termina_la: Timestamptz
  creat_de: Uuid | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/** Tabela `vanzare` — antetul: cui, când, unde, de către cine. */
export interface Vanzare {
  id: Uuid
  client_id: Uuid
  punct_lucru_id: Uuid
  /** Cine a operat înregistrarea. */
  operator_id: Uuid
  /**
   * Legătură opțională cu programarea din care rezultă (§3, coloană existentă).
   *
   * Interfața NU o citește niciodată și o lasă `null`: încape o singură ședință
   * într-un antet, iar o plată stinge adesea mai multe. Adevărul despre „ce
   * ședințe a stins bonul acesta” stă exclusiv pe `vanzare_linie.programare_id`.
   * Rămâne aici doar ca să nu ceară o migrare de ștergere.
   */
  programare_id: Uuid | null
  /** Momentul real al vânzării, nu momentul introducerii. */
  efectuat_la: Timestamptz
  nota: string | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/** Tabela `vanzare_linie` — ce s-a vândut, în cadrul unei vânzări. */
export interface VanzareLinie {
  id: Uuid
  vanzare_id: Uuid
  articol_id: Uuid
  /** CHECK (cantitate > 0) */
  cantitate: number
  /** COPIAT la momentul vânzării — nu se citește din articol. */
  pret_unitar: number
  /** GENERATED ALWAYS AS round(cantitate * pret_unitar, 2) STORED. */
  total_linie: number
  /**
   * Programarea pe care o stinge această linie; NULL pentru produse.
   *
   * Aici, pe LINIE, nu pe antet: un client poate lăsa trei ședințe neachitate
   * și le plătește pe toate la sfârșit, cu o singură încasare. Cu legătura pe
   * antet (`vanzare.programare_id`) ar fi încăput o singură ședință, iar restul
   * ar fi rămas veșnic „de plată” sau ar fi cerut trei încasări separate.
   *
   * Ea este ȘI răspunsul la „s-a achitat?”: o programare este achitată dacă
   * există o linie care o indică. Nu există coloană `achitat` pe programare —
   * două locuri pentru același adevăr ajung mai devreme sau mai târziu să se
   * contrazică.
   */
  programare_id: Uuid | null
}

/** Tabela `jurnal_operatiuni` — append-only: fără UPDATE, fără DELETE. */
export interface JurnalOperatiune {
  /** bigserial — volum mare, secvențial. */
  id: number
  utilizator_id: Uuid | null
  actiune: ActiuneJurnal
  /** Numele tabelei afectate. */
  entitate: string
  entitate_id: Uuid | null
  date_vechi: Record<string, unknown> | null
  date_noi: Record<string, unknown> | null
  adresa_ip: string | null
  creat_la: Timestamptz
}

// ---------------------------------------------------------------------------
// Proiecții compuse returnate de API
//
// Serverul trimite entitatea „hidratată” acolo unde interfața ar face altfel
// N+1 cereri. Sufixul `_nume` / `_denumire` marchează un câmp derivat prin
// JOIN, care nu se scrie niciodată înapoi.
// ---------------------------------------------------------------------------

/** Rând din lista de clienți, cu numărul de programări/vânzări asociate. */
export interface ClientListItem extends Client {
  numar_programari: number
  numar_vanzari: number
  ultima_vizita: Timestamptz | null
  /**
   * Suma ședințelor onorate și neîncasate. 0 = nu datorează nimic.
   * Stă în listă ca recepția să vadă cine are de plătit fără să deschidă fișa.
   */
  de_incasat: number
}

/** Programare hidratată pentru calendar și agendă. */
export interface ProgramareDetaliu extends Programare {
  client_nume: string
  client_telefon: string | null
  articol_denumire: string
  articol_durata_minute: number | null
  executant_nume: string
  punct_lucru_denumire: string
  /**
   * DERIVAT: există o linie de vânzare care indică această programare.
   * Nu se scrie niciodată înapoi; se schimbă doar încasând.
   */
  achitat: boolean
  /** Încasarea care a stins-o, dacă a fost stinsă. */
  vanzare_id: Uuid | null
  /**
   * DERIVAT: `efectuat_la` al încasării care a stins-o. NULL cât timp nu e
   * achitată.
   *
   * Există ca ședința să-și spună singură toată povestea. Plata se face adesea
   * mai târziu — trei ședințe stinse cu o singură plată la final — iar fără
   * data asta fișa ar fi trebuit să arate și bonul, alături de ședință, ca să
   * se înțeleagă când au intrat banii. Aici, „Achitat” devine „Achitat pe 20
   * aug.” și bonul nu mai are ce căuta în cronologie.
   */
  achitat_la: Timestamptz | null
}

/**
 * Notiță hidratată. `executant_nume` rămâne NULL pentru notițele întregii
 * clinici — aici NULL are înțeles și nu se înlocuiește cu „—”.
 */
export interface NotitaDetaliu extends Notita {
  executant_nume: string | null
  creat_de_nume: string | null
}

/** Linie de vânzare hidratată cu denumirea articolului. */
export interface VanzareLinieDetaliu extends VanzareLinie {
  articol_denumire: string
  articol_tip: TipArticol
  /** Când a avut loc ședința stinsă de linie — NULL pentru produse. */
  programare_incepe_la: Timestamptz | null
}

/** Vânzare hidratată, cu liniile ei și totalul calculat. */
export interface VanzareDetaliu extends Vanzare {
  client_nume: string
  punct_lucru_denumire: string
  operator_nume: string
  linii: VanzareLinieDetaliu[]
  /** Suma liniilor; calculată de server, niciodată editabilă direct. */
  total: number
}

/** Notă hidratată cu numele autorului (autorul poate fi șters — SET NULL). */
export interface NotaClientDetaliu extends NotaClient {
  autor_nume: string | null
}

/**
 * Acord hidratat cu numele clientului și al celui care l-a cules.
 *
 * PDF-ul nu este aici și nu va fi niciodată: se ia separat, prin
 * `/consimtaminte/:id/document`. O fișă cu douăzeci de acorduri ar fi tras
 * câțiva megaocteți doar ca să deseneze douăzeci de rânduri de listă.
 */
export interface ConsimtamantDetaliu extends Consimtamant {
  client_nume: string
  creat_de_nume: string | null
}

/** Rând din jurnal, cu numele utilizatorului care a operat. */
export interface JurnalOperatiuneDetaliu extends JurnalOperatiune {
  utilizator_nume: string | null
}

/**
 * O intrare din istoricul clientului — GET /clienti/:id/istoric.
 * Uniune discriminată: programările și vânzările sosesc într-un singur flux
 * cronologic, deci interfața le poate randa cu o singură componentă.
 */
export type IstoricIntrare =
  | { fel: 'programare'; la: Timestamptz; programare: ProgramareDetaliu }
  | { fel: 'vanzare'; la: Timestamptz; vanzare: VanzareDetaliu }
