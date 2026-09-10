import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import util from 'util'
import express from 'express'

// Keep server alive on unhandled async errors — routes must still return 500
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

/*
  Perechea celui de sus, pentru excepțiile SINCRONE care scapă pe lângă rute.

  `ruta()` prinde tot ce se aruncă dintr-un handler, dar nu tot codul trece prin
  el: un `setTimeout`, un callback al driverului de bază, un ascultător de
  eveniment. De acolo, un `throw` ajunge direct la Node, care oprește procesul
  scriind stiva pe ieșirea de erori și atât — fără marcaj, amestecată printre
  celelalte rânduri, greu de găsit peste o săptămână.

  Aici NU se continuă, deliberat. După o excepție necaptată nu se știe ce a
  apucat să se execute: o tranzacție poate rămâne deschisă, o cerere la
  jumătate, o variabilă într-o stare imposibilă. Un server care merge mai
  departe „cumva” face rău mai mult timp decât unul care cade și repornește în
  două secunde. Ieșirea este cu cod diferit de zero, ca pm2 să vadă o cădere:
  cu zero ar putea înțelege oprire voită și ar lăsa procesul jos.
*/
process.on('uncaughtException', (eroare) => {
  /*
    Scrisă sincron, direct pe descriptorul 2. `console.error` scrie asincron
    atunci când ieșirea de erori este o conductă — exact cum o ține pm2 — iar
    `process.exit` de dedesubt ar reteza-o înainte să plece: s-ar pierde tocmai
    eroarea pentru care există handlerul, iar în jurnal ar rămâne o repornire
    fără explicație.
  */
  try {
    fs.writeSync(2, `[uncaughtException] ${util.inspect(eroare, { depth: 4 })}\n`)
  } catch {
    console.error('[uncaughtException]', eroare)
  }
  process.exit(1)
})
import cors from 'cors'
import helmet from 'helmet'
import { trateazaErori } from './lib/erori.js'
import authRouter from './routes/auth.js'
import clientiRouter from './routes/clienti.js'
import programariRouter from './routes/programari.js'
import vanzariRouter from './routes/vanzari.js'
import abonamenteRouter from './routes/abonamente.js'
import articoleRouter from './routes/articole.js'
import puncteLucruRouter from './routes/puncte-lucru.js'
import utilizatoriRouter from './routes/utilizatori.js'
import jurnalRouter from './routes/jurnal.js'
import referintaRouter from './routes/referinta.js'

/*
  Secretul se verifică la pornire, nu la prima autentificare.

  Lipsă, `jwt.sign` aruncă abia când cineva încearcă să intre — server pornit,
  „ok” la /health, și eroare 500 la primul login. Mai bine refuză să pornească.
*/
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error(
    'JWT_SECRET lipsește sau este prea scurt (minimum 32 de caractere).\n' +
    'Generează unul: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
  )
  process.exit(1)
}

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)

/*
  Express se prezintă din oficiu, cu `X-Powered-By: Express`, la fiecare
  răspuns. Nu este o breșă în sine, dar scutește pe oricine scanează internetul
  de munca de a ghici: știind ce rulează dedesubt, încearcă direct
  vulnerabilitățile cunoscute ale acestui cadru și ale middleware-urilor lui
  obișnuite. Nu avem nimic de câștigat din antetul acesta.
*/
app.disable('x-powered-by')

