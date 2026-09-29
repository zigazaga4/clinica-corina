import type { Uuid } from '@/domain/types'
import { isToday } from '@/lib/dates'
import { proximulSfertDeOra } from './CampuriInterval'
import { momentInZi } from './constante'

/**
 * Locul ales direct în calendar, cu care se deschide „Programare nouă”.
 *
 * Recepția se uită la calendar, vede golul și apasă pe el — formularul trebuie
 * să pornească de acolo, nu de la „acum”. Tot ce se știe din locul apăsat vine
 * gata completat: ziua, ora, sfârșitul (dacă s-a tras un interval), persoana
 * coloanei și clientul după care e filtrat calendarul. Restul se alege în
 * formular, ca de obicei.
 */
export interface LocAles {
  inceput: Date
  /**
   * Sfârșitul tras cu mouse-ul. `null` = s-a apăsat doar, iar durata o dă
   * serviciul ales (sau ora implicită, până se alege unul).
   */
  sfarsit: Date | null
  /** Persoana coloanei (vederea pe zi) sau a filtrului; `null` = cine programează. */
  executantId: Uuid | null
  /** Clientul după care e filtrat calendarul, dacă e unul. */
  clientId: Uuid | null
}

/**
 * Ora propusă când s-a ales doar ziua (vederea pe lună, agenda de pe telefon):
 * azi, următorul sfert de oră; în altă zi, deschiderea clinicii.
 */
export function inceputPeZi(zi: Date): Date {
  return isToday(zi) ? proximulSfertDeOra() : momentInZi(zi, 0)
}
