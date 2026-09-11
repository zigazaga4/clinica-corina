/**
 * Tipărirea acordului într-un PDF, cu semnătura desenată pe el.
 *
 * Fișierul ieșit de aici este cel care se arhivează și singurul care mai
 * dovedește ceva peste ani. De aceea nu se compune din HTML transformat în
 * imagine, ci se desenează rând cu rând din aceleași blocuri pe care le vede
 * omul pe ecran (`document.ts`): ce citește el, aceea se tipărește.
 *
 * Fonturile intră ca parametru, nu se aduc de aici. Așa funcția rămâne curată
 * — aceleași blocuri dau mereu același fișier — și poate fi probată în teste,
 * unde nu există nici rețea, nici `fetch`. Aducerea lor stă în `incarcaFonturi`.
 */

import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { BlocAcord } from './document'

// A4, în puncte tipografice.
const LATIME = 595.28
const INALTIME = 841.89

const MARGINE = 48
const MARGINE_JOS = 56

const CORP = 8.5
const RAND = 11.5

const NEGRU = rgb(0.1, 0.1, 0.12)
const GRI = rgb(0.45, 0.45, 0.5)
const LINIE = rgb(0.7, 0.7, 0.74)

export interface FonturiAcord {
  normal: Uint8Array
  gras: Uint8Array
}

export interface DatePdf {
  blocuri: readonly BlocAcord[]
  /** Semnătura culeasă de tabletă, PNG. */
  semnaturaPng: Uint8Array
  fonturi: FonturiAcord
  /** Scrisă discret în subsol, ca să se știe ce text s-a semnat. */
  versiune: string
}

/*
  Intervalele sunt scrise cu coduri, nu cu litere puse între paranteze drepte.
  Un interval de forma [^ -ɏ] arată în editor ca două spații și un semn: nimeni
  nu mai poate spune ce cuprinde, nici dacă a fost stricat de o copiere.

  Latina de bază, Latin-1, Extended-A și Extended-B — ultimele aduc „ș” și „ț”
  cu virgulă — plus liniuțele și ghilimelele tipografice.
*/
// Steagul `u` face potrivirea pe CARACTERE, nu pe unități de cod: fără el, un
// emoji — care ocupă două unități — ar fi înlocuit cu două spații în loc de unul.
const CARACTERE_PERMISE = /[^\u0020-\u007E\u00A0-\u024F\u2010-\u2027\u2030-\u205E]/gu
/** Spații care nu sunt spațiul obișnuit: insecabil, de cifră, îngust. */
const SPATII_CIUDATE = /[\u00A0\u2007\u202F]/g

/**
 * Scoate din text ce nu poate fi desenat.
 *
 * `pdf-lib` ARUNCĂ atunci când întâlnește un caracter pe care fontul nu îl
 * are, iar asta s-ar întâmpla exact în clipa cea mai proastă: cu clientul în
 * fața ghișeului și creionul în mână. Un nume lipit dintr-un mesaj poate
 * aduce cu el un emoji sau un spațiu insecabil de altă lățime.
 *
 * Se păstrează latina cu tot cu diacriticele românești și semnele obișnuite;
 * restul devine spațiu. Un nume scris cu un caracter ciudat se va tipări cu un
 * gol în locul lui — neplăcut, dar semnabil, spre deosebire de o fereastră de
 * eroare.
 */
export function curataPentruTiparire(text: string): string {
  return text.normalize('NFC').replace(SPATII_CIUDATE, ' ').replace(CARACTERE_PERMISE, ' ')
}

/**
 * Taie un paragraf în rânduri care încap în lățimea dată.
 *
 * Un cuvânt mai lung decât rândul întreg — o adresă de e-mail lipită fără
 * spații — se rupe pe litere. Fără asta ar ieși în afara paginii, tăcut.
 */
