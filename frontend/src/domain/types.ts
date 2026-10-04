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
  /** Culoarea aleasă pentru calendar, #rrggbb. NULL = cea automată, din paletă. */
  culoare: string | null
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
  /**
   * Preț de referință; prețul efectiv se copiază pe linia de vânzare.
   * La un serviciu în mai multe ședințe este prețul ÎNTREGULUI tratament.
   */
  pret_lista: number
  activ: boolean
  creat_la: Timestamptz
  actualizat_la: Timestamptz
  /**
   * În câte ședințe se face serviciul (articol_sedinte_ck: >= 1; produsele 1).
   * Peste 1, fiecare programare a lui intră într-un `Tratament` și primește
   * o parte din `pret_lista`.
   */
  numar_sedinte: number
  /**
   * Lista de prețuri a produsului — „Produse clienți”, „Produse colaboratori”.
   * Aceeași cremă poate sta pe amândouă, ca două rânduri cu prețuri diferite.
   * Text liber; NULL = fără categorie. Serviciile n-au (articol_categorie_ck).
   */
  categorie: string | null
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
 * Se pot modifica (2026-10-01); textul vechi rămâne în jurnal.
 */
export interface NotaClient {
  id: Uuid
  client_id: Uuid
  autor_id: Uuid | null
  text: string
  creat_la: Timestamptz
  /** Ultima modificare a textului; NULL = nemodificată. */
  modificat_la: Timestamptz | null
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
  /** Tratamentul din care face parte ședința; NULL la serviciile dintr-o venire. */
  tratament_id: Uuid | null
  /**
   * Programarea din calendar din care face parte rândul.
   *
   * Un rând `programare` este UN serviciu. Clienta care vine la 10:00 pentru o
   * manichiură și ședința 3 din 6 de IPL are o singură programare în calendar
   * și două rânduri cu același `vizita_id` — fiecare cu prețul, tratamentul și
   * plata lui. Rândurile aceleiași vizite au același client, aceeași persoană,
   * același interval, aceeași stare și aceeași notă; serverul le schimbă
   * împreună. O programare cu un singur serviciu are o vizită a ei.
   */
  vizita_id: Uuid
}

/**
 * Tabela `tratament` — un serviciu făcut în mai multe ședințe, pentru un client.
 *
 * „Epilare IPL axile, 6 ședințe”: serviciul se cumpără o dată și se face în
 * mai multe veniri, fiecare o `Programare` obișnuită legată prin
 * `tratament_id`. Rândul ține DOAR ce s-a convenit la început — câte ședințe
 * și cât în total. Câte s-au făcut, cât s-a încasat, cât mai e de programat
 * se NUMĂRĂ din ședințe (`TratamentDetaliu`); nu există contoare ținute de
 * mână, care ar ajunge să se contrazică cu ședințele pe care le rezumă.
 *
 * Banii nu stau aici. `pret_total` se împarte pe ședințe la crearea fiecăreia
 * — restul neplanificat, la ședințele rămase — și devine `Programare.pret`,
 * de unde urmează drumul obișnuit: onorat → achitat → linie de vânzare.
 * Recepția corectează suma la fiecare ședință, iar următoarele își refac
 * partea din ce a rămas.
 *
 * `incheiat_la` se pune singur la onorarea ultimei ședințe sau de mână, când
 * clientul renunță. Un client are cel mult un tratament ÎN CURS pentru același
 * serviciu: o programare nouă la acel serviciu intră în el, nu deschide altul.
 */
export interface Tratament {
  id: Uuid
  client_id: Uuid
  articol_id: Uuid
  /** Fixat pe 'serviciu' prin CHECK, ca la programare. */
  articol_tip: 'serviciu'
  /** CHECK (numar_sedinte >= 1). Copiat din nomenclator, editabil aici. */
  numar_sedinte: number
  /** CHECK (pret_total >= 0). Prețul întregului tratament, convenit cu clientul. */
  pret_total: number
  nota: string | null
  /** NULL = în curs. */
  incheiat_la: Timestamptz | null
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
  /**
   * Când a plătit clientul. NULL = NEACHITATĂ: produsele au plecat acum, banii
   * vin mai târziu. Doar vânzările de produse pot rămâne așa; una care stinge
   * ședințe este chiar plata lor (serverul refuză altfel).
   */
  achitat_la: Timestamptz | null
  /**
   * Cum s-a plătit: numerar sau card. NULL pe o vânzare neachitată (încă
   * neplătită) și pe încasările de dinainte de alegere (2026-10-01).
   */
  metoda_plata: MetodaPlata | null
}

