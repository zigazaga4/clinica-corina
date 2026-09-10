import {
  etichetaActiuneJurnal,
  etichetaRol,
  etichetaStareProgramare,
  etichetaTipArticol,
  tonActiuneJurnal,
  tonStareProgramare,
  tonTipArticol,
} from '@/domain/labels'
import type {
  ActiuneJurnal,
  RolUtilizator,
  StareProgramare,
  TipArticol,
} from '@/domain/types'
import { Badge } from '@/ui'

/**
 * Însemnele valorilor de domeniu.
 *
 * Sunt învelișuri subțiri peste `Badge`, dar rostul lor este să lege valoarea
 * din bază de eticheta și culoarea ei într-un singur loc. O programare
 * „neprezentat” arată identic în calendar, în agenda zilei, în istoricul
 * clientului și în lista de vânzări, fără ca vreunul dintre ecrane să repete
 * maparea — și fără riscul ca unul dintre ele să rămână în urmă când se
 * schimbă o culoare.
 */

export function InsemnStareProgramare({ stare }: { stare: StareProgramare }) {
  return (
    <Badge ton={tonStareProgramare[stare]} cuPunct>
      {etichetaStareProgramare[stare]}
    </Badge>
  )
}

export function InsemnTipArticol({ tip }: { tip: TipArticol }) {
  return <Badge ton={tonTipArticol[tip]}>{etichetaTipArticol[tip]}</Badge>
}

export function InsemnRol({ rol }: { rol: RolUtilizator }) {
  return (
    <Badge ton={rol === 'administrator' ? 'primary' : 'neutral'}>{etichetaRol[rol]}</Badge>
  )
}

export function InsemnActiuneJurnal({ actiune }: { actiune: ActiuneJurnal }) {
  return <Badge ton={tonActiuneJurnal[actiune]}>{etichetaActiuneJurnal[actiune]}</Badge>
}

/** Contul dezactivat / clientul arhivat. */
export function InsemnInactiv({ text = 'Inactiv' }: { text?: string }) {
  return <Badge ton="neutral">{text}</Badge>
}

/**
 * Starea plății unei ședințe onorate.
 *
 * „De plată” este cazul care trebuie să sară în ochi — clientul a plecat fără
 * să achite — de aceea poartă tonul de avertizare, nu unul neutru. Însemnul se
 * arată DOAR la ședințele onorate: una programată pentru joia viitoare nu este
 * „de plată”, este pur și simplu neîntâmplată încă.
 */
export function InsemnPlata({ achitat }: { achitat: boolean }) {
  return achitat ? (
    <Badge ton="success">Achitat</Badge>
  ) : (
    <Badge ton="warning" cuPunct>
      De plată
    </Badge>
  )
}
