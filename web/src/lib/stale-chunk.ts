/**
 * Recovering from a dynamic import that named a file which is gone.
 *
 * The desktop shell serves `<repo>/web/dist` — a directory every `pnpm build`
 * rewrites, fingerprints and all — so a window opened before a build holds a
 * chunk list that no longer exists on disk. The request for the old
 * `/assets/<name>-<hash>.js` then lands on the static handler's SPA fallback,
 * which answers `200 text/html`; the browser reports the module as unusable,
 * `React.lazy` rejects, and a render error unmounts whatever boundary is above
 * it. Reloading is the whole fix: `index.html` is served `no-cache`, so the
 * next load carries the current fingerprints.
 *
 * This is deliberately the recovery for *any* import failure, not only the one
 * that was diagnosed — a proxy that ate a request and a build that moved a file
 * are indistinguishable from inside the page, and one reload is the right
 * answer to both.
 */

/**
 * The chunk whose import failed last, so a page that comes back still broken
 * does not reload forever.
 *
 * `sessionStorage` rather than a module variable: the reload throws the module
 * away, and the marker has to outlive exactly one load. It is also scoped per
 * tab, which is the right blast radius — another window is not the one that
 * failed.
 */
const MARKER = "pi-web-simple:stale-chunk";

/**
 * Reload the page if this chunk's import has not already cost a reload.
 *
 * Returns whether the reload was started. `false` means the caller should let
 * its error through: either this chunk already used its one reload, or storage
 * is unavailable and reloading would risk a loop that no marker can stop.
 */
export function reloadOnceForStaleChunk(tag: string): boolean {
  try {
    if (sessionStorage.getItem(MARKER) === tag) return false;
    sessionStorage.setItem(MARKER, tag);
  } catch {
    // Private mode, storage disabled, or a partitioned context. Without a
    // marker a reload could repeat forever, so the error surfaces instead.
    return false;
  }
  reloadPage();
  return true;
}

/** Reload the whole document. The one action that refetches every fingerprint. */
export function reloadPage(): void {
  location.reload();
}
