import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { badRequest, notFound } from "./errors.ts";

const run = promisify(execFile);

/**
 * The file index behind the composer's `@` completion.
 *
 * Completion needs the whole file list, not one directory level, because the
 * user types a *name* (`@useComposer`) rather than walking a tree. That rules
 * out the sidebar's `/api/projects/:id/files` route, which lists one level by
 * design: filling a menu from it would mean a request per keystroke per level.
 *
 * So this module builds a flat list once and answers queries from memory. The
 * source is `git ls-files` where a repository exists, for three reasons: it is
 * one process instead of a full directory walk, it is fast even on a large
 * tree, and its output is already filtered by `.gitignore` — which is the same
 * rule the TUI's `@` completion (and pi's own `fd`) applies, so a file that is
 * invisible to the agent is not offered here either. A directory that is not a
 * repository falls back to a bounded walk: a workspace without git still gets
 * completion, at the price of a depth and entry cap that says so.
 *
 * Everything here is addressed *relative to a project directory*. The route
 * that calls it validates the project against the same allowlist the rest of
 * the file API uses, so the index can never be asked about a path the user
 * could not already browse.
 */

/** Entries a non-git walk will visit before it gives up. */
export const WALK_ENTRY_LIMIT = 20_000;

/** Directory levels a non-git walk descends. */
export const WALK_DEPTH_LIMIT = 8;

/** Indexed entries kept for a git repository (a monorepo is large but finite). */
export const INDEX_ENTRY_LIMIT = 50_000;

/** How long an index is reused. Short: a file created a moment ago should be
 * completable, and the cost of a miss is one `git ls-files`. */
export const INDEX_TTL_MS = 5_000;

/** Candidates a query returns by default, and the most a caller may ask for. */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Directories the fallback walk does not descend into.
 *
 * Not a `.gitignore` parser — that is the thing git already has, and the reason
 * it is the preferred source. This is only the short list that would otherwise
 * dominate a walk with build output and dependencies, none of which is a
 * plausible thing to mention to an agent.
 */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".git",
  ".cache",
  ".turbo",
  ".parcel-cache",
]);

/** One compleable path. */
export interface FileSearchEntry {
  /** Path relative to the project root, always `/`-separated. */
  path: string;
  /** The final segment, which is what the menu lists. */
  name: string;
  type: "directory" | "file";
}

export interface FileSearchResult {
  /** Echoed back so a late response can be matched to the keystroke that asked. */
  query: string;
  items: FileSearchEntry[];
  /** True when more entries matched than the limit allowed. */
  truncated: boolean;
  /**
   * How many entries the index holds, whether they matched or not.
   *
   * Carried because "nothing matched `@zzz`" and "this project has nothing to
   * complete from" are different answers, and an empty list alone cannot tell
   * them apart — a distinction the menu has to make to be useful when it is
   * right and honest when it is not.
   */
  indexed: number;
}

interface CachedIndex {
  at: number;
  entries: FileSearchEntry[];
}

const indexCache = new Map<string, CachedIndex>();

/** Drop every cached index. Exported for tests and for a project removed while
 * the server is running. */
export function resetFileIndexCache(): void {
  indexCache.clear();
}

/**
 * Turn one `git ls-files -z` payload into entries.
 *
 * git reports files only, so directories are derived from their paths: a user
 * typing `@src/` is asking to descend, and a menu that could not offer the
 * directory would make the query look broken rather than empty. Every ancestor
 * of every file is therefore an entry, which is also why this is cheap — the
 * set is bounded by the file list git already produced.
 */
