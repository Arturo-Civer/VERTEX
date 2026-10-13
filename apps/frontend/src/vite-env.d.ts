/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL (default http://localhost:3000) */
  readonly VITE_API_URL?: string;
  /** "true" on Netlify: login against the VITE_DEMO_* credentials, no backend */
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_DEMO_EMAIL?: string;
  readonly VITE_DEMO_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
