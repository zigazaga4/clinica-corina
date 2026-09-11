import { useMemo } from 'react'
import { addMinutes, differenceInMinutes, formateazaDurata, laInputDatetime } from '@/lib/dates'
import { Input, Select } from '@/ui'

/*
  Ziua, ora și durata — trei alegeri simple în loc de două câmpuri de tip
  „dată și oră”.

  Câmpul `datetime-local` arată bine, dar se schimbă prost: ora stă într-o
  bucată separată a lui, care trebuie nimerită cu degetul înainte de a putea fi
  modificată, iar pe telefon deschide o roată cu cinci coloane. Recepția schimbă
  ora de zeci de ori pe zi și ziua rareori — deci ora merită o listă în care se
  apasă o dată.

  Sfârșitul nu se scrie deloc: se alege durata, iar ora de sfârșit se
  calculează. Așa nu mai poate exista un interval care se termină înainte să
  înceapă, iar durata — lucrul la care se gândește operatoarea — nu mai trebuie
  socotită în minte.

  Aceleași trei câmpuri servesc programarea și notița. Scrise o dată, regula
  „mutarea începutului păstrează durata” nu poate ajunge să difere între ele.
*/

/** Duratele obișnuite ale unei ședințe, în minute. */
export const DURATE_SEDINTA = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240]

/** O notiță ține adesea o jumătate de zi sau o zi întreagă. */
export const DURATE_NOTITA = [...DURATE_SEDINTA, 300, 360, 480, 600]

/*
  Orele care se pot alege, din sfert în sfert.

  Intervalul este mai larg decât grila calendarului (8–20, v. `constante.ts`):
  se mai face o ședință la 7 dimineața sau la 9 seara, iar o listă care nu
  permite asta ar trimite operatoarea înapoi la tastat. Sfertul de oră este
  pasul la care se gândește o recepție; minutul exact nu i-a trebuit niciodată.
*/
const ORE_ROTUNDE: string[] = (() => {
  const rezultat: string[] = []
  for (let minut = 6 * 60; minut <= 22 * 60; minut += 15) {
    const h = Math.floor(minut / 60)
    const m = minut % 60
    rezultat.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  return rezultat
})()

export function CampuriInterval({
  incepeLa,
  seTerminaLa,
  onSchimba,
  erori = {},
  durate = DURATE_SEDINTA,
}: {
  /** Începutul, în forma `yyyy-MM-ddTHH:mm` a lui `laInputDatetime`. */
  incepeLa: string
  seTerminaLa: string
  /** Primește ambele capete: mutarea începutului îl mută și pe cel de sfârșit. */
  onSchimba: (incepeLa: string, seTerminaLa: string) => void
  erori?: { incepe_la?: string | null; se_termina_la?: string | null }
  /** Lista de durate din selector; valoarea curentă se adaugă dacă lipsește. */
  durate?: number[]
}) {
  const durata =
    incepeLa !== '' && seTerminaLa !== ''
      ? differenceInMinutes(new Date(seTerminaLa), new Date(incepeLa))
      : 0

  /*
    Ziua și ora se citesc din `incepeLa`, nu se țin separat.

    O a doua copie a aceleiași informații ar fi trebuit ținută în pas cu prima
    la fiecare schimbare, iar prima dată când cineva ar fi uitat să o facă,
    formularul ar fi trimis altă oră decât cea de pe ecran. Forma este fixă —
    `yyyy-MM-ddTHH:mm` (v. `laInputDatetime`) — deci tăierea este sigură.
  */
  const zi = incepeLa.slice(0, 10)
  const ora = incepeLa.slice(11, 16)

  /** Mutarea începutului păstrează durata deja stabilită. */
  const mutaInceputul = (valoare: string) => {
    if (durata > 0) {
      onSchimba(valoare, laInputDatetime(addMinutes(new Date(valoare), durata)))
    } else {
      onSchimba(valoare, seTerminaLa)
    }
  }

  /** Mută întregul interval în altă zi, păstrând ora și durata. */
  const schimbaZiua = (valoare: string) => {
    if (valoare === '') return
    mutaInceputul(`${valoare}T${ora || '09:00'}`)
  }

  /** Mută ora de început; durata merge după ea. */
  const schimbaOra = (valoare: string) => mutaInceputul(`${zi}T${valoare}`)

  /** Durata mută doar sfârșitul — începutul rămâne acolo unde a fost pus. */
  const schimbaDurata = (minute: number) => {
    if (incepeLa === '') return
    onSchimba(incepeLa, laInputDatetime(addMinutes(new Date(incepeLa), minute)))
  }

  /*
    Listele conțin ÎNTOTDEAUNA valoarea curentă, chiar dacă nu e rotundă.

    O programare veche poate începe la 14:07 sau dura 37 de minute — puse în
    bază înainte, sau mutate din altă parte. Fără rândul lor în listă,
    deschiderea formularului ar fi arătat altă oră decât cea adevărată și ar fi
    rescris-o în tăcere la prima salvare.
  */
  const oreDisponibile = useMemo(
    () => (ora && !ORE_ROTUNDE.includes(ora) ? [...ORE_ROTUNDE, ora].sort() : ORE_ROTUNDE),
    [ora],
  )
  const durateDisponibile = useMemo(
    () =>
      durata > 0 && !durate.includes(durata) ? [...durate, durata].sort((a, b) => a - b) : durate,
    [durata, durate],
  )

  return (
    <>
      <Input
        eticheta="Ziua"
        type="date"
        obligatoriu
        value={zi}
        onChange={(e) => schimbaZiua(e.target.value)}
        eroare={erori.incepe_la ?? null}
      />
      <Select eticheta="Ora" obligatoriu value={ora} onChange={(e) => schimbaOra(e.target.value)}>
        {oreDisponibile.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>

      <Select
        eticheta="Durata"
        value={String(durata)}
        onChange={(e) => schimbaDurata(Number(e.target.value))}
        eroare={erori.se_termina_la ?? null}
        ajutor={seTerminaLa !== '' ? `Se termină la ${seTerminaLa.slice(11, 16)}` : undefined}
      >
        {durateDisponibile.map((d) => (
          <option key={d} value={d}>
            {formateazaDurata(d)}
          </option>
        ))}
      </Select>
    </>
  )
}

/** Următorul sfert de oră rotund — punctul de pornire firesc la recepție. */
export function proximulSfertDeOra(): Date {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15)
  return d
}
