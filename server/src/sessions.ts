import { link, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { TITLE_FALLBACK_WORDS, TITLE_MAX_BYTES } from "./config.ts";
import { getSessionOverrides } from "./projects.ts";
import type { SessionOverride } from "./store.ts";
import { clipPreview, clipTitle, fallbackTitle } from "./title-text.ts";

export type TitleSource = "session" | "firstMessage" | "fallback";

export interface SessionView {
  /** Absolute path of pi's JSONL session file. Serves as the session identity. */
  path: string;
  id: string;
  cwd: string;
  title: string;
  titleSource: TitleSource;
  /** First user message, collapsed and clipped; empty when the session has none. */
  preview: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  hidden: boolean;
}

/**
 * A session as it comes off the file: everything but `hidden`, which belongs to
 * this UI's store rather than to pi's log and is applied per read.
 */
type DerivedSessionView = Omit<SessionView, "hidden">;

const PREVIEW_MAX_CHARACTERS = 200;

/**
 * A skill command, before and after pi clipped it.
 *
 * pi resolves `/skill:<name> [args]` before the message is stored, so a session
 * opened with a skill command has the skill's entire SKILL.md as its first
 * message — and would be titled with a page of someone's markdown. dsh stores
 * the literal command and shows `/git-commit`; folding pi's expansion back to
 * the same command is what keeps the list readable.
 */
const SKILL_BLOCK =
  /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/;
/** The same block once it has been clipped to a title or preview length. */
const SKILL_PREFIX = /^<skill name="([^"]+)"/;

function foldSkillCommand(text: string): string {
  const block = SKILL_BLOCK.exec(text);
  const name = block?.[1] ?? SKILL_PREFIX.exec(text)?.[1];
  if (name === undefined) return text;
  const args = block?.[2]?.trim();
  return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}

/**
 * Title precedence: the session's own name, then its first user message. The
 * name is a `session_info` entry in pi's own JSONL — written by pi's `/name`,
 * by this UI (see `session-title.ts`), or by automatic titling — so the CLI
 * and the Web UI read the same fact. The fallback keeps unnamed empty sessions
 * addressable.
 *
 * The skill fold runs first and on the raw text: its pattern reads the block's
 * own line structure, which cleaning would have collapsed away.
 */
function deriveTitle(info: SessionInfo): {
  title: string;
  titleSource: TitleSource;
} {
  const sessionName = info.name?.trim();
  if (sessionName) return { title: clipTitle(sessionName, TITLE_MAX_BYTES), titleSource: "session" };

  const first = fallbackTitle(
    foldSkillCommand(info.firstMessage),
    TITLE_FALLBACK_WORDS,
    TITLE_MAX_BYTES,
  );
  if (first) return { title: first, titleSource: "firstMessage" };

  return { title: `Session ${info.id.slice(0, 8)}`, titleSource: "fallback" };
}

function toDerivedView(info: SessionInfo): DerivedSessionView {
  const { title, titleSource } = deriveTitle(info);
  return {
    path: info.path,
    id: info.id,
    cwd: info.cwd,
    title,
    titleSource,
    preview: clipPreview(foldSkillCommand(info.firstMessage), PREVIEW_MAX_CHARACTERS),
    parentSessionPath: info.parentSessionPath,
    created: info.created.toISOString(),
    modified: info.modified.toISOString(),
    messageCount: info.messageCount,
  };
}

export function toSessionView(
  info: SessionInfo,
  override: SessionOverride | undefined,
): SessionView {
  return { ...toDerivedView(info), hidden: override?.hidden === true };
}

interface FileStamp {
  size: number;
  mtimeMs: number;
}

/**
 * What pi said about one file, and the stamp that answer was read from.
 *
 * `view` is null when pi's listing skipped the file: a first entry that is not a
 * session banner, a file with no parseable entries at all, or — in a directory
 * pi filters by cwd — a session that belongs to another project.
 */
interface CachedFile {
  stamp: FileStamp;
  view: DerivedSessionView | null;
}

/**
 * Parsed session metadata, keyed by the session directory and the project it
 * was read for, then by file name.
 *
 * Listing a workspace costs it its whole history, not the handful of rows the
 * sidebar draws: pi streams every JSONL file in the directory to count messages
 * and pick out the first user message. Only the file that actually moved needs
 * reading again — the conversation that just grew, the session just created —
 * so each file is cached against its own stamp rather than the whole
 * directory's.
 */
const fileCache = new Map<string, Map<string, CachedFile>>();

/**
 * Reads already in flight, one per directory and project.
 *
 * A read only fills the cache once its files have been parsed, so without this a
 * sidebar that asks several times at once (an expand, a page of rows, a search)
 * would parse the same files several times over.
 */
