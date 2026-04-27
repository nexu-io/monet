/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MONET_CONTROLLER_URL?: string;
  readonly VITE_MONET_CONTROLLER_BEARER_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
