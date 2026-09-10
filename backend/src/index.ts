import 'dotenv/config'
import path from 'path'
import express from 'express'

// Keep server alive on unhandled async errors — routes must still return 500
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
import cors from 'cors'
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

// Necesar ca `req.ip` să fie adresa clientului, nu a proxy-ului, în jurnal.
app.set('trust proxy', true)

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

app.listen(PORT, () => {
  console.log(`Clinica API running on http://localhost:${PORT}`)
  console.log(`Health: http://localhost:${PORT}/health`)
})