function impartePeRanduri(
  text: string,
  font: PDFFont,
  marime: number,
  latime: number,
): string[] {
  const randuri: string[] = []
  let curent = ''

  const incape = (s: string) => font.widthOfTextAtSize(s, marime) <= latime

  for (const cuvant of curataPentruTiparire(text).split(/\s+/).filter(Boolean)) {
    const incercare = curent ? `${curent} ${cuvant}` : cuvant
    if (incape(incercare)) {
      curent = incercare
      continue
    }
    if (curent) randuri.push(curent)

    if (incape(cuvant)) {
      curent = cuvant
      continue
    }
    // Cuvânt mai lat decât rândul: se rupe litera cu litera.
    let bucata = ''
    for (const litera of cuvant) {
      if (incape(bucata + litera)) {
        bucata += litera
      } else {
        if (bucata) randuri.push(bucata)
        bucata = litera
      }
    }
    curent = bucata
  }

  if (curent) randuri.push(curent)
  return randuri.length ? randuri : ['']
}

/** Starea desenării: pagina curentă și cât mai e loc pe ea. */
interface Creion {
  pdf: PDFDocument
  pagina: PDFPage
  y: number
  pagini: PDFPage[]
}

function paginaNoua(creion: Creion): void {
  creion.pagina = creion.pdf.addPage([LATIME, INALTIME])
  creion.pagini.push(creion.pagina)
  creion.y = INALTIME - MARGINE
}

/** Creionul, pus deja pe prima pagină — nu există stare fără pagină. */
function creionNou(pdf: PDFDocument): Creion {
  const pagina = pdf.addPage([LATIME, INALTIME])
  return { pdf, pagina, y: INALTIME - MARGINE, pagini: [pagina] }
}

/** Cere loc pe verticală; trece pe pagina următoare dacă nu mai încape. */
function faLoc(creion: Creion, inaltime: number): void {
  if (creion.y - inaltime < MARGINE_JOS) paginaNoua(creion)
}

function scrieParagraf(
  creion: Creion,
  text: string,
  font: PDFFont,
  optiuni: { marime?: number; stanga?: number; culoare?: ReturnType<typeof rgb> } = {},
): void {
  const marime = optiuni.marime ?? CORP
  const stanga = optiuni.stanga ?? MARGINE
  const latime = LATIME - MARGINE - stanga
  const inaltimeRand = marime * 1.38

  for (const rand of impartePeRanduri(text, font, marime, latime)) {
    faLoc(creion, inaltimeRand)
    creion.pagina.drawText(rand, {
      x: stanga,
      y: creion.y - marime,
      size: marime,
      font,
      color: optiuni.culoare ?? NEGRU,
    })
    creion.y -= inaltimeRand
  }
}

/**
 * Desenează acordul și întoarce octeții PDF-ului.
 *
 * Semnătura se pune la sfârșit, sub „Semnatura”, pe aceeași pagină cu data —
 * blocul cere din capul locului destul loc, ca să nu rămână data pe o pagină
 * și semnătura pe alta.
 */
