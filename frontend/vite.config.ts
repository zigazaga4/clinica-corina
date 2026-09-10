import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Tauri expects a fixed port and, for mobile, a host reachable from the device.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // src-tauri is watched by the Rust side, not by Vite.
      ignored: ['**/src-tauri/**'],
    },
  },

  /*
    Tauri folosește Chromium pe Windows/Android și WebKit pe iOS.

    Ținta WebKit este `safari14.1`, nu `safari13` cum lasă șablonul Tauri.

    Safari are erori cunoscute la destructurare până la 14.1, iar esbuild le
    tratează drept „nesuportat” și refuză să rescrie sintaxa. Cu `safari13`,
    `npm run build` cădea pe fiecare `const [a, setA] = useState(...)` — adică
    pe fiecare componentă. Nici `safari14` nu ajunge; 14.1 este primul care
    trece, ceea ce înseamnă iOS 14.5 (aprilie 2021) ca minim real.

    Verificat cu:
      echo 'const f=([a,b])=>a+b' | npx esbuild --target=safari14 --loader=js
  */
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari14.1',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    /*
      React alege varianta de producție sau de dezvoltare citind `NODE_ENV` la
      import. În varianta de producție, `act` nu există, iar Testing Library
      eșuează cu „React.act is not a function”.

      Fixarea are loc aici, nu în scripturile din package.json: dacă mediul în
      care se rulează are deja `NODE_ENV=production` — cum se întâmplă pe
      mașinile de integrare continuă și în unele profiluri de shell — un
      `vitest run` obișnuit ar pica fără vreo legătură cu codul testat.
    */
    /*
      `VITE_API_URL` se golește pentru teste.

      Vitest încarcă `.env.local` la fel ca Vite, iar `@/api` alege
      implementarea după această variabilă. Odată legată aplicația de backend-ul
      real, întreaga suită — scrisă împotriva datelor din memorie — ar fi
      început să trimită cereri HTTP către serverul de dezvoltare: teste lente,
      care pică fără el pornit și care murdăresc baza când este pornit.

      Testul care chiar vorbește cu serverul (`src/api/http/client.live.test.ts`)
      își construiește singur clientul și citește altă variabilă, `API_LIVE`.
    */
    env: { NODE_ENV: 'test', VITE_API_URL: '' },
  },
})