const runningReads = new Map<string, Promise<void>>();

/**
 * How many files are stat-ed at once while stamping a directory.
 *
 * A workspace can hold thousands of sessions, and an unbounded fan-out would
 * ask the OS for thousands of descriptors at the same moment.
 */
const SIGNATURE_CONCURRENCY = 64;

/**
 * The JSONL files in `dir`, each with the size and mtime pi's answer depends on,
 * or null when the directory does not exist (which is "no sessions" — the same
 * answer pi gives).
 *
 * `SessionManager.list` reads each file top to bottom, so a file that has not
 * moved cannot have a different answer. Stat-ing one costs a fraction of
 * streaming it, which is why the stamps are taken on every request instead of
 * trusting the file watcher: one missed event would otherwise pin a stale list
 * for as long as the process lives.
 *
 * A file that cannot be stat-ed is left out, and so drops out of the listing —
 * the same treatment pi gives a file it cannot open.
 */
async function stampDirectory(dir: string): Promise<Map<string, FileStamp> | null> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    return null;
  }
  const stamps = new Map<string, FileStamp>();
  for (let index = 0; index < names.length; index += SIGNATURE_CONCURRENCY) {
    const batch = names.slice(index, index + SIGNATURE_CONCURRENCY);
    const measured = await Promise.all(
      batch.map(async (name): Promise<readonly [string, FileStamp | null]> => {
        try {
          const info = await stat(join(dir, name));
          return [name, { size: info.size, mtimeMs: info.mtimeMs }];
        } catch {
          return [name, null];
        }
      }),
    );
    for (const [name, stamp] of measured) {
      if (stamp !== null) stamps.set(name, stamp);
    }
  }
  return stamps;
}

/**
 * Have pi parse just the files whose stamps moved.
 *
 * pi answers for a directory in one call, and it owns the meaning of a session
 * file — `buildSessionInfo` is not exported, so picking the fields out of the
 * entries here would be a second implementation to keep in step with pi's. The
 * moved files are linked into a scratch directory instead, and pi is pointed at
 * that: a directory holding exactly what changed.
 *
 * Returns null when the scratch directory cannot answer for every file put in
 * it, which is the caller's cue to read the real directory. Two things reach
 * that: pi filters a directory it did not derive from the project by the
 * session's own cwd, so a session belonging to another project (or an old one
 * with no cwd at all) goes missing; and a link cannot always be made — a symlink
 * wants developer mode on Windows, a hard link wants a single volume.
 */
