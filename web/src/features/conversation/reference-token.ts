/**
 * Folder references in the message draft: how a path looks inside a sentence,
 * and how one gets there.
 *
 * The reference is the *path itself* — no `@` sigil. pi has no file-reference
 * grammar in RPC mode (`@file` arguments are refused there, and the TUI's `@`
 * completion is an editor feature, not prompt syntax), so a sigil would only be
 * a token the agent has to guess about; `deepseek-harness-master/` is a path
 * the agent can open with the tools it already has. The trailing separator is
 * what marks it as a folder rather than a word that happens to contain a slash.
 *
 * A reference reads as its own last segment (`alpha/`) and travels as the whole
 * path: a chip that spelled `/tmp/pw-probe/alpha/` would eat half the input box
 * for something the user never has to read, and the agent never benefits from
 * the shorter spelling. dsh keeps the two apart the same way — its chip carries
 * a label next to a ref. Here the label *is* the draft text, so the map from
 * label back to path lives beside the draft (see `useReferenceDraft`), and a
 * label that is edited by hand simply stops resolving: the sentence sends what
 * the user sees, which is the only safe failure.
 *
 * Pure text in, ranges out: the editor renders a chip over the ranges and never
 * stores anything but the sentence, so copy, send, and reload all carry the same
 * string.
 */

/** One folder reference inside a draft, as a half-open range. */
export interface ReferenceSpan {
  start: number;
  end: number;
}

/**
 * The glyph slot a dropped reference writes into its own text: an em space for
 * the chip's icon, then a space that keeps the label clear of the glyph.
 *
 * The mirrored layer draws the icon *on top of* those characters rather than
 * beside them, which is what puts the chip's glyph where ordinary text starts
 * instead of hanging it in the card's padding. It also means no part of the
 * layout depends on the em space measuring exactly one icon: the mirror lays
 * out the same characters the textarea does, so the words after a chip stay
 * where the caret expects them whatever the font does with U+2003. A reference
 * the user typed by hand has no slot, and therefore no glyph.
 */
export const REFERENCE_SLOT = "\u2003 ";

/**
 * The sigil that marks a *file* reference.
 *
 * A folder reference is the path itself (`alpha/`) and reads as one; a file
 * reference carries `@`, the same character the completion is triggered by. It
 * is drawn by the mirror and expanded on send, so the sentence the user reads
 * and the sentence pi receives both say which word was a reference rather than
 * a file that happens to share a name.
 */
export const FILE_SIGIL = "@";

/**
 * Characters a token may follow to have a boundary in front of it: the draft's
 * own start, whitespace, an opening bracket or quote, and the CJK punctuation
 * that ends a clause without a space.
 *
 * Spelled out rather than written as `\s` because the em space in
 * `REFERENCE_SLOT` is whitespace to a regex: a caret placed inside a chip sits
 * right after an em space, and a `@` found there must not read as the start of
 * a new token.
 */