/*
  Se au încredere DOAR proxy-urile de pe bucla locală — adică nginx-ul de pe
  aceeași mașină, singurul care ne trimite cereri.

  Aici scria `true`, adică „orice `X-Forwarded-For` primit este adevărat”.
  Pentru jurnal era doar supărător; pentru limitarea încercărilor de
  autentificare de mai jos ar fi fost fatal: cine ghicește parole își pune
  singur în antet o adresă inventată, alta la fiecare cerere, iar numărătoarea
  nu ajunge niciodată la limită. Limitarea ar fi arătat că există fără să
  oprească nimic — cel mai prost fel de protecție.

  Cu 'loopback', Express citește lista din `X-Forwarded-For` de la coadă spre
  cap și se oprește la prima adresă care nu vine de la un proxy de încredere:
  exact bucata pe care o adaugă nginx și pe care clientul nu o poate scrie.
  Ce a inventat clientul rămâne în fața ei, ignorat.

  Garanția asta ține doar cât ține configurația din nginx: antetul trebuie
  ADĂUGAT, nu înlocuit cu ce a trimis clientul —
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
  (sau `$remote_addr`). Cu `$http_x_forwarded_for`, nginx repetă minciuna
  clientului și nimic de aici nu o mai poate deosebi de adevăr.

  Dacă serverul ajunge vreodată în spatele altui proxy (alt calculator din
  rețea, un CDN), adresa aceluia trebuie trecută aici; altfel `req.ip` devine
  adresa proxy-ului și toată clinica ajunge într-o singură găleată.
*/
app.set('trust proxy', 'loopback')

/*
  Antetele de securitate.

  Serverul vorbește mai ales cu o aplicație Tauri, nu cu un browser, așa că
  parte din ele sunt ieftine — dar nu inutile: prin nginx răspunsurile ajung și
  în browserul de la 5173 în timpul dezvoltării, iar din `public/` se servește o
  pagină HTML adevărată. `helmet` nu atinge antetele CORS; lista de origini de
  mai jos rămâne singura care hotărăște cine poate suna serverul.

  Politica de conținut se montează separat, mai jos, DUPĂ fișierele statice:
  politica potrivită unui API — „nu încărca nimic, niciodată” — ar lăsa pagina
  de test fără stilurile și scripturile ei, scrise în interiorul HTML-ului.
*/
app.use(helmet({
  contentSecurityPolicy: false,

  /*
    HSTS pe un an: după prima vizită, browserul refuză singur să mai vorbească
    cu domeniul pe http simplu, deci nu mai există prima cerere în clar pe care
    cineva din aceeași rețea să o poată devia. Antetul pleacă și de pe 127.0.0.1,
    unde n-are efect, dar nginx îl duce mai departe pe conexiunea TLS, unde are.

    Fără `preload`: înscrierea în lista compilată în browsere se scoate greu și
    obligă la HTTPS toate subdomeniile, inclusiv cele care nu există încă. Este
    o promisiune pe care o face proprietarul domeniului, nu acest fișier.
  */
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },

  /*
    Răspunsurile sunt citite de pe altă origine prin definiție: `tauri://localhost`
    nu va fi niciodată aceeași origine cu serverul. `same-origin`, cât ține
    helmet implicit, ar bloca tocmai clientul pentru care există serverul.
  */
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Adresele conțin identificatori de clienți și de fișe; nu au ce căuta în
  // antetul `Referer` al unei cereri către altcineva.
  referrerPolicy: { policy: 'no-referrer' },

  // `deny`, nu `sameorigin`: nici măcar pagina de test nu are de ce să se
  // deschidă într-un cadru. Nimic de aici nu se afișează în altă pagină, deci
  // nu există clic de furat.
  frameguard: { action: 'deny' },
}))

/*
  Originile din care se poate suna serverul.

  Aplicația rulează în Tauri, care servește interfața de la `tauri://localhost`
  pe macOS/iOS și de la `http://tauri.localhost` pe Windows și Android. Fără ele
  în listă, aplicația compilată primește la fiecare cerere o eroare de CORS —
  în timp ce `npm run dev` din browser, pe 5173, merge perfect. Este exact
  genul de defect care apare abia la prima instalare pe calculatorul clinicii.
*/
const ORIGINI_IMPLICITE = [
  'http://localhost:5173',
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]

const allowedOrigins = [
  ...ORIGINI_IMPLICITE,
  ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]

