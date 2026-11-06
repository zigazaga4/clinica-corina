import type { Utilizator } from '@/domain/types'

/**
 * Contul Andei: „Anda” în producție, „Andreea …” în datele demonstrative.
 * Clinica a cerut ca pagina ședințelor pe persoane să se deschidă pe ea
 * (6 nov. 2026: „aici trebuie Anda”, nu contul celui care privește).
 */
const CONTUL_ANDEI = /^(anda|andreea)\b/i

/**
 * Pe cine arată pagina ședințelor pe persoane la prima deschidere: Anda, dacă
 * are cont; altfel primul cont care nu e al celui care privește (el se vede
 * oricum la „Statistici”); în ultimă instanță chiar contul lui.
 */
export function persoanaImplicita(conturi: Utilizator[], eu: Utilizator): Utilizator | undefined {
  return (
    conturi.find((c) => CONTUL_ANDEI.test(c.nume.trim())) ??
    conturi.find((c) => c.id !== eu.id) ??
    conturi[0]
  )
}