export const TOKEN_OPENER = /[ \t\n\r([{"'「『（【《，。；：！？、]/;

/**
 * A run of non-space characters ending in a separator, at the draft start or
 * after whitespace — dsh's folder-token shape, minus its `@`. Two boundaries
 * do the work the sigil used to: the leading one keeps a slash inside a word
 * (`and/or`) out, and the trailing one keeps a slash that is merely a word's
 * first half (`and/or` again) from ending a token early. Without `@` there is
 * nothing else to lean on, so both are load-bearing rather than tidy.
 */
const REFERENCE_RE = /(^|\s)([^\s"]+\/)(?=\s|$)/g;

/**
 * A reference a drop wrote: its glyph slot, then the label — and no trailing
 * boundary, because the user may keep typing straight into the name
 * (`alpha/x`). Nothing hand-typed can look like this: the slot is an em space,
 * which no one types as part of a path.
 *
 * The lookahead keeps the two slot forms apart: a file reference is a slot
 * followed by the sigil, and without it `@api/` would be read as a folder
 * reference whose label happens to begin with `@`.
 */
const SLOTTED_RE = new RegExp(`${REFERENCE_SLOT}(?!@)([^\\s"]+\\/)`, "g");

/**
 * A *file* reference a completion wrote: the slot, the sigil, then the label —
 * quoted when the label itself has a space in it, which is the one case where
 * the token cannot simply end at whitespace.
 */
const SLOTTED_FILE_RE = new RegExp(`${REFERENCE_SLOT}\\${FILE_SIGIL}("[^"]+"|[^\\s"]+)`, "g");

/**
 * Every folder reference in a draft, in draft order.
 *
 * Two passes, because the two kinds answer to different boundaries. A slotted
 * reference is one a drop wrote, so it holds even when the sentence runs
 * straight on into it; a hand-typed one needs whitespace on both sides or
 * `and/or` would be a folder. A URL is neither: it ends in a separator and sits
 * after whitespace, and a chip over it would be a folder glyph on a web
 * address.
 */
export function referenceSpans(text: string): ReferenceSpan[] {
  const spans: ReferenceSpan[] = [];

  // Both slot forms, which are written by an insertion rather than typed and
  // therefore hold wherever they are found. A file reference and a folder one
  // cannot overlap: the lookahead above sends `@…` to this pass only.
  for (const pattern of [SLOTTED_RE, SLOTTED_FILE_RE]) {
    pattern.lastIndex = 0;
    let slotted: RegExpExecArray | null;
    while ((slotted = pattern.exec(text)) !== null) {
      const token = slotted[1] ?? "";
      if (token.includes("://")) continue;
      spans.push({ start: slotted.index, end: slotted.index + slotted[0].length });
    }
  }

  REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(text)) !== null) {
    const token = match[2] ?? "";
    if (token.includes("://")) continue;
    const start = match.index + (match[1]?.length ?? 0);
    if (spans.some((span) => start >= span.start && start < span.end)) continue;
    spans.push({ start, end: match.index + match[0].length });
  }
  return spans.sort((left, right) => left.start - right.start);
}

/**
 * Put one reference at the caret, replacing whatever the textarea had selected.
 *
 * Whitespace is added on whichever side needs it so the token keeps the leading
 * boundary `referenceSpans` requires and does not glue onto the next word; at
 * the draft's own edges nothing is added, because a leading space would be a
 * change the user did not make.
 * @returns the new draft and where the caret belongs in it.
 */
export function referenceInsertion(
  text: string,
  start: number,
  end: number,
  reference: string,
): { text: string; caret: number } {
  return slotInsertion(text, start, end, withTrailingSlash(reference));
}

/**
 * Put one *file* reference (a `token` already carrying its sigil) at the caret.
 *
 * The same insertion as a folder drop's, minus the trailing separator a folder
 * needs: the token was built by `fileToken` and is inserted exactly as spelled.
 */
export function fileReferenceInsertion(
  text: string,
  start: number,
  end: number,
  token: string,
): { text: string; caret: number } {
  return slotInsertion(text, start, end, token);
}

/**
 * Write a chip at the caret, replacing whatever the textarea had selected.
 *
 * Whitespace is added on whichever side needs it so the token keeps the leading
 * boundary `referenceSpans` requires and does not glue onto the next word; at
 * the draft's own edges nothing is added, because a leading space would be a
 * change the user did not make.
 * @returns the new draft and where the caret belongs in it.
 */
function slotInsertion(
  text: string,
  start: number,
  end: number,
  token: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  // A bracket or a quote is already a boundary, so no space is added in front
  // of a chip that opens inside one — `(@api.ts` stays as the user wrote it.
  const lead = before === "" || TOKEN_OPENER.test(before.slice(-1)) ? "" : " ";
  // A chip always ends with a space, the way dsh's does — its insertion reuses
  // a space that is already there and adds one that is not. The caret lands
  // after it, so whatever is typed next starts a word instead of running into
  // the label.
  const tail = /^\s/.test(after) ? "" : " ";
  const inserted = `${REFERENCE_SLOT}${token}`;
  return {
    text: `${before}${lead}${inserted}${tail}${after}`,
    caret: start + lead.length + inserted.length + tail.length,
  };
}

/**
 * The label a chip token stands for: the token without its sigil and without
 * the quotes a label with spaces is written in.
 *
 * Used to compare tokens against the labels a mint would produce — a folder's
 * `alpha/` against a label, a file's `@api.ts` against the name `api.ts` — so a
 * chip never collides with a reference already in the draft.
 */
export function tokenLabel(token: string): string {
  const body = token.startsWith(FILE_SIGIL) ? token.slice(FILE_SIGIL.length) : token;
  if (body.length >= 2 && body.startsWith('"') && body.endsWith('"')) return body.slice(1, -1);
  return body;
}

/**
 * The token a file reference is spelled with: the sigil and the label, quoted
 * when the label contains a space or a quote.
 *
 * Quoting is the same answer the TUI's completion gives for the same reason: a
 * path is written inside a sentence, and a sentence ends a word at whitespace.
 */
export function fileToken(label: string): string {
  return needsQuotes(label) ? `${FILE_SIGIL}"${label}"` : `${FILE_SIGIL}${label}`;
}

/** Whether a path has to be quoted to survive being written in a sentence. */
export function needsQuotes(path: string): boolean {
  return /[\s"']/.test(path);
}

/**
 * Where an insertion should start replacing.
 *
 * A completion's token begins at its `@`, but a chip standing there already
 * owns the glyph slot in front of that sigil — so a pick that narrows an
 * existing reference has to take the slot with it, or the draft keeps the old
 * one and grows an orphan glyph. Hand-typed text has no slot, and the `at`
 * index is then returned unchanged.
 */
export function referenceStartAt(value: string, at: number): number {
  if (at < REFERENCE_SLOT.length) return at;
  return value.startsWith(REFERENCE_SLOT, at - REFERENCE_SLOT.length)
    ? at - REFERENCE_SLOT.length
    : at;
}

/**
 * The shortest tail of a *file* path that nothing else already spells.
 *
 * The same walk outward as `referenceLabel`, minus the trailing separator: a
 * file reference reads as its own name (`api.ts`), and only a second file of
 * the same name makes the label grow a directory.
 */
export function fileLabel(path: string, taken: ReadonlySet<string>): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) return path;
  for (let take = 1; take <= segments.length; take += 1) {
    const label = segments.slice(-take).join("/");
    if (!taken.has(label)) return label;
  }
  return trimmed;
}

/**
 * The reference the caret is about to delete, or null.
 *
 * A chip is atomic in dsh's editor — a decorator node with no keyboard-
 * selectable state, so Backspace takes the whole thing in one keystroke rather
 * than walking into it. The same reading applies to these characters: a caret
 * anywhere inside a reference, or against the edge the keystroke is coming
 * from, takes all of it. `back` is Backspace (at or inside the end), `forward`
 * is Delete (at or inside the start) — a caret merely *beside* the chip in the
 * direction of travel belongs to the text next to it.
 */
export function referenceAtCaret(
  text: string,
  caret: number,
  direction: "back" | "forward",
): ReferenceSpan | null {
  for (const span of referenceSpans(text)) {
    const inside = direction === "back"
      ? caret > span.start && caret <= span.end
      : caret >= span.start && caret < span.end;
    if (inside) return span;
  }
  return null;
}

/** A path spelled as a folder reference, which is to say with its separator. */
export function withTrailingSlash(path: string): string {
  if (path.endsWith("/") || path.endsWith("\\")) return path;
  // A Windows spelling keeps its own separator; anything else gets `/`, which
  // both platforms' file tools read.
  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  return `${path}${separator}`;
}

/**
 * The shortest tail of a path that nothing else already spells.
 *
 * The last segment is the readable answer and the one that answers almost
 * every drop; a second folder of the same name is why this walks outward one
 * segment at a time instead of giving up. `taken` holds both the labels already
 * standing for other drops and the reference-shaped words the user typed, so a
 * label can never be minted that would later expand someone else's sentence —
 * the fallback is the whole path, which cannot collide with anything.
 */
export function referenceLabel(path: string, taken: ReadonlySet<string>): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0) return path;
  for (let take = 1; take <= segments.length; take += 1) {
    const label = `${segments.slice(-take).join("/")}/`;
    if (!taken.has(label)) return label;
  }
  return `${trimmed}/`;
}

/**
 * The label a drop should use: the spelling the same path already has, or the
 * shortest free one.
 *
 * Reuse matters because a drop is not a declaration — dropping the same folder
 * twice is one reference, not two spellings of it, and a draft that alternated
 * between `alpha/` and `pw-probe/alpha/` for the same directory would look like
 * the user meant something by the difference.
 */
export function referenceLabelFor(
  path: string,
  references: ReadonlyMap<string, string>,
  taken: ReadonlySet<string>,
): string {
  for (const [label, value] of references) {
    if (value === path) return label;
  }
  return referenceLabel(path, taken);
}

/**
 * The sentence as it should be sent: every label standing in for a path, put
 * back as that path. A reference-shaped word no drop inserted — or one the user
 * edited since — is left exactly as written.
 */
export function expandReferences(
  text: string,
  references: ReadonlyMap<string, string>,
): string {
  let out = text;
  if (references.size > 0) {
    out = "";
    let cursor = 0;
    for (const span of referenceSpans(text)) {
      const raw = text.slice(span.start, span.end);
      const token = raw.startsWith(REFERENCE_SLOT) ? raw.slice(REFERENCE_SLOT.length) : raw;
      const path = references.get(token);
      if (path === undefined) continue;
      out += text.slice(cursor, span.start) + expandToken(token, path);
      cursor = span.end;
    }
    if (cursor > 0) out += text.slice(cursor);
    else out = text;
  }
  // A slot whose label was edited away no longer stands for anything, and the
  // whitespace it holds must not ride into the message.
  return out.includes(REFERENCE_SLOT) ? out.split(REFERENCE_SLOT).join("") : out;
}

/**
 * What one reference becomes in the sentence that is sent.
 *
 * A folder reference is its path. A file reference keeps the sigil, because
 * that is what makes the pointer read as a pointer — and writes the path quoted
 * when the path itself contains a space, so the sentence pi receives still has
 * one unambiguous reference in it rather than two words where a path was.
 */
function expandToken(token: string, target: string): string {
  if (!token.startsWith(FILE_SIGIL)) return target;
  return needsQuotes(target) ? `${FILE_SIGIL}"${target}"` : `${FILE_SIGIL}${target}`;
}

/**
 * An absolute path shortened against the workspace root, for a reference the
 * agent can resolve from its own cwd.
 *
 * Outside the workspace the absolute path is kept: a `../` chain would be one
 * jump for the agent but a wrong one the moment the workspace moves, and the
 * absolute spelling is what dsh inserts in the same case. The workspace root
 * itself is kept too — its relative spelling is the empty string.
 */
export function relativeReference(path: string, root: string | null | undefined): string {
  if (!root) return path;
  const trimmed = root.replace(/[/\\]+$/, "");
  if (trimmed === "" || path === trimmed) return path;
  if (!path.startsWith(`${trimmed}/`) && !path.startsWith(`${trimmed}\\`)) return path;
  return path.slice(trimmed.length + 1);
}
