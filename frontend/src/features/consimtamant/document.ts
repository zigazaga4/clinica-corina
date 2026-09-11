/**
 * Textul acordului GDPR, exact cum îl folosește clinica.
 *
 * Este transcris CUVÂNT CU CUVÂNT după documentul primit, inclusiv lipsa
 * diacriticelor și spațiile rămase libere. Nu este locul unde se corectează
 * exprimarea: hârtia aceasta a fost scrisă de un jurist, iar o „îndreptare”
 * făcută de programator schimbă un act juridic fără ca nimeni să știe.
 *
 * De aici citesc AMÂNDOUĂ: și previzualizarea de pe ecran, și PDF-ul care se
 * semnează. Un singur izvor, fiindcă altfel s-ar putea ajunge — pe nesimțite,
 * după o modificare făcută într-un singur loc — ca omul să citească un text și
 * să semneze altul.
 *
 * ORICE schimbare de conținut cere o VERSIUNE NOUĂ mai jos. Versiunea se scrie
 * în fiecare acord semnat; fără ea nu s-ar mai putea spune, peste doi ani, ce
 * anume a acceptat cineva care a semnat astăzi.
 */

/** Se schimbă la orice modificare a textului. Rămâne scrisă în fiecare acord. */
export const VERSIUNE_ACORD = 'gdpr-2026-09'

/** Denumirea sub care semnează clinica. */
export const OPERATOR = 'EVO CREAM PREMIUM S.R.L.'

/**
 * Un rând din document.
 *
 * Textul este ținut ca date, nu ca HTML și nici ca șir gata desenat, tocmai ca
 * să poată fi randat în două feluri fără să se rescrie: pe ecran cu etichete
 * HTML, în PDF cu linii trase de `pdf-lib`.
 */
export type BlocAcord =
  | { fel: 'operator'; text: string }
  | { fel: 'titlu'; text: string }
  | { fel: 'paragraf'; text: string }
  | { fel: 'numerotat'; numar: number; text: string }
  | { fel: 'punct'; text: string }
  | { fel: 'campuri'; etichete: readonly string[] }
  | { fel: 'nota'; text: string }
  | { fel: 'semnatura'; data: string }

/** Datele care se toarnă în document la semnare. */
export interface DateAcord {
  nume: string
  /** Ziua semnării, `zz.ll.aaaa`. */
  data: string
}

/** `11.09.2026` — forma din document, nu cea din bază. */
export function ziRomaneasca(moment: Date): string {
  const doua = (n: number) => String(n).padStart(2, '0')
  return `${doua(moment.getDate())}.${doua(moment.getMonth() + 1)}.${moment.getFullYear()}`
}

/**
 * Drepturile enumerate la punctul 5, fiecare cu bulina lui.
 *
 * Ținute separat doar ca lista numerotată de mai jos să rămână citibilă.
 */
const DREPTURI: readonly string[] = [
  'Dreptul de acces la date, respectiv dreptul de a obtine din partea operatorului o confirmare ca se prelucreaza sau nu date cu caracter personal care ma privesc si, in caz afirmativ, acces la datele respective si la informatiile prevazute de lege;',
  'Dreptul de rectificare a datelor, respectiv dreptul de a obtine de la operator, fara intarzieri nejustificate, rectificarea datelor cu caracter personal inexacte care ma privesc;',
  'Dreptul la stergerea datelor, respectiv dreptul de a obtine din partea operatorului stergerea datelor cu caracter personal care ma privesc, fara intarzieri nejustificate, in conditiile anume prevazute de lege;',
  'Dreptul la restrictionarea prelucrarii, respectiv dreptul de a obtine din partea operatorului restrictionarea prelucrarii in cazurile anume prevazute de lege;',
  'Dreptul la portabilitatea datelor, respectiv dreptul de a primi datele cu caracter personal care ma privesc si pe care le-am furnizat operatorului intr-un format structurat, utilizat in mod curent si care poate fi citit automat si dreptul de a transmite aceste date altui operator;',
  'Dreptul de opozitie, respectiv dreptul de a ma opune in orice moment, din motive legate de situatia mea particulara, ca datele care ma vizeaza sa faca obiectul unei prelucrari sau al unei crearii de profiluri, potrivit legii.',
  'Dreptul de a retrage consimtamantul, in orice moment, pentru oricare din scopurile sus-mentionate, fara a afecta legalitatea prelucrarii efectuate pe baza consimtamantului inainte de retragerea acestuia.',
  'Dreptul de a fi notificat de operator in caz de incalcari privind securitatea datelor.',
]

/**
 * Documentul întreg, cu numele clientului și data turnate înăuntru.
 *
 * Numele intră în fraza „Subsemnatul …”, exact acolo unde se scria de mână.
 * Restul spațiilor libere — adresa cabinetului, e-mailul, telefonul, datele
 * reprezentantului legal — rămân goale, ca pe hârtia de acum.
 */
