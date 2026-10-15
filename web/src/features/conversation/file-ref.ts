/**
 * A file a transcript points at, and where in it.
 *
 * Two shapes reach this module, and they are the two dsh's Markdown renderer
 * accepts — nothing else. A *link* is authored deliberately
 * (`[the loader](src/app.ts#L24-L30)`), and an inline-code *token* is what an
 * agent writes when it names a file in a sentence (`` `src/app.ts:24-30` ``).
 * A bare path in prose is not a third shape: it cannot be told apart from a
 * sentence that happens to contain a slash, and every attempt to do so turns
 * ordinary text into a control.
 *
 * Pure text in, a target out. Nothing here knows what files exist — the
 * vocabulary that decides whether a token names a real file lives with the turn
 * (`turn-refs.ts`), which is what keeps the renderer from guessing. What this
 * module owns is the *spelling*: which characters can be a path, which can be a
 * line, and which of them are a security or parsing problem rather than a
 * reference.
 */

/** One file reference, as the transcript spelled it. */
export interface FileRef {
  /** The path the reference names — absolute, or relative to the project. */
  path: string;
  /** First line to reveal, when the reference carries one. */
  line?: number;
  /** Last line of a range; equal to `line` for a single-line reference. */
  endLine?: number;
}

/**
 * Longest span a reference may highlight.
 *
 * A chip is a way into a file, not a selection to be reproduced, and a model that
 * writes `:1-100000` would otherwise ask the preview to paint a whole file. The
 * cap is applied to the end rather than refusing the reference, so the head the
 * reader wanted is still reachable.
 */
const MAX_SPAN_LINES = 500;

/**
 * A trailing `:24` or `:24-30`.
 *
 * Anchored at the end and requiring digits throughout, which is what keeps a
 * legitimate colon inside a name (`weird:file.txt`, `report:final`) from being
 * read as a line number: the colon must be followed by nothing but the digits
 * to the end of the token.
 */
const LINE_SUFFIX_RE = /:(\d+)(?:-(\d+))?$/;

/**
 * A Windows drive prefix — `C:/x` or `C:\x`.
 *
 * The one single-letter scheme a path is allowed to look like. Everything else
 * with a colon (`javascript:`, `data:`, `vbscript:`) is a URL this renderer must
 * never turn into something clickable.
 */
const DRIVE_RE = /^[a-z]:[\\/]/i;

/**
 * Anything that looks like a URL scheme rather than a path.
 *
 * Checked on the *decoded* path, so `javascript%3Aalert` does not slip through a
 * link the browser would then navigate to.
 */
const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

/** Decode a Markdown destination, or undefined when its escapes are malformed. */
function decode(destination: string): string | undefined {
  try {
    return decodeURIComponent(destination);
  } catch {
    // `%zz` names no file unambiguously; guessing at it would be worse than
    // leaving the link as plain text.
    return undefined;
  }
}

/**
 * `./src/app.ts` and `src/app.ts` name the same file, so they must also compare
 * equal — a reference is matched textually against a turn's paths.
 *
 * Only a leading dot-slash: `../docs/a.md` is a different file from `docs/a.md`,
 * and a colon or a drive letter is nobody's prefix.
 */
function normalizeDotSlash(path: string): string {
  return path.replace(/^(\.\/)+/, "");
}

/**
 * Whether a decoded string can be a path at all.
 *
 * Rejects the empty string, control characters (a newline in a path is a
 * renderer's problem, not a file's), UNC and protocol-relative forms (`//host`
 * is somebody else's machine), and every URL scheme but a Windows drive.
 */
function isPathShaped(path: string): boolean {
  if (path.length === 0) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (/^[\\/]{2}/.test(path)) return false;
  if (SCHEME_RE.test(path) && !DRIVE_RE.test(path)) return false;
  return true;
}

/** Clamp a parsed line pair, and collapse a one-line range into `line` alone. */
function lineRange(line: number, endLine: number | undefined): Pick<FileRef, "line" | "endLine"> | undefined {
  if (!Number.isSafeInteger(line) || line < 1) return undefined;
  const end = endLine === undefined ? line : endLine;
  if (!Number.isSafeInteger(end) || end < line) return undefined;
  return { line, endLine: Math.min(end, line + MAX_SPAN_LINES) };
}

