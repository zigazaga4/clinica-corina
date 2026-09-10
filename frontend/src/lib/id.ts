/**
 * Generarea identificatorilor.
 *
 * Baza de date folosește `gen_random_uuid()`. Cât timp lucrăm în memorie,
 * identificatorii se produc aici, în același format, ca datele de test să fie
 * indistinguibile de cele reale.
 */

/** UUID v4. `crypto.randomUUID` există în toate webview-urile țintă. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Rezervă pentru medii de test fără WebCrypto.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