/**
 * În ce zile ale lunii lucrează o persoană: după numărul zilei (2, 4… /
 * 1, 3…), sau alese una câte una ('personalizat', în `zile_alese`).
 */
export type ZileLucru = 'pare' | 'impare' | 'personalizat'

/**
 * Tabela `program_lucru` — programul unei persoane într-o lună (cerința
 * clinicii, 2026-10-01). Lipsa rândului = fără program ales, nimic de marcat.
 */
export interface ProgramLucru {
  id: Uuid
  utilizator_id: Uuid
  utilizator_nume: string
  /** Ziua 1 a lunii. */
  luna: DateOnly
  zile: ZileLucru
  /** Doar la 'personalizat': numerele zilelor lucrate (goală = luna liberă). */
  zile_alese: number[] | null
  creat_de: Uuid | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
}

/** Coloana `vanzare.metoda_plata` — ce alege recepția la fiecare încasare. */
export type MetodaPlata = 'numerar' | 'card'

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

/**
 * Tabela `cheltuiala` — banii ieșiți: chirie, salarii, consumabile, marfă.
 *
 * Jumătatea profitului pe care nu o spune nicio altă tabelă. `data` este ziua
 * plății, fără oră; `categorie` este text liber, iar serverul o lipește de una
 * existentă care diferă doar prin majuscule. Se poate șterge — urma rămâne în
 * jurnal.
 */
export interface Cheltuiala {
  id: Uuid
  data: DateOnly
  categorie: string
  descriere: string | null
  /** CHECK (suma > 0) */
  suma: number
  creat_de: Uuid | null
  creat_la: Timestamptz
  actualizat_la: Timestamptz
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
   * Suma ședințelor onorate și neîncasate, plus produsele vândute neachitate.
   * 0 = nu datorează nimic. Stă în listă ca recepția să vadă cine are de
   * plătit fără să deschidă fișa.
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
  /** Câte ședințe are tratamentul din care face parte; NULL în afara unuia. */
  tratament_numar_sedinte: number | null
  /**
   * DERIVAT: a câta ședință a tratamentului este aceasta — „ședința 3 din 8”.
   * Se numără doar ședințele programate sau onorate; una anulată sau
   * neprezentată nu ocupă un loc și are NULL aici.
   */
  sedinta_nr: number | null
}

/**
 * Tratamentul cu tot ce se numără din ședințele lui — `v_tratament_detaliu`.
 *
 * Niciun câmp de mai jos nu este coloană: se numără la fiecare citire, din
 * programările cu `tratament_id`. Contează doar ședințele programate sau
 * onorate; cele anulate și neprezentările nu ocupă un loc și nu iau bani.
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
  /** Ședințe onorate și încasate. */
  incasat: number
  /** Ședințe onorate și neîncasate — restanța tratamentului. */
  de_incasat: number
  /**
   * Partea propusă ședinței următoare: `(pret_total - alocat) / sedinte_ramase`,
   * niciodată sub zero. 0 când nu mai e nimic de programat.
   */
  pret_urmatoarea: number
  /** Prima ședință programată (cea mai apropiată); NULL dacă nu e niciuna. */
  urmatoarea_la: Timestamptz | null
  /** Ultima ședință onorată. */
  ultima_la: Timestamptz | null
  /** Cine face tratamentul: numele de pe ședințele neanulate, „Anda, Irina”. */
  executanti: string | null
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
  /** DERIVAT: `achitat_la !== null`. Se schimbă prin `update(id, { achitat })`. */
  achitat: boolean
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

/** `v_cheltuiala_detaliu` — cheltuiala, cu cine a scris-o (NULL dacă i s-a șters contul). */
export interface CheltuialaDetaliu extends Cheltuiala {
  creat_de_nume: string | null
}

// ---------------------------------------------------------------------------
// Statistici — GET /statistici
//
// Totul de aici se CALCULEAZĂ la cerere; nimic nu e coloană. Ce înseamnă
// fiecare cifră stă scris o singură dată, pe server, în
// `backend/src/lib/raport-statistici.ts`, iar implementarea din memorie
// (`@/api/memory/statistici.ts`) o repetă întocmai.
// ---------------------------------------------------------------------------

