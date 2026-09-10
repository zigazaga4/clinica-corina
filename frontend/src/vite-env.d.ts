/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Adresa serverului. Absentă => aplicația rulează pe date demo, în memorie.
   * Vezi @/api/index.ts.
   */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
