import {
  CalendarDays,
  Layers,
  Receipt,
  ScrollText,
  Tags,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react'

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
  },
  {
    cale: '/incasari',
    eticheta: 'Încasări',
    pictograma: Receipt,
    principal: true,
    descriere: 'Banii intrați: ședințe achitate și produse vândute',
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

/** Elementele vizibile pentru rolul dat. */
export function navigarePentru(esteAdministrator: boolean): ElementNavigare[] {
  return NAVIGARE.filter((element) => !element.doarAdministrator || esteAdministrator)
}
