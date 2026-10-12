import { statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * One parsed session file, shared by the readers that need it in one switch.
 *
 * Opening a session parses the whole JSONL (`SessionManager.open`), and that is
 * the most expensive thing a disk-backed switch does — 40–100ms on a large file,
 * a few milliseconds on a small one. A switch asks for the transcript and for the
 * composer state at the same time, and both used to open the file themselves, so
 * the parse ran twice back to back on the server's only thread.
 *
 * The key is the file's own identity — size plus modification time at nanosecond
 * resolution. A disk read only happens for a session with no live process, and
 * anything that writes to one (a pi process, an external edit) appends or
 * rewrites the file, so a hit is the same bytes. Entries are few and short-lived:
 * this exists to share one switch's parse, not to keep transcripts in memory, so
 * a timer drops each entry when its window closes even if nothing asks again.
 *
 * The manager is handed out **read-only**: the callers here only build a
 * transcript or read the composer figures from it. A writer goes through its own
 * `SessionManager.open`, and its write moves the file, which is exactly what
 * makes this cache miss afterwards.
 */
interface CachedSession {
  manager: SessionManager;
  size: bigint;
  mtimeNs: bigint;
  at: number;
}

/**
 * How long a parse stays reusable, and how many of them to hold.
 *
 * Long enough to cover the two requests a switch fires (they go out in the same
 * commit, milliseconds apart) and a quick A→B→A; short enough that the memory is
 * not kept. A held manager is about the size of the file it parsed — a 30–40MB
 * session is ~100–130MB of entries — so the count and the lifetime are both kept
 * small on purpose: this shares one switch's parse, it is not a transcript cache.
 */
const TTL_MS = 1500;
const MAX_ENTRIES = 2;
const cache = new Map<string, CachedSession>();

/** Test seam: forget every parsed file. */
export function resetSessionOpenCache(): void {
  cache.clear();
}

/**
 * Open a session file for reading, reusing a recent parse of the same bytes.
 *
 * Synchronous on purpose: both callers derive their answer in one pass and the
 * route handlers are the only await points. Keeping it sync also means the two
 * requests cannot interleave inside one parse.
 */
export function openSessionForRead(sessionPath: string): SessionManager {
  const stat = statSync(sessionPath, { bigint: true, throwIfNoEntry: false });
  if (stat === undefined) {
    // No file to key on. `open()` is pi's open-or-create path and a file it just
    // created is not something a second reader should be handed.
    return SessionManager.open(sessionPath);
  }

  const now = Date.now();
  const hit = cache.get(sessionPath);
  if (
    hit !== undefined &&
    hit.size === stat.size &&
    hit.mtimeNs === stat.mtimeNs &&
    now - hit.at < TTL_MS
  ) {
    // Touch for the eviction order: the file read again is the one worth keeping.
    cache.delete(sessionPath);
    cache.set(sessionPath, hit);
    return hit.manager;
  }

  const manager = SessionManager.open(sessionPath);
  cache.delete(sessionPath);
  cache.set(sessionPath, { manager, size: stat.size, mtimeNs: stat.mtimeNs, at: now });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  setTimeout(() => {
    const entry = cache.get(sessionPath);
    if (entry !== undefined && Date.now() - entry.at >= TTL_MS) cache.delete(sessionPath);
  }, TTL_MS).unref();
  return manager;
}