app.use(cors({
  /*
    O origine necunoscută primește răspunsul FĂRĂ antetele CORS, nu o eroare.

    Aruncând, cererea ajungea în middleware-ul de erori și se întorcea cu 500 —
    adică „serverul s-a stricat” pentru ceva ce este o respingere normală, plus
    o urmă de stivă în jurnal la fiecare scanare automată de pe internet. Fără
    antete, browserul blochează singur răspunsul, ceea ce este exact rostul
    mecanismului.

    CORS nu este bariera de securitate aici, ci token-ul: un client care nu e
    browser oricum nu se uită la aceste antete.
  */
  origin: (origin, cb) => {
    cb(null, !origin || origin === 'null' || allowedOrigins.includes(origin))
  },
  credentials: true
}))
app.use(express.json())

// Serve static files (test UI and future frontend build)
app.use(express.static(path.join(process.cwd(), 'public')))

/*
  De aici încolo răspunde API-ul, nu fișierele din `public/`.

  Politica de conținut a unui API este cea mai strictă cu putință: un răspuns
  JSON n-are ce încărca și n-are ce căuta într-un `<iframe>`. Contează mai ales
  la răspunsurile de eroare — dacă vreodată se strecoară în ele text venit de la
  client, iar browserul le ia drept HTML, nu are voie să execute nimic din ce
  găsește acolo.
*/
app.use(helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    'default-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  },
}))

/*
  Nimic din ce trece pe aici nu se păstrează nicăieri.

  Răspunsurile poartă nume, telefoane, diagnostice și istoricul de plăți al
  clienților, iar cel de la autentificare poartă chiar jetoanele. `no-store`
  oprește deopotrivă cache-ul browserului și pe al oricărui proxy dintre noi și
  el: altfel fișa unui pacient rămâne pe disc după ce operatoarea închide
  aplicația, pe un calculator la care are acces toată recepția.

  Se aplică în bloc, nu rută cu rută. Aproape fiecare răspuns al acestui server
  poartă date personale, iar o listă de excepții s-ar rupe în tăcere la prima
  rută adăugată de cineva care nu știe de ea. Fișierele statice, montate mai
  sus, rămân în afara regulii — acolo cache-ul este util și nu compromite nimic.
*/
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

// Health check — no auth required
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/auth', authRouter)
app.use('/clienti', clientiRouter)
app.use('/programari', programariRouter)
app.use('/vanzari', vanzariRouter)
app.use('/articole', articoleRouter)
app.use('/puncte-lucru', puncteLucruRouter)
app.use('/utilizatori', utilizatoriRouter)
app.use('/jurnal', jurnalRouter)
// Abonamentele nu fac parte din contractul interfeței; rutele rămân montate
// pentru pagina de test și pentru o eventuală continuare a lor.
app.use('/abonamente', abonamenteRouter)
app.use(referintaRouter)

// 404 — în aceeași formă ca orice altă eroare, ca interfața să aibă ce citi.
app.use((_req, res) => res.status(404).json({ mesaj: 'Ruta cerută nu există.' }))

// Singurul loc din server care compune un răspuns de eroare. Se montează ultimul.
app.use(trateazaErori)

/*
  Ascultă implicit DOAR pe bucla locală.

  În producție serverul stă în spatele nginx, care face TLS și trimite mai
  departe către 127.0.0.1. Dacă procesul ascultă pe toate interfețele, portul
  rămâne deschis în internet pe HTTP simplu, iar cine îl găsește ocolește
  complet certificatul: parole și jetoane trec în clar.

  Pentru cazul în care serverul chiar trebuie văzut din rețea — de pildă un
  telefon care testează aplicația în timpul dezvoltării — se pune explicit
  `HOST=0.0.0.0`. Alegerea nesigură rămâne astfel o decizie conștientă.
*/
const HOST = process.env.HOST ?? '127.0.0.1'

app.listen(PORT, HOST, () => {
  console.log(`Clinica API running on http://${HOST}:${PORT}`)
  console.log(`Health: http://${HOST}:${PORT}/health`)
})