async function parseMovedFiles(
  projectPath: string,
  dir: string,
  names: string[],
  signal: AbortSignal | undefined,
): Promise<Map<string, DerivedSessionView> | null> {
  const scratch = await mkdtemp(join(tmpdir(), "pi-web-simple-sessions-"));
  try {
    for (const name of names) {
      const source = join(dir, name);
      const destination = join(scratch, name);
      try {
        await symlink(source, destination);
      } catch {
        // The same file under a second name, for platforms that refuse to make
        // the first kind of link.
        await link(source, destination);
      }
    }
    const infos = await SessionManager.list(projectPath, scratch, undefined, signal);
    const byName = new Map(infos.map((info) => [basename(info.path), info]));
    const parsed = new Map<string, DerivedSessionView>();
    for (const name of names) {
      const info = byName.get(name);
      if (info === undefined) return null;
      // pi reports the scratch path; the session's own path is the real one.
      parsed.set(name, { ...toDerivedView(info), path: join(dir, name) });
    }
    return parsed;
  } catch {
    return null;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Read the whole directory through pi and re-stamp the cache from its answer.
 *
 * This is the call the cache exists to avoid, and also the authority that
 * settles what `parseMovedFiles` could not: a file pi skips is remembered as
 * "no session here", so it is not sent back through pi on every later request.
 */
async function readWholeDirectory(
  projectPath: string,
  dir: string,
  stamps: Map<string, FileStamp>,
  cached: Map<string, CachedFile>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const infos = await SessionManager.list(projectPath, dir, undefined, signal);
  const byName = new Map(infos.map((info) => [basename(info.path), info]));
  for (const [name, stamp] of stamps) {
    const info = byName.get(name);
    cached.set(name, { stamp, view: info === undefined ? null : toDerivedView(info) });
  }
}

/** Parsed sessions for one directory, reading again only the files that moved. */
async function deriveFromDirectory(
  key: string,
  projectPath: string,
  dir: string,
  signal: AbortSignal | undefined,
): Promise<DerivedSessionView[]> {
  const stamps = await stampDirectory(dir);
  if (stamps === null) {
    fileCache.delete(key);
    return [];
  }

  const cached = fileCache.get(key) ?? new Map<string, CachedFile>();
  fileCache.set(key, cached);
  // The directory, not the cache, decides which sessions exist: a deleted file
  // would otherwise keep its row in the sidebar for the life of the process.
  for (const name of [...cached.keys()]) {
    if (!stamps.has(name)) cached.delete(name);
  }

  const moved: string[] = [];
  for (const [name, stamp] of stamps) {
    const entry = cached.get(name);
    const changed =
      entry === undefined || entry.stamp.size !== stamp.size || entry.stamp.mtimeMs !== stamp.mtimeMs;
    if (changed) moved.push(name);
  }

  if (moved.length > 0) {
    // A directory whose files all moved (a first read, or a workspace holding a
    // single session) has nothing to gain from the scratch directory: pi's own
    // listing is both simpler and the authority.
    const parsed =
      moved.length < stamps.size ? await parseMovedFiles(projectPath, dir, moved, signal) : null;
    if (parsed === null) {
      await readWholeDirectory(projectPath, dir, stamps, cached, signal);
    } else {
      for (const [name, view] of parsed) {
        const stamp = stamps.get(name);
        if (stamp !== undefined) cached.set(name, { stamp, view });
      }
    }
  }

  const views: DerivedSessionView[] = [];
  for (const name of stamps.keys()) {
    const view = cached.get(name)?.view;
    if (view) views.push(view);
  }
  return views.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Parsed sessions for one directory, served from the cache when nothing moved. */
async function deriveSessions(
  projectPath: string,
  options: ListSessionsOptions,
): Promise<DerivedSessionView[]> {
  const dir = options.sessionDir;
  // Only the explicit per-project directory gets a cache entry: pi's own default
  // layout is a different shape, and the server always names the directory it
  // wants (see `session-path.ts`).
  if (dir === undefined) {
    const infos = await SessionManager.list(projectPath, undefined, undefined, options.signal);
    return infos.map(toDerivedView);
  }

  // Keyed by the pair, not the directory alone: the answer is filtered by the
  // project's own cwd, so two projects pointed at one directory must not share
  // an entry.
  const key = `${dir}\n${projectPath}`;
  const running = runningReads.get(key);
  // Wait for the read in flight and answer from what it cached, rather than
  // sharing its promise: the files it was asked about are not necessarily the
  // ones this caller needs.
  if (running !== undefined) await running.catch(() => {});

  const read = deriveFromDirectory(key, projectPath, dir, options.signal);
  const settled = read.then(
    () => {},
    () => {},
  );
  runningReads.set(key, settled);
  void settled.then(() => {
    if (runningReads.get(key) === settled) runningReads.delete(key);
  });
  return read;
}

export interface ListSessionsOptions {
  /** Override pi's session storage root. Tests use this to stay hermetic. */
  sessionDir?: string;
  includeHidden?: boolean;
  /** How many visible sessions to return, newest first. Omitted means all. */
  limit?: number;
  /**
   * A session path that must be in the result even when it sorts past `limit`.
   *
   * The sidebar draws one page of rows but still needs the metadata of the
   * conversation on screen; without this, an old session opened from elsewhere
   * would have no title until the user paged down to it.
   */
  focus?: string;
  signal?: AbortSignal;
}

/** One page of a workspace's sessions, and how many the workspace has. */
export interface SessionListPage {
  sessions: SessionView[];
  /** Visible sessions before `limit` narrowed the list. */
  total: number;
}

/**
 * Sessions for a project are derived from pi's own storage rather than
 * mirrored into our store, so the Web UI and the `pi` CLI always agree.
 * Ordering is "last updated", matching dsh's default session view.
 *
 * A page and its total come back together because the sidebar needs both: it
 * draws a handful of rows and offers the rest behind "show more", so the count
 * is what it labels that button with, and it never has to hold the whole list.
 */
export async function listSessions(
  projectPath: string,
  options: ListSessionsOptions = {},
): Promise<SessionListPage> {
  const [derived, overrides] = await Promise.all([
    deriveSessions(projectPath, options),
    getSessionOverrides(),
  ]);

  const views = derived.map((view) => ({
    ...view,
    hidden: overrides[view.path]?.hidden === true,
  }));
  const visible = options.includeHidden === true ? views : views.filter((view) => !view.hidden);

  const sessions = options.limit === undefined ? visible : visible.slice(0, options.limit);
  const focus = options.focus;
  if (options.limit !== undefined && focus !== undefined) {
    // The open conversation stays addressable whichever page the sidebar shows.
    if (!sessions.some((view) => view.path === focus)) {
      const found = visible.find((view) => view.path === focus);
      if (found !== undefined) sessions.push(found);
    }
  }
  return { sessions, total: visible.length };
}