export async function genereazaPdf(date: DatePdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)

  const normal = await pdf.embedFont(date.fonturi.normal, { subset: true })
  const gras = await pdf.embedFont(date.fonturi.gras, { subset: true })
  const semnatura = await pdf.embedPng(date.semnaturaPng)

  pdf.setTitle('Acord privind prelucrarea datelor cu caracter personal')
  pdf.setProducer('Gestiune Clinica')
  pdf.setCreationDate(new Date())

  const creion = creionNou(pdf)

  for (const bloc of date.blocuri) {
    switch (bloc.fel) {
      case 'operator':
        scrieParagraf(creion, bloc.text, gras, { marime: 10 })
        creion.y -= 8
        break

      case 'titlu':
        creion.y -= 2
        scrieParagraf(creion, bloc.text, gras, { marime: 10.5 })
        creion.y -= 10
        break

      case 'paragraf':
        scrieParagraf(creion, bloc.text, normal)
        creion.y -= 7
        break

      case 'numerotat': {
        // Cifra stă în afara coloanei de text, ca rândurile următoare să se
        // alinie sub prima literă, nu sub număr.
        faLoc(creion, RAND)
        const sus = creion.y
        creion.pagina.drawText(`${bloc.numar}.`, {
          x: MARGINE, y: sus - CORP, size: CORP, font: gras, color: NEGRU,
        })
        scrieParagraf(creion, bloc.text, normal, { stanga: MARGINE + 16 })
        creion.y -= 6
        break
      }

      case 'punct': {
        faLoc(creion, RAND)
        creion.pagina.drawText('•', {
          x: MARGINE + 16, y: creion.y - CORP, size: CORP, font: normal, color: GRI,
        })
        scrieParagraf(creion, bloc.text, normal, { stanga: MARGINE + 26 })
        creion.y -= 5
        break
      }

      case 'campuri': {
        // Spațiile libere de completat cu mâna, cu linie punctată după etichetă.
        creion.y -= 2
        for (const eticheta of bloc.etichete) {
          faLoc(creion, 16)
          creion.pagina.drawText(`${eticheta}:`, {
            x: MARGINE + 8, y: creion.y - CORP, size: CORP, font: normal, color: NEGRU,
          })
          const de = MARGINE + 8 + normal.widthOfTextAtSize(`${eticheta}:`, CORP) + 6
          creion.pagina.drawLine({
            start: { x: de, y: creion.y - CORP - 1.5 },
            end: { x: LATIME - MARGINE, y: creion.y - CORP - 1.5 },
            thickness: 0.4,
            color: LINIE,
          })
          creion.y -= 16
        }
        creion.y -= 4
        break
      }

      case 'nota':
        scrieParagraf(creion, bloc.text, normal, { marime: 7.5, culoare: GRI })
        creion.y -= 8
        break

      case 'semnatura': {
        /*
          Blocul de semnătură nu se rupe niciodată în două.

          Cere dintr-o dată tot ce îi trebuie — etichete, chenar, imagine — și
          trece pe pagină nouă dacă nu încape întreg. Altfel s-ar putea tipări
          „Data 11.09.2026” la piciorul unei pagini și semnătura singură, fără
          niciun text, în capul celeilalte.
        */
        const INALTIME_BLOC = 86
        creion.y -= 14
        faLoc(creion, INALTIME_BLOC)

        const sus = creion.y
        const stangaSemn = LATIME / 2 + 10

        creion.pagina.drawText(`Data     ${bloc.data}`, {
          x: MARGINE, y: sus - CORP, size: CORP, font: normal, color: NEGRU,
        })
        creion.pagina.drawText('Semnatura', {
          x: stangaSemn, y: sus - CORP, size: CORP, font: normal, color: NEGRU,
        })

        // Imaginea păstrează proporțiile: o semnătură turtită arată falsificată.
        const latimeMax = LATIME - MARGINE - stangaSemn
        const inaltimeMax = 52
        const scara = Math.min(
          latimeMax / semnatura.width,
          inaltimeMax / semnatura.height,
        )
        const latimeSemn = semnatura.width * scara
        const inaltimeSemn = semnatura.height * scara
        const linieY = sus - CORP - 64

        creion.pagina.drawImage(semnatura, {
          x: stangaSemn,
          y: linieY + 4,
          width: latimeSemn,
          height: inaltimeSemn,
        })
        creion.pagina.drawLine({
          start: { x: stangaSemn, y: linieY },
          end: { x: LATIME - MARGINE, y: linieY },
          thickness: 0.6,
          color: LINIE,
        })

        creion.y = linieY - 10
        break
      }
    }
  }

  /*
    Subsolul: versiunea textului și numerotarea „Pagina 2 din 4”.

    Numărul total se poate scrie abia acum, când se știe câte pagini au ieșit.
    Fără „din câte”, o pagină scoasă dintr-un dosar nu s-ar observa niciodată.
  */
  const total = creion.pagini.length
  creion.pagini.forEach((pagina, i) => {
    pagina.drawText(curataPentruTiparire(date.versiune), {
      x: MARGINE, y: 30, size: 6.5, font: normal, color: GRI,
    })
    const numerotare = `Pagina ${i + 1} din ${total}`
    pagina.drawText(numerotare, {
      x: LATIME - MARGINE - normal.widthOfTextAtSize(numerotare, 6.5),
      y: 30,
      size: 6.5,
      font: normal,
      color: GRI,
    })
  })

  return pdf.save()
}
