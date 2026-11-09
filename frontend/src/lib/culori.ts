/**
 * Culori: ce text se citește pe o culoare dată.
 *
 * Calendarul colorează programarea plin, ca softul vechi al clinicii (roz, mov,
 * portocaliu pe fundal întreg, cu text deasupra). O culoare aleasă liber poate
 * fi închisă sau deschisă — galbenul cu text alb nu se citește, albastrul cu
 * text negru la fel —, așa că textul se alege după culoare, nu o dată pentru toate.
 */

const ALB = '#ffffff'
const CERNEALA = '#111827'

/** `#rrggbb` -> [r, g, b] în 0–255; null dacă nu e o culoare validă. */
function canale(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return null
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
}

/** Luminanța relativă WCAG: 0 (negru) … 1 (alb). */
export function luminanta(hex: string): number {
  const c = canale(hex)
  if (!c) return 0
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Raportul de contrast WCAG dintre două culori: 1 (la fel) … 21 (alb pe negru). */
export function contrast(a: string, b: string): number {
  const [clar, inchis] = [luminanta(a), luminanta(b)].sort((x, y) => y - x) as [number, number]
  return (clar + 0.05) / (inchis + 0.05)
}

/**
 * Cât contrast cu albul ajunge ca textul alb să rămână alb. Sub 4,5 (pragul
 * pentru text mic), dar peste 3 (pragul pentru text îngroșat): chipurile au
 * text semi-îngroșat, iar albastrul și roșul obișnuite cad chiar între cele
 * două — cu cerneală ar arăta ciudat, fiindcă toată lumea așteaptă alb pe ele.
 */
const CONTRAST_MINIM_PE_ALB = 3.5

/**
 * Textul care se citește pe `fundal`: alb când culoarea e destul de închisă,
 * altfel cerneală închisă (galben, verde deschis, turcoaz).
 */
export function textPeCuloare(fundal: string): string {
  return contrast(fundal, ALB) >= CONTRAST_MINIM_PE_ALB ? ALB : CERNEALA
}
