import {
  CalendarDays,
  ChartColumnBig,
  ChartLine,
  Layers,
  ScrollText,
  Tags,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { functii, type Functii } from '@/config/functii'

/**
 * Navigația, definită o singură dată.
 *
 * Bara laterală de pe desktop și bara de jos de pe telefon citesc din aceeași
 * listă. Dacă ar fi două liste, ar ajunge inevitabil să difere — un ecran nou
 * adăugat într-una și uitat în cealaltă.
 */

export interface ElementNavigare {
  cale: string
  eticheta: string
  /** Text mai scurt pentru bara de jos, unde lățimea este de ~80px. */
  etichetaScurta?: string
  pictograma: LucideIcon
  /** Rutele marcate „administrator” în §7 din specificație. */
  doarAdministrator?: boolean
  /** Apare în bara de jos de pe telefon; restul intră în meniul „Mai mult”. */
  principal?: boolean
  descriere: string
  /**
   * Ecranul există doar cât timp comutatorul din `@/config/functii` e pornit:
   * fork-ul simplu nu arată banii și abonamentele.
   */
  functie?: keyof Functii
}

export const NAVIGARE: ElementNavigare[] = [
  {
    cale: '/programari',
    eticheta: 'Programări',
    pictograma: CalendarDays,
    principal: true,
    descriere: 'Calendarul și agenda zilei',
  },
  {
    cale: '/clienti',
    eticheta: 'Clienți',
    pictograma: Users,
    principal: true,
    descriere: 'Fișele de client, note și istoric',
  },
  {
    cale: '/tratamente',
    eticheta: 'Tratamente',
    pictograma: Layers,
    descriere: 'Serviciile în mai multe ședințe: unde a ajuns fiecare client',
    functie: 'tratamente',
  },
  /*
    În locul fostului ecran „Încasări”, pe același loc: lista încasărilor a
    devenit o filă a Statisticilor, în spatele parolei lor. Vizibil pentru
    toate rolurile — parola, nu rolul, hotărăște cine vede cifrele.
  */
  {
    cale: '/statistici',
    eticheta: 'Statistici',
    pictograma: ChartColumnBig,
    principal: true,
    descriere: 'Încasări, cheltuieli și profit — cu parola statisticilor',
    functie: 'costuri',
  },
  /*
    Ședințele făcute de fiecare persoană și banii intrați pe ele, cu parola
    statisticilor, deschise pe Anda (cerința clinicii, 3 și 6 nov. 2026). Nu mai
    e „ale mele”: proprietara a deschis „Statisticile mele” și a găsit cifrele
    ei, nu pe ale Andei.
  */
  {
    cale: '/sedinte-pe-persoane',
    eticheta: 'Ședințe pe persoane',
    pictograma: ChartLine,
    descriere: 'Ședințele făcute de Anda și de ceilalți, și banii intrați pe ele — cu parola statisticilor',
    functie: 'costuri',
  },
  {
    cale: '/nomenclator',
    eticheta: 'Nomenclator',
    etichetaScurta: 'Servicii',
    pictograma: Tags,
    descriere: 'Serviciile și produsele din ofertă',
  },
  {
    cale: '/utilizatori',
    eticheta: 'Utilizatori',
    pictograma: UserCog,
    doarAdministrator: true,
    descriere: 'Conturile personalului și rolurile',
  },
  {
    cale: '/jurnal',
    eticheta: 'Jurnal',
    pictograma: ScrollText,
    doarAdministrator: true,
    descriere: 'Operațiunile efectuate asupra datelor',
  },
]

/**
 * Calea curentă este a elementului? Pe SEGMENTE, nu pe prefix de text:
 * „/statistici-vechi” ar începe cu „/statistici”, dar nu ar fi în ea.
 */
export function esteInElement(pathname: string, element: Pick<ElementNavigare, 'cale'>): boolean {
  return pathname === element.cale || pathname.startsWith(`${element.cale}/`)
}

/** Elementele vizibile pentru rolul dat, cu comutatoarele din `@/config/functii` pornite. */
export function navigarePentru(esteAdministrator: boolean): ElementNavigare[] {
  return NAVIGARE.filter(
    (element) =>
      (!element.doarAdministrator || esteAdministrator) && (!element.functie || functii[element.functie]),
  )
}
