import { isTauri } from '@tauri-apps/api/core'

/*
  Pe ce fel de aparat rulează aplicația.

  Aceeași interfață pleacă în trei locuri: instalată pe calculatorul din
  recepție, împachetată ca aplicație de telefon, și — de acum — servită ca
  pagină web, deschisă din browserul telefonului. Majoritatea ecranelor nu simt
  nicio diferență, dar câteva depind de lucruri care există într-un singur loc.
*/

/**
 * Aplicația rulează instalată, pe un calculator?
 *
 * `isTauri()` singur nu ajunge: aplicația de Android este tot Tauri, însă
 * acolo nu există nici tabletă de semnat legată prin USB, nici actualizare
 * prin instalator. Verificarea suplimentară a agentului de browser separă
 * calculatorul de telefon.
 *
 * Într-un browser obișnuit — inclusiv Safari pe iPhone — întoarce `false`,
 * fiindcă `isTauri()` citește o variabilă pe care doar Tauri o pune.
 */
export function esteDesktopNativ(): boolean {
  if (typeof window === 'undefined' || !isTauri()) return false
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