export function expandGitPaths(payload: string): FileSearchEntry[] {
  const directories = new Map<string, FileSearchEntry>();
  const files: FileSearchEntry[] = [];

  for (const record of payload.split("\0")) {
    if (record.length === 0) continue;
    // git prints paths relative to its `-C` directory, but a `./` prefix can
    // appear when a path was given rather than discovered.
    const path = record.startsWith("./") ? record.slice(2) : record;
    // A repository opened from a subdirectory still names paths relative to
    // that subdirectory; anything that escapes it is not ours to complete.
    if (path.length === 0 || path.startsWith("/") || path.startsWith("../")) continue;
    files.push({ path, name: path.slice(path.lastIndexOf("/") + 1), type: "file" });

    let slash = path.lastIndexOf("/");
    while (slash > 0) {
      const directory = path.slice(0, slash);
      if (!directories.has(directory)) {
        directories.set(directory, {
          path: directory,
          name: directory.slice(directory.lastIndexOf("/") + 1),
          type: "directory",
        });
      }
      slash = directory.lastIndexOf("/");
    }
  }

  return [...directories.values(), ...files];
}

/**
 * The score a path earns against a query, or null when it does not match.
 *
 * Ordered the way a completion menu should read: the file's own name first
 * (prefix, then substring), then the whole path (prefix, then substring), and
 * only then a scattered subsequence — `@ucs` finding `useComposerState.ts` is
 * useful, but it must never outrank a name that literally contains the query.
 * Length is subtracted inside each band so that among equals the shorter, more
 * specific path wins: `api.ts` before `server/src/lib/deep/api.ts`.
 *
 * Subsequence matches are scored by the span they cover, which is what makes a
 * contiguous near-miss (`@composerstate`) beat a scattered one.
 */
export function matchScore(path: string, query: string): number | null {
  const needle = query.trim().toLowerCase();
  const haystack = path.toLowerCase();
  if (needle.length === 0) return 0;

  const slash = haystack.lastIndexOf("/");
  const base = slash === -1 ? haystack : haystack.slice(slash + 1);

  if (base.startsWith(needle)) return 1000 - Math.min(base.length, 500);
  const baseAt = base.indexOf(needle);
  if (baseAt >= 0) return 800 - Math.min(base.length, 400) - Math.min(baseAt, 100);
  if (haystack.startsWith(needle)) return 700 - Math.min(haystack.length, 300);
  const pathAt = haystack.indexOf(needle);
  if (pathAt >= 0) return 600 - Math.min(pathAt, 200);

  // A query with a separator can only match a path, never a bare name.
  if (!needle.includes("/")) {
    const baseSpan = subsequenceSpan(base, needle);
    if (baseSpan !== null) return 400 - Math.min(baseSpan, 300);
  }
  const pathSpan = subsequenceSpan(haystack, needle);
  if (pathSpan !== null) return 200 - Math.min(pathSpan, 150);
  return null;
}

/** The width of the narrowest window of `haystack` holding `needle` in order,
 * or null when the characters are not all there in order. */
function subsequenceSpan(haystack: string, needle: string): number | null {
  let from = 0;
  let first = -1;
  let last = -1;
  for (const char of needle) {
    const at = haystack.indexOf(char, from);
    if (at === -1) return null;
    if (first === -1) first = at;
    last = at;
    from = at + 1;
  }
  return last - first + 1;
}

/**
 * The best `limit` entries for a query, best match first.
 *
 * Ties break on directory before file — a query that reached a directory is
 * usually on its way into it — and then on path length, so the shallowest of
 * two equal matches is the one the menu shows.
 */
