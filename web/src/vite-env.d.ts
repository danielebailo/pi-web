/// <reference types="vite/client" />

/**
 * The version of this web UI, replaced at build time by `define` in
 * `vite.config.ts` (the value comes from the repository root `package.json`).
 *
 * A fallback, not the source: the 项目版本 row shows what the *server* read from
 * that same file, because only the server's copy can be compared against npm
 * and re-read after an in-place update.
 */
declare const __APP_VERSION__: string;
