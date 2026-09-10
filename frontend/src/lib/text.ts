/**
 * Normalizarea textului pentru căutare.
 *
 * Baza de date caută cu `gin_trgm_ops` pe `nume`. Aici reproducem partea care
 * contează pentru utilizator: „Ionescu” trebuie găsit scriind „ionescu”, iar
 * „Călin” trebuie găsit scriind „calin”. Recepția nu tastează diacritice când
 * clientul așteaptă la ghișeu, iar o căutare care nu întoarce nimic din cauza
 * unui „ă” este o căutare stricată.
 */

/** Litere mici, fără diacritice, fără spații de prisos. */
export function normalizeaza(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // ș/ț cu virgulă dedesubt nu se descompun în toate fonturile/versiunile.
    .replace(/[şŞșȘ]/g, 's')
    .replace(/[ţŢțȚ]/g, 't')
    .toLowerCase()
    .trim()
}

/** Conține `text` fragmentul căutat, ignorând diacriticele și registrul? */
export function contine(text: string | null | undefined, cautare: string): boolean {
  if (!text) return false
  return normalizeaza(text).includes(normalizeaza(cautare))
}

/** Doar cifrele — pentru compararea numerelor de telefon scrise oricum. */
export function doarCifre(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '')
}

/**
 * Inițialele pentru avatar: „Popescu Maria” -> „PM”.
 * Maximum două litere; mai multe devin ilizibile într-un cerc de 32px.
 */
export function initiale(nume: string): string {
  const cuvinte = nume.trim().split(/\s+/).filter(Boolean)
  if (cuvinte.length === 0) return '?'
  if (cuvinte.length === 1) return (cuvinte[0] as string).slice(0, 2).toUpperCase()
  return ((cuvinte[0] as string)[0] ?? '') + ((cuvinte[1] as string)[0] ?? '')
}

/** Taie textul lung, păstrând cuvintele întregi. */
export function scurteaza(text: string, maxim: number): string {
  if (text.length <= maxim) return text
  const taiat = text.slice(0, maxim)
  const ultimSpatiu = taiat.lastIndexOf(' ')
  return `${ultimSpatiu > maxim * 0.6 ? taiat.slice(0, ultimSpatiu) : taiat}…`
}

/** Acord de număr: `plural(3, 'client', 'clienți')` -> „clienți”. */
export function plural(numar: number, singular: string, pluralForma: string): string {
  return numar === 1 ? singular : pluralForma
}
