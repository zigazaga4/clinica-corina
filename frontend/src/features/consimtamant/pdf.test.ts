import { PDFDocument } from 'pdf-lib'
import { expect, it } from 'vitest'
import { construiesteAcord, VERSIUNE_ACORD, ziRomaneasca } from './document'
import { curataPentruTiparire, genereazaPdf, type FonturiAcord } from './pdf'

/*
  Proba tiparului.

  Rulează în `jsdom`, ca tot restul suitei, deşi ar fi fost mai comod în Node:
  acolo ar fi mers `node:fs` şi s-ar fi citit fonturile de pe disc într-o linie.
  Comod, dar mai slab ca dovadă — codul acesta nu rulează niciodată în Node, ci
  într-o fereastră de browser. O probă care trece în Node nu spune nimic despre
  ce face `pdf-lib` acolo unde chiar lucrează.

  De aceea fonturile şi semnătura de probă intră prin `?inline`: Vite le
  transformă în adrese `data:` pe care le poate citi orice mediu. Fişierele
  acestea nu ajung în aplicaţie — sunt folosite numai de aici.
*/

import fontNormal from './fonturi/FiraSans-Regular.ttf?inline'
import fontGras from './fonturi/FiraSans-Bold.ttf?inline'
import semnaturaProba from './semnatura-proba.png?inline'

/** `data:...;base64,XXXX` → octeţi. */
function dinAdresaData(adresa: string): Uint8Array {
  const binar = atob(adresa.slice(adresa.indexOf(',') + 1))
  const octeti = new Uint8Array(binar.length)
  for (let i = 0; i < binar.length; i++) octeti[i] = binar.charCodeAt(i)
  return octeti
}

/** Primii octeţi, citiţi ca text — pentru semnătura de fişier `%PDF-`. */
function inceputul(octeti: Uint8Array, cati: number): string {
  return String.fromCharCode(...octeti.subarray(0, cati))
}

const fonturi: FonturiAcord = {
  normal: dinAdresaData(fontNormal),
  gras: dinAdresaData(fontGras),
}
const semnaturaPng = dinAdresaData(semnaturaProba)

function acordPentru(nume: string) {
  return construiesteAcord({ nume, data: ziRomaneasca(new Date(2026, 8, 11)) })
}

it('fonturile şi semnătura de probă se citesc întregi', () => {
  // Dacă `?inline` s-ar strica, restul probelor ar pica cu mesaje de nepătruns.
  expect(fonturi.normal.length).toBeGreaterThan(100_000)
  expect(fonturi.gras.length).toBeGreaterThan(100_000)
  expect(inceputul(semnaturaPng, 4)).toBe('\x89PNG')
})

it('data se scrie româneşte, cu zi şi lună de două cifre', () => {
  expect(ziRomaneasca(new Date(2026, 8, 1))).toBe('01.09.2026')
  expect(ziRomaneasca(new Date(2026, 11, 31))).toBe('31.12.2026')
})

it('numele clientului ajunge în fraza „Subsemnatul”', () => {
  const frazele = acordPentru('Ștefania Țăndărică')
    .filter((b) => b.fel === 'paragraf')
    .map((b) => b.text)
  expect(frazele.some((t) => t.includes('Subsemnatul Ștefania Țăndărică sunt de acord'))).toBe(true)
})

it('operatorul este PROBEAUTY DERMA, cu sediul complet; e-mailul şi telefonul rămân libere', () => {
  // Firma şi adresa sunt cele din registrul ANAF. E-mailul şi telefonul
  // cabinetului rămân necompletate, ca pe hârtia folosită acum.
  const blocuri = acordPentru('Ion Popescu')
  const text = blocuri
    .filter((b) => b.fel === 'paragraf')
    .map((b) => b.text)
    .join(' ')
  expect(blocuri[0]).toEqual({ fel: 'operator', text: 'Denumire cabinet PROBEAUTY DERMA S.R.L.' })
  expect(text).toContain(
    'PROBEAUTY DERMA S.R.L. la adresa: loc. Constanta, str. Mihai Viteazu, nr. 1, bl. F1, sc. B, ap. 24, jud. CONSTANTA.',
  )
  expect(text).toContain('la adresa de email  sau telefonic')
  // Firma de dinainte nu mai apare nicăieri în act.
  const tot = blocuri.map((b) => ('text' in b ? b.text : '')).join(' ')
  expect(tot).not.toMatch(/EVO CREAM|Mircea Voda/)
})

it('curăţarea păstrează diacriticele şi scoate ce nu se poate tipări', () => {
  expect(curataPentruTiparire('Ștefan Țăndărică îâĂÎȘȚ')).toBe('Ștefan Țăndărică îâĂÎȘȚ')

  /*
    Emoji şi alfabete pe care fontul nu le are: devin spaţiu, nu eroare.

    Nu se verifică numărul exact de spaţii rămase, fiindcă nu contează: textul
    trece oricum prin împărţirea pe rânduri, care taie la orice şir de spaţii.
    Contează că semnul imposibil a dispărut şi că numele rămâne citibil.
  */
  const curatat = curataPentruTiparire('Ana \u{1F389} Maria')
  expect(curatat).not.toContain('\u{1F389}')
  expect(curatat.replace(/\s+/g, ' ').trim()).toBe('Ana Maria')

  // Spaţiul insecabil devine spaţiu obişnuit, nu rămâne un semn străin.
  expect(curataPentruTiparire('Ana Maria')).toBe('Ana Maria')
})

it('iese un PDF adevărat, A4, cu mai multe pagini', async () => {
  const octeti = await genereazaPdf({
    blocuri: acordPentru('Alexandra Petrescu'),
    semnaturaPng,
    fonturi,
    versiune: VERSIUNE_ACORD,
  })

  expect(inceputul(octeti, 5)).toBe('%PDF-')

  // Recitit cu aceeaşi bibliotecă: dacă fişierul e stricat, aici crapă.
  const recitit = await PDFDocument.load(octeti)
  expect(recitit.getPageCount()).toBeGreaterThanOrEqual(2)
  expect(recitit.getTitle()).toContain('Acord privind prelucrarea datelor')

  const { width, height } = recitit.getPage(0).getSize()
  expect(Math.round(width)).toBe(595)
  expect(Math.round(height)).toBe(842)
})

it('un nume cu semne imposibile nu opreşte semnarea', async () => {
  // Nume lipit dintr-un mesaj, cu emoji şi alfabet străin. Clientul stă la
  // ghişeu cu creionul în mână: o excepţie aici ar fi cel mai prost moment.
  const octeti = await genereazaPdf({
    blocuri: acordPentru('Ana \u{1F389} Popescu 中文'),
    semnaturaPng,
    fonturi,
    versiune: VERSIUNE_ACORD,
  })
  expect(inceputul(octeti, 5)).toBe('%PDF-')
})

it('un cuvânt mai lat decât pagina nu iese în afara ei', async () => {
  const octeti = await genereazaPdf({
    blocuri: [
      { fel: 'paragraf', text: 'a'.repeat(400) },
      { fel: 'semnatura', data: '11.09.2026' },
    ],
    semnaturaPng,
    fonturi,
    versiune: VERSIUNE_ACORD,
  })
  expect(inceputul(octeti, 5)).toBe('%PDF-')
})
