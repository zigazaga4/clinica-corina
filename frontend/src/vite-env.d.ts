/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Adresa serverului. Absentă => aplicația rulează pe date demo, în memorie.
   * Vezi @/api/index.ts.
   */
  readonly VITE_API_URL?: string
  /** `true` = prețuri, încasări, produse, statistici, cheltuieli. Vezi @/config/functii. */
  readonly VITE_FUNCTIE_COSTURI?: string
  /** `true` = serviciile în mai multe ședințe (abonamente). Vezi @/config/functii. */
  readonly VITE_FUNCTIE_TRATAMENTE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Versiunea din `package.json`, pusă de Vite la compilare (v. `vite.config.ts`). */
declare const __VERSIUNE_APP__: string
