/**
 * Alegerea implementării.
 *
 * Modulele importă `api` de aici și nu știu niciodată pe care implementare
 * rulează. Comutarea pe backend-ul real se face fără nicio modificare de cod:
 *
 *     # .env.local
 *     VITE_API_URL=https://api.clinica.ro
 *
 * Lipsa variabilei înseamnă „date demo, în memorie” — modul implicit cât timp
 * serverul este în lucru.
 */

import type { ApiClient } from './contract'
import { creeazaApiHttp } from './http/client'
import { creeazaApiInMemorie } from './memory/client'

const urlServer = import.meta.env['VITE_API_URL'] as string | undefined

/** Rulează aplicația pe date demo? Interfața o semnalează vizibil. */
export const esteModDemo = !urlServer

export const api: ApiClient = urlServer ? creeazaApiHttp(urlServer) : creeazaApiInMemorie()

export { reseteazaDateleDemo } from './memory/client'
export * from './contract'
export * from './errors'