export function rankEntries(
  entries: readonly FileSearchEntry[],
  query: string,
  limit: number,
): { items: FileSearchEntry[]; truncated: boolean } {
  const scored: { entry: FileSearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const score = matchScore(entry.path, query);
    if (score === null) continue;
    scored.push({ entry, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.entry.type === "directory") - Number(a.entry.type === "directory") ||
      a.entry.path.length - b.entry.path.length ||
      a.entry.path.localeCompare(b.entry.path, "zh", { numeric: true, sensitivity: "base" }),
  );

  return {
    items: scored.slice(0, limit).map((candidate) => candidate.entry),
    truncated: scored.length > limit,
  };
}

/** Every path `git` knows about here, or null when this is not a repository. */
async function gitIndex(root: string): Promise<FileSearchEntry[] | null> {
  try {
    const { stdout } = await run(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        encoding: "utf8",
        env: {
          ...process.env,
          // Observation only: a completion request must never be the reason an
          // index lock appears under a terminal the user has open.
          GIT_OPTIONAL_LOCKS: "0",
          GIT_PAGER: "cat",
          LC_ALL: "C",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
    // Output that overflows the buffer is a truncated list, not a failure: the
    // first `INDEX_ENTRY_LIMIT` entries are still a usable index.
    const entries = expandGitPaths(stdout);
    return entries.slice(0, INDEX_ENTRY_LIMIT);
  } catch {
    // "Not a git repository" is the ordinary case here, not an error worth
    // reporting: most directories a user opens this app in are not repositories.
    return null;
  }
}

/** Walk one directory level and recurse, within the caps. */
async function walkInto(
  directory: string,
  relative: string,
  depth: number,
  budget: { left: number },
  out: FileSearchEntry[],
): Promise<void> {
  if (depth > WALK_DEPTH_LIMIT || budget.left <= 0) return;

  let dirents;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch {
    // An unreadable directory (permissions, a race with a delete) is skipped
    // rather than failing the whole index: a partial menu beats no menu.
    return;
  }

  for (const dirent of dirents) {
    if (budget.left <= 0) return;
    const path = relative.length > 0 ? `${relative}/${dirent.name}` : dirent.name;

    // Symlinks are not followed: the index is a tree, and a link is how a tree
    // becomes a cycle (or a walk out of the project).
    if (dirent.isSymbolicLink()) continue;

    if (dirent.isDirectory()) {
      if (SKIP_DIRECTORIES.has(dirent.name)) continue;
      out.push({ path, name: dirent.name, type: "directory" });
      budget.left -= 1;
      await walkInto(join(directory, dirent.name), path, depth + 1, budget, out);
    } else if (dirent.isFile()) {
      out.push({ path, name: dirent.name, type: "file" });
      budget.left -= 1;
    }
  }
}

/** The fallback index for a directory git does not know about. */
async function walkIndex(root: string): Promise<FileSearchEntry[]> {
  const out: FileSearchEntry[] = [];
  await walkInto(root, "", 0, { left: WALK_ENTRY_LIMIT }, out);
  return out;
}

async function loadIndex(root: string): Promise<FileSearchEntry[]> {
  const cached = indexCache.get(root);
  if (cached !== undefined && Date.now() - cached.at < INDEX_TTL_MS) return cached.entries;

  // A project whose directory has gone (deleted, renamed, an unmounted volume)
  // is a different answer from "no file matched". Both the git call and the
  // walk below would swallow that into an empty list — which is the one answer
  // that would make the menu lie about the user's typing — so it is checked
  // here, where the message still has somewhere to go.
  let info;
  try {
    info = await stat(root);
  } catch {
    throw notFound(`项目目录不存在：${root}`);
  }
  if (!info.isDirectory()) throw badRequest(`不是一个目录：${root}`);

  const entries = (await gitIndex(root)) ?? (await walkIndex(root));
  indexCache.set(root, { at: Date.now(), entries });
  return entries;
}

/**
 * Entries under a project root matching a query.
 *
 * `root` is the project's own directory, already validated by the route. The
 * index is cached per root for `INDEX_TTL_MS`, so a burst of keystrokes costs
 * one `git ls-files` and then nothing.
 */
export async function searchWorkspaceFiles(
  root: string,
  query: string,
  limit: number = DEFAULT_LIMIT,
): Promise<FileSearchResult> {
  const entries = await loadIndex(root);
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || DEFAULT_LIMIT, MAX_LIMIT));
  return { query, indexed: entries.length, ...rankEntries(entries, query, bounded) };
}