export function construiesteAcord(date: DateAcord): BlocAcord[] {
  return [
    { fel: 'operator', text: `Denumire cabinet ${OPERATOR}` },
    { fel: 'titlu', text: 'ACORD PRIVIND PRELUCRAREA DATELOR CU CARACTER PERSONAL' },

    {
      fel: 'paragraf',
      text:
        `Subsemnatul ${date.nume} sunt de acord ca ${OPERATOR} in calitate de prestator de ` +
        'servicii medicale, sa prelucreze datele mele cu caracter personal precum: nume, prenume, ' +
        'adresa postala, numar de telefon, adresa de e-mail, cod numeric personal, date privind ' +
        'sanatatea, precum si alte categorii speciale de date personale, in functie de serviciul ' +
        'efectiv prestat, precum date genetice, date biometrice pentru identificarea unica a unei ' +
        'persoane fizice, semnatura biometrica in scopul semnarii de documente diverse in relatia ' +
        'dintre operator si persoana vizata, in vederea prestarii in beneficiul subsemnatului a ' +
        'serviciilor medicale solicitate, prin modalitatile prevazute de legislatia aplicabila, ' +
        'respectiv servicii de asistenta medicala de orice fel - preventiva, profilactica si ' +
        'curativa, de recuperare, de urgenta, de hemotransfuziologie, transfuzie sanguina sau alte ' +
        'servicii de asistenta medicala si prestatii autorizate, astfel cum vor fi solicitate de ' +
        'subsemnatul.',
    },

    { fel: 'paragraf', text: '*Prin reprezenantul legal/ gardian legal:' },
    { fel: 'campuri', etichete: ['Name', 'Prenume', 'Adresa', 'Adresa e-mail', 'Telefon'] },
    {
      fel: 'nota',
      text: '* Sa va completa in cazul in care persoana este minora sau nu are dreptul sa semneze.',
    },

    { fel: 'paragraf', text: 'Am fost informat cu privire la urmatoarele:' },

    {
      fel: 'numerotat',
      numar: 1,
      text:
        'Am fost informat cu privire la faptul ca operatorul prelucreaza datele cu caracter ' +
        'personal in conformitate cu prevederile legale in materie de prelucrare a datelor cu ' +
        'caracter personal, in scopurile aratate mai sus si ca prelucrarea se realizeaza intr-o ' +
        'maniera care asigura confidentialitatea si securitatea datelor prin masuri tehnice si ' +
        'organizatorice adecvate luate de operator.',
    },
    {
      fel: 'numerotat',
      numar: 2,
      text:
        'Am fost informat si inteleg ca prelucrarea datelor cu caracter personal sus-mentionate se ' +
        'realizeaza in scopul prestarii in beneficiul subsemnatului a serviciilor medicale.',
    },
    {
      fel: 'numerotat',
      numar: 3,
      text:
        'Am fost informat si inteleg ca prelucrarea datelor cu caracter personal se va realiza atat ' +
        'timp cat este necesar pentru scopurile mentionate mai sus sau pe perioada de timp ' +
        'prevazuta de dispozitiile legale aplicabile.',
    },
    {
      fel: 'numerotat',
      numar: 4,
      text:
        'Am fost informat si inteleg ca datele personale ar putea fi transferate catre companii din ' +
        'grup, catre societati ce ar putea presta servicii in legatura cu scopurile prelucrarii sau ' +
        'catre autoritati in virtutea unor obligatii legale, transferul urmand a fi facut in ' +
        'conformitate cu prevederile legale aplicabile. Am fost informat ca operatorul nu ' +
        'intentioneaza sa transfere datele personale in tari aflate in afara Spatiului Economic ' +
        'European.',
    },
    {
      fel: 'numerotat',
      numar: 5,
      text:
        'Am fost informat si inteleg ca imi pot exercita toate drepturile prevazute de Regulamentul ' +
        'UE 2016/679, astfel:',
    },
    ...DREPTURI.map((text) => ({ fel: 'punct' as const, text })),

    {
      fel: 'paragraf',
      text:
        'Aceste drepturi pot fi exercitate prin transmiterea unei cereri, intocmita in forma scrisa, ' +
        'datata si semnata, care va cuprinde solicitarile formulate si motivele acestora, catre ' +
        `${OPERATOR} la adresa: loc. Mircea Voda, str. , nr. , bl. , sc. , ap. , jud. CONSTANTA. ` +
        'Compania poate fi contactata pentru orice informatii in legatura cu prelucrarea datelor ' +
        'personale la adresa de email  sau telefonic',
    },

    {
      fel: 'numerotat',
      numar: 6,
      text:
        'De asemenea, am fost informat ca am dreptul de a ma adresa Autoritatii Nationale de ' +
        'Supraveghere a Prelucrarii Datelor cu Caracter Personal sau justitiei, pentru apararea ' +
        'oricaror drepturi garantate de Regulamentul UE 2016/679, care mi-au fost incalcate.',
    },
    {
      fel: 'numerotat',
      numar: 7,
      text:
        'Daca datele cu caracter personal furnizate sunt incorecte sau vor suferi modificari ma ' +
        'oblig sa informez in scris compania in timp util.',
    },

    { fel: 'semnatura', data: date.data },
  ]
}