/** Cât cuprinde o bară din graficul în timp. */
export const PAS_STATISTICI = ['zi', 'saptamana', 'luna'] as const
export type PasStatistici = (typeof PAS_STATISTICI)[number]

/** Cifrele unei perioade — rândul de sus al Statisticilor. */
export interface TotaluriStatistici {
  /** Banii intrați: liniile vânzărilor achitate în perioadă, după ziua plății. */
  incasat: number
  /** Din `incasat`: cât au adus serviciile (ședințele)… */
  incasat_servicii: number
  /** …și cât produsele. */
  incasat_produse: number
  /** Din `incasat`, după cum s-a plătit: numerar… */
  incasat_numerar: number
  /** …card… */
  incasat_card: number
  /** …sau nespecificat — încasările de dinainte de alegere. */
  incasat_nespecificat: number
  /** Câte încasări (bonuri) s-au achitat. */
  incasari: number
  /** Cheltuielile cu `data` în perioadă. */
  cheltuieli: number
  /** `incasat − cheltuieli`. Negativ = pierdere. */
  profit: number
  /**
   * Ce s-a lucrat în perioadă și nu s-a plătit încă: ședințe onorate fără
   * încasare și produse date pe datorie.
   */
  neachitat: number
  /** Programările din calendar după stare — o programare cu trei servicii este UNA. */
  programari_onorate: number
  programari_neprezentate: number
  programari_anulate: number
  programari_programate: number
  /** Clienți diferiți serviți: cu o programare onorată sau o cumpărătură. */
  clienti: number
  /** Fișe deschise în perioadă. */
  clienti_noi: number
}

/** O bară din graficul în timp. */
export interface PerioadaStatistici {
  /** Prima zi a barei: ziua, lunea săptămânii sau data de 1 a lunii. */
  inceput: DateOnly
  incasat_servicii: number
  incasat_produse: number
  cheltuieli: number
}

/** Un serviciu sau un produs, după banii aduși în perioadă. */
export interface StatisticaArticol {
  articol_id: Uuid
  denumire: string
  /** A produsului: aceeași cremă poate fi vândută din două liste de prețuri. */
  categorie: string | null
  /** Ședințe încasate (servicii) sau bucăți vândute (produse). */
  cantitate: number
  suma: number
}

/** O persoană din clinică: ce a lucrat și ce s-a încasat din serviciile ei. */
export interface StatisticaPersoana {
  utilizator_id: Uuid
  nume: string
  /** Programări onorate în perioadă, după ziua lor. */
  programari_onorate: number
  /** Încasat din serviciile ei, după ziua plății. Produsele nu au executant. */
  incasat: number
}

export interface StatisticaCategorie {
  categorie: string
  suma: number
  /** Câte cheltuieli are categoria în perioadă. */
  numar: number
}

export interface StatisticaClient {
  client_id: Uuid
  nume: string
  incasat: number
  /** Câte încasări (bonuri). */
  incasari: number
}

export interface RaportStatistici {
  de_la: DateOnly
  pana_la: DateOnly
  pas: PasStatistici
  total: TotaluriStatistici
  /** Aceleași cifre pe perioada cu care se compară; null dacă nu s-a cerut una. */
  comparatie: TotaluriStatistici | null
  /** Barele graficului în timp, TOATE — și cele fără nimic. */
  perioade: PerioadaStatistici[]
  servicii: StatisticaArticol[]
  produse: StatisticaArticol[]
  persoane: StatisticaPersoana[]
  cheltuieli: StatisticaCategorie[]
  /** Programările onorate pe zilele săptămânii: luni = 1 … duminică = 7, toate șapte. */
  zile_saptamana: { zi: number; programari: number }[]
  /** Cei zece clienți care au adus cei mai mulți bani în perioadă. */
  clienti: StatisticaClient[]
}

/**
 * O intrare din istoricul clientului — GET /clienti/:id/istoric.
 * Uniune discriminată: programările și vânzările sosesc într-un singur flux
 * cronologic, deci interfața le poate randa cu o singură componentă.
 */
export type IstoricIntrare =
  | { fel: 'programare'; la: Timestamptz; programare: ProgramareDetaliu }
  | { fel: 'vanzare'; la: Timestamptz; vanzare: VanzareDetaliu }