/**
 * The file a Markdown link destination names.
 *
 * The GitHub-style fragment (`#L24`, `#L24-L30`) is the only anchor understood,
 * and a destination carrying a query (`?plain=1`) is refused outright rather
 * than stripped: this is a link into a workspace file, and a `?` there means the
 * author meant one of the hosted-forge conventions this app does not implement.
 * Refusing it leaves the label readable instead of opening the wrong thing.
 *
 * @param value - The link destination exactly as Markdown parsed it.
 * @returns The reference, or undefined when it names no local file.
 */
export function parseFileTarget(value: string): FileRef | undefined {
  const hash = value.indexOf("#");
  const destination = hash < 0 ? value : value.slice(0, hash);
  if (destination.includes("?")) return undefined;
  const path = decode(destination);
  if (path === undefined || !isPathShaped(path)) return undefined;
  const normalized = normalizeDotSlash(path);
  if (hash < 0) return { path: normalized };
  const match = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(value.slice(hash + 1));
  if (match === null) return undefined;
  const range = lineRange(Number(match[1]), match[2] === undefined ? undefined : Number(match[2]));
  if (range === undefined) return undefined;
  return { path: normalized, ...range };
}

/**
 * Whether an inline-code token is spelled like a file rather than like code.
 *
 * A token has to look like a path to be worth resolving at all: either it
 * carries a separator, or it carries an extension. `foo` and `length` are code,
 * `src/app.ts` and `README.md` are candidates — and being a candidate is all
 * this decides, because the turn's vocabulary has the last word.
 */
function looksLikePath(path: string): boolean {
  // A trailing separator names a folder. The draft's own references cover
  // folders (`reference-token.ts`); a chip here opens a file, so a folder is
  // not a candidate.
  if (/[/\\]$/.test(path)) return false;
  if (path.includes("/") || path.includes("\\")) return true;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return /^[^./][^/]*\.[A-Za-z\d]+$/.test(last);
}

/**
 * The file an inline-code token names.
 *
 * Both spellings an agent reaches for are accepted — the `#L24-L30` fragment a
 * model copies from a forge URL, and the `:24-30` suffix the pi TUI prints in
 * its own file references. There is deliberately no bare `:24` form without a
 * colon-versus-drive ambiguity to resolve: `C:/x.ts` is a path, and the suffix
 * is only read from the last colon, so a drive letter can never be mistaken for
 * a line.
 *
 * @param token - The inline-code text, exactly as authored.
 * @returns The reference, or undefined when the token is ordinary code.
 */
export function parsePathToken(token: string): FileRef | undefined {
  // Whitespace inside inline code means it is a snippet, not a path; a token
  // that *starts* with space is how a model pads a fence label.
  if (token !== token.trim() || /\s/.test(token)) return undefined;
  if (token.includes("://")) return undefined;
  if (token.includes("#")) return parseFileTarget(token);

  const match = LINE_SUFFIX_RE.exec(token);
  const raw = match === null ? token : token.slice(0, match.index);
  if (!isPathShaped(raw) || !looksLikePath(raw)) return undefined;
  const path = normalizeDotSlash(raw);
  if (match === null) return { path };
  const range = lineRange(Number(match[1]), match[2] === undefined ? undefined : Number(match[2]));
  if (range === undefined) return undefined;
  return { path, ...range };
}

/** The last segment of a path, either separator — what a chip is named after. */
export function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * What a chip reads.
 *
 * `src/features/rightbar/PreviewTab.tsx:24–30` is the same file a reader sees
 * named in six other places, so the chip says the part that identifies it — the
 * name and the lines — and keeps the directories in its `title`, where they
 * answer "which one?" without taking a line of the answer's width. The range
 * uses an en dash, the same range glyph dsh's file links carry.
 *
 * @param ref - The resolved reference.
 * @returns The chip's label.
 */
export function fileRefLabel(ref: FileRef): string {
  const name = basename(ref.path);
  if (ref.line === undefined) return name;
  const end = ref.endLine === undefined || ref.endLine === ref.line ? "" : `–${String(ref.endLine)}`;
  return `${name}:${String(ref.line)}${end}`;
}

/** The full path and lines a chip shows on hover. */
export function fileRefTitle(ref: FileRef): string {
  if (ref.line === undefined) return ref.path;
  const end = ref.endLine === undefined || ref.endLine === ref.line ? "" : `-${String(ref.endLine)}`;
  return `${ref.path}:${String(ref.line)}${end}`;
}
