import { useId, useState, type FormEvent } from 'react'
import type { DateArticolNou } from '@/api/contract'
import { useCreeazaArticol, useModificaArticol } from '@/app/queries'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import { etichetaTipArticol } from '@/domain/labels'
import { TIP_ARTICOL, type Articol, type TipArticol } from '@/domain/types'
import { useEroriFormular } from '@/lib/formular'
import { parseNumar } from '@/lib/money'
import {
  Buton,
  ButonGrup,
  Camp,
  Comutator,
  GrupButoane,
  Input,
  Modala,
  useNotificari,
} from '@/ui'

type CampArticol = 'denumire' | 'durata_minute' | 'pret_lista' | 'numar_sedinte'

/**
 * Adăugarea și modificarea unui articol (serviciu sau produs).
 *
 * Se montează doar cât timp este deschis: starea pornește din `articol` la
 * fiecare deschidere, fără efect de sincronizare care să readucă valori vechi
 * după o salvare.
 */
export function FormularArticol({
  articol,
  tipInitial = 'serviciu',
  onInchide,
}: {
  /** null = articol nou. */
  articol: Articol | null
  /** Tipul propus pentru un articol nou — fila din care s-a pornit. */
  tipInitial?: TipArticol
  onInchide: () => void
}) {
  const idFormular = useId()
  const notificari = useNotificari()
  const erori = useEroriFormular<CampArticol>()
  const creeaza = useCreeazaArticol()
  const modifica = useModificaArticol()

  const [tip, setTip] = useState<TipArticol>(articol?.tip ?? tipInitial)
  const [denumire, setDenumire] = useState(articol?.denumire ?? '')
  const [durata, setDurata] = useState(
    articol && articol.durata_minute !== null ? String(articol.durata_minute) : '',
  )
  const [pret, setPret] = useState(articol ? String(articol.pret_lista) : '')
  const [numarSedinte, setNumarSedinte] = useState(articol ? String(articol.numar_sedinte) : '1')
  const [activ, setActiv] = useState(articol?.activ ?? true)

  const seTrimite = creeaza.isPending || modifica.isPending

  const schimbaTip = (nou: TipArticol) => {
    setTip(nou)
    // articol_durata_ck cere durată NULL la produs. Golim câmpul chiar la
    // comutare: o valoare rămasă pe ecran ar pleca spre server și ar fi
    // respinsă acolo, deși utilizatorul nu mai vede unde a greșit.
    // La fel numărul de ședințe: un produs se vinde dintr-o bucată.
    if (nou === 'produs') {
      setDurata('')
      setNumarSedinte('1')
      erori.setCamp('durata_minute', null)
      erori.setCamp('numar_sedinte', null)
    }
  }

  const sedinteNumar = parseNumar(numarSedinte)
  const esteTratament = tip === 'serviciu' && sedinteNumar !== null && sedinteNumar > 1

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    const denumireCurata = denumire.trim()
    const pretNumar = parseNumar(pret)
    const durataNumar = parseNumar(durata)

    // Toate verificările deodată: utilizatorul vede din prima tot ce are de
    // corectat, nu un câmp pe rând, la fiecare apăsare pe „Salvează”.
    const problemele: [CampArticol, string][] = []

    if (denumireCurata === '') {
      problemele.push(['denumire', 'Denumirea este obligatorie.'])
    }

    if (pretNumar === null) {
      problemele.push(['pret_lista', 'Completează prețul de listă.'])
    } else if (pretNumar < 0) {
      problemele.push(['pret_lista', 'Prețul nu poate fi negativ.'])
    }

    if (tip === 'serviciu') {
      if (durataNumar === null || durataNumar <= 0) {
        problemele.push([
          'durata_minute',
          'Un serviciu trebuie să aibă o durată exprimată în minute, mai mare ca zero.',
        ])
      } else if (!Number.isInteger(durataNumar)) {
        problemele.push(['durata_minute', 'Durata se exprimă în minute întregi.'])
      }
      if (sedinteNumar === null || !Number.isInteger(sedinteNumar) || sedinteNumar < 1) {
        problemele.push(['numar_sedinte', 'Numărul de ședințe trebuie să fie un întreg, cel puțin 1.'])
      }
    }

    if (problemele.length > 0 || pretNumar === null) {
      for (const [camp, mesaj] of problemele) erori.setCamp(camp, mesaj)
      return
    }

    const date: DateArticolNou = {
      tip,
      denumire: denumireCurata,
      durata_minute: tip === 'serviciu' ? durataNumar : null,
      pret_lista: pretNumar,
      activ,
      numar_sedinte: tip === 'serviciu' ? (sedinteNumar ?? 1) : 1,
    }

    try {
      if (articol) {
        await modifica.mutateAsync({ id: articol.id, date })
        notificari.succes(`${etichetaTipArticol[tip]} modificat`, denumireCurata)
      } else {
        await creeaza.mutateAsync(date)
        notificari.succes(`${etichetaTipArticol[tip]} adăugat`, denumireCurata)
      }
      onInchide()
    } catch (err) {
      erori.preia(err)
    }
  }

  return (
    <Modala
      deschisa
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={articol ? 'Modifică articolul' : tip === 'serviciu' ? 'Serviciu nou' : 'Produs nou'}
      descriere={
        articol
          ? articol.denumire
          : 'Serviciile au durată și se pot programa; produsele se vând la bucată.'
      }
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seTrimite} className="sm:w-auto" plin>
            Renunță
          </Buton>
          {/*
            Butonul stă în subsolul modalei, în afara elementului `form`, deci
            este legat de el prin atributul `form`.
          */}
          <Buton
            type="submit"
            form={idFormular}
            varianta="primar"
            incarca={seTrimite}
            className="sm:w-auto"
            plin
          >
            {articol ? 'Salvează' : 'Adaugă'}
          </Buton>
        </>
      }
    >
      <form id={idFormular} onSubmit={trimite} noValidate>
        <GrilaFormular>
          <PeToataLatimea>
            {/*
              Grupul își poartă singur eticheta prin `aria-label`: legarea
              etichetei „Tip” de primul buton i-ar înlocui numele accesibil, iar
              cititorul de ecran ar anunța „Tip” în loc de „Serviciu”.
            */}
            <Camp eticheta="Tip" ajutor="Doar serviciile pot fi programate în calendar.">
              {() => (
                <GrupButoane eticheta="Tipul articolului" className="w-full">
                  {TIP_ARTICOL.map((valoare) => (
                    <ButonGrup
                      key={valoare}
                      activ={tip === valoare}
                      disabled={seTrimite}
                      onClick={() => schimbaTip(valoare)}
                      className="h-11 flex-1 sm:h-9"
                    >
                      {etichetaTipArticol[valoare]}
                    </ButonGrup>
                  ))}
                </GrupButoane>
              )}
            </Camp>
          </PeToataLatimea>

          <PeToataLatimea>
            <Input
              eticheta="Denumire"
              obligatoriu
              autoFocus
              maxLength={120}
              value={denumire}
              onChange={(e) => setDenumire(e.target.value)}
              eroare={erori.peCamp.denumire}
              placeholder={
                tip === 'serviciu' ? 'ex. Tratament facial hidratant' : 'ex. Cremă hidratantă 50 ml'
              }
            />
          </PeToataLatimea>

          {/* Câmpul apare doar la servicii: la produse durata trebuie să fie NULL. */}
          {tip === 'serviciu' && (
            <Input
              eticheta="Durată"
              obligatoriu
              type="number"
              inputMode="numeric"
              min={1}
              step={5}
              value={durata}
              onChange={(e) => setDurata(e.target.value)}
              eroare={erori.peCamp.durata_minute}
              sufix="min"
              placeholder="60"
            />
          )}

          <Input
            eticheta="Preț listă"
            obligatoriu
            type="text"
            inputMode="decimal"
            value={pret}
            onChange={(e) => setPret(e.target.value)}
            eroare={erori.peCamp.pret_lista}
            sufix="RON"
            className="pr-13"
            ajutor={
              esteTratament
                ? `Pentru toate cele ${sedinteNumar} ședințe împreună; fiecare programare primește o parte.`
                : 'Separatorul zecimal poate fi virgulă sau punct.'
            }
            placeholder="150"
          />

          {/*
            Peste 1, serviciul devine tratament: prima programare a lui deschide
            un tratament pe fișa clientului, iar următoarele intră în el.
          */}
          {tip === 'serviciu' && (
            <Input
              eticheta="Număr de ședințe"
              obligatoriu
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={numarSedinte}
              onChange={(e) => setNumarSedinte(e.target.value)}
              eroare={erori.peCamp.numar_sedinte}
              ajutor="1 = o singură venire. Peste 1, serviciul se face ca tratament, în mai multe programări."
            />
          )}

          <PeToataLatimea>
            <Comutator
              eticheta="Activ"
              descriere="Articolele scoase din ofertă se dezactivează, nu se șterg: programările și vânzările deja înregistrate trimit mai departe la ele."
              bifat={activ}
              onChange={setActiv}
              disabled={seTrimite}
            />
          </PeToataLatimea>
        </GrilaFormular>

        {erori.general && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger"
          >
            {erori.general}
          </p>
        )}
      </form>
    </Modala>
  )
}
