/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SONORA_REPOSITORY?: "local" | "api" | string;
  readonly VITE_SONORA_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
