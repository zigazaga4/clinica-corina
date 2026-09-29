/**
 * Reperele grilei de calendar.
 *
 * Ziua afișată începe la 8:00 și se termină la 20:00 — programul unei clinici,
 * nu 24 de ore. O grilă de la miezul nopții ar irosi două treimi din înălțimea
 * ecranului pe ore în care nu se lucrează niciodată, iar programările s-ar
 * înghesui într-o bandă subțire la mijloc.
 *
 * Programările care ies din interval (o ședință prelungită după 20:00) nu se
 * pierd: sunt decupate la marginea grilei, iar lista de agendă le arată
 * oricum integral.
 */

export const ORA_INCEPUT = 8
export const ORA_SFARSIT = 20

/** Înălțimea unei ore. 56px lasă loc pentru două rânduri de text la 30 min. */
export const PIXELI_PE_ORA = 56

export const MINUTE_VIZIBILE = (ORA_SFARSIT - ORA_INCEPUT) * 60
export const INALTIME_GRILA = (ORA_SFARSIT - ORA_INCEPUT) * PIXELI_PE_ORA

/** Orele afișate pe coloana din stânga. */
export const ORE = Array.from({ length: ORA_SFARSIT - ORA_INCEPUT + 1 }, (_, i) => ORA_INCEPUT + i)

/**
 * Poziția verticală a unui moment, în pixeli de la vârful grilei.
 * Valorile din afara intervalului se decupează la capete.
 */
export function pozitieVerticala(moment: Date): number {
  const minute = moment.getHours() * 60 + moment.getMinutes() - ORA_INCEPUT * 60
  return Math.max(0, Math.min(MINUTE_VIZIBILE, minute)) * (PIXELI_PE_ORA / 60)
}

/** Înălțimea unei programări; minimum 20px, altfel textul devine ilizibil. */
export function inaltimeInterval(inceput: Date, sfarsit: Date): number {
  return Math.max(20, pozitieVerticala(sfarsit) - pozitieVerticala(inceput))
}

/** Pasul în care se alege ora direct pe grilă: sfertul, ca în lista de ore a formularului. */
export const PAS_MINUTE = 15

/**
 * Inversul lui `pozitieVerticala`: sfertul de oră în care cade un punct al
 * grilei, în minute de la începutul ei. Rotunjit în JOS — sfertul pe care stă
 * cursorul, nu cel mai apropiat — și ținut în grilă, ca ultimul sfert să
 * înceapă cel târziu cu un pas înainte de închidere.
 */
export function minutLaPozitie(pixeli: number): number {
  const sfert = Math.floor((pixeli / PIXELI_PE_ORA) * 60 / PAS_MINUTE) * PAS_MINUTE
  return Math.max(0, Math.min(MINUTE_VIZIBILE - PAS_MINUTE, sfert))
}

/** Momentul aflat la `minute` de la începutul grilei, în ziua dată. */
export function momentInZi(zi: Date, minute: number): Date {
  const moment = new Date(zi)
  // `setHours` duce singur minutele peste 59 în orele următoare.
  moment.setHours(ORA_INCEPUT, minute, 0, 0)
  return moment
}
