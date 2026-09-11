/**
 * Acordurile GDPR ale unui client, cu fișierul semnat la îndemână.
 *
 * Până acum acordurile se puteau semna, dar nu se puteau vedea: intrau în bază
 * și nu mai ieșea nimic de acolo. Un acord pe care nu-l poți arăta la cerere nu
 * își face treaba pentru care există — de asta banda asta nu este un moft, ci
 * partea care lipsea.
 *
 * Lista nu aduce PDF-urile, ci doar rândurile. Fișierul se cere unul câte unul,
 * la apăsarea butonului: altfel deschiderea unei fișe cu zece acorduri ar trage
 * câteva sute de kiloocteți degeaba, de fiecare dată.
 */

import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Download, ExternalLink, FileSignature } from 'lucide-react'
import { api } from '@/api'
import { mesajEroare } from '@/api/errors'
import { useConsimtaminte } from '@/app/queries'
import type { ConsimtamantDetaliu, Uuid } from '@/domain/types'
import { formateazaDataOra } from '@/lib/dates'
import { Badge, Buton, CorpCard, Spinner, StareEroare, StareGoala, useNotificari } from '@/ui'
import { deschideAcord, DOSAR_ACORDURI, salveazaAcord } from './descarca'

export function PanouAcorduri({ clientId }: { clientId: Uuid }) {
  const notificari = useNotificari()
  const { data, isPending, error, refetch } = useConsimtaminte({ client_id: clientId })
  /** Ce rând lucrează acum, ca să nu se blocheze toată lista pentru unul. */
  const [inLucru, setInLucru] = useState<string | null>(null)

  /**
   * Aduce PDF-ul și îl așază pe disc; dacă i se cere, îl și deschide.
   *
   * Deschiderea vine după salvare, nu în locul ei: un cititor de PDF are nevoie
   * de un fișier adevărat, iar o copie rămasă pe disc este oricum ce-i trebuie
   * recepției.
   */
  const ia = async (acord: ConsimtamantDetaliu, apoiDeschide: boolean) => {
    setInLucru(acord.id)
    try {
      const pdf = await api.consimtaminte.document(acord.id)
      const salvat = await salveazaAcord(pdf, acord.client_nume, acord.semnat_la)

      if (apoiDeschide && salvat.cale) {
        await deschideAcord(salvat.cale)
        notificari.succes('Acordul a fost deschis.', `Documente › ${DOSAR_ACORDURI}`)
      } else {
        notificari.succes(
          'Acordul a fost salvat.',
          salvat.cale ? `Documente › ${DOSAR_ACORDURI} › ${salvat.nume}` : salvat.nume,
        )
      }
    } catch (err) {
      notificari.eroare('Acordul nu a putut fi descărcat.', mesajEroare(err))
    } finally {
      setInLucru(null)
    }
  }

  if (isPending) {
    return (
      <div className="flex justify-center py-10 text-ink-faint">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <CorpCard className="p-4">
        <StareEroare mesaj={mesajEroare(error)} onReincearca={() => void refetch()} />
      </CorpCard>
    )
  }

  if (data.randuri.length === 0) {
    return (
      <CorpCard className="p-4">
        <StareGoala
          pictograma={<FileSignature className="size-5" />}
          titlu="Niciun acord semnat"
          descriere="Acordul se semnează pe tabletă la prima venire a clientului, când i se onorează ședința."
        />
      </CorpCard>
    )
  }

  return (
    <CorpCard className="flex flex-col gap-3 p-4">
      <ol className="flex flex-col gap-3">
        {data.randuri.map((acord) => (
          <li
            key={acord.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-ink tabular-nums">
                  {formateazaDataOra(acord.semnat_la)}
                </span>
                {acord.programare_id && <Badge ton="info">La ședință</Badge>}
              </div>

              <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
                {/* Operatoarea poate fi ștearsă (ON DELETE SET NULL); acordul rămâne. */}
                Asistat de {acord.creat_de_nume ?? 'cont șters'}
                {acord.dispozitiv ? ` · ${acord.dispozitiv}` : ''}
              </p>
              <p className="text-[12px] text-ink-faint">
                Text {acord.versiune} · {Math.round(acord.marime / 1024)} kB
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              {/*
                „Deschide” are nevoie de partea de Windows a aplicației: în
                browser nu există cu ce deschide un fișier de pe disc.
              */}
              {isTauri() && (
                <Buton
                  onClick={() => void ia(acord, true)}
                  disabled={inLucru !== null}
                  incarca={inLucru === acord.id}
                  className="tinta-atingere"
                >
                  <ExternalLink className="size-4" />
                  Deschide
                </Buton>
              )}
              <Buton
                onClick={() => void ia(acord, false)}
                disabled={inLucru !== null}
                incarca={inLucru === acord.id && !isTauri()}
                className="tinta-atingere"
              >
                <Download className="size-4" />
                Descarcă
              </Buton>
            </div>
          </li>
        ))}
      </ol>

      {isTauri() && (
        <p className="text-[12px] text-ink-faint">
          Acordurile descărcate se adună în <strong>Documente › {DOSAR_ACORDURI}</strong>.
        </p>
      )}
    </CorpCard>
  )
}
