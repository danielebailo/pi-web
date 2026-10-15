/**
 * Pure diff-card derivation from raw file-mutation calls.
 *
 * Ported from dsh's `diff-card-model.ts` + `DiffBlock.tsx` row machinery,
 * narrowed to what pi's tools offer: dsh additionally reads applied hunks out
 * of its own server's result metadata (`meta.diffs`), which pi does not
 * produce — pi's edit result carries display strings
 * (`details.diff`/`details.patch`) instead, and parsing a unified patch back
 * into hunks would lose exactly the context the card is allowed to show. So
 * the derivation here is intent-only: the diff the model asked for, which for
 * pi's edit is also what ran (each entry is matched against the original
 * file).
 *
 * pi's schemas (see pi-coding-agent `write.js`/`edit.js`):
 * - write: `{ path, content }`
 * - edit:  `{ path, edits: [{ oldText, newText }, …] }` — one hunk per entry.
 */
import { structuredPatch } from "diff";

/** Room for a path, one removed/added pair, and three context lines on each side. */
export const CHAT_DIFF_MAX_LINES = 9;

/** One file change in the form {@link DiffCard} renders. */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header. */
  path: string;
  /** Prior content including context, or `null` when there is none (a create). */
  oldText: string | null;
  /** Content after the change, including any shared context. */
  newText: string;
}

/** The props {@link DiffCard} draws from this model. */
export interface DiffCardModel {
  diffs: DiffHunk[];
}

/** A single rendered body line and its role, so the height cap slices a flat list. */
export interface DiffRow {
  kind: "path" | "del" | "add" | "context" | "gap";
  text: string;
}

/** Bound synchronous edit-graph search; one replacement consumes two edits. */
const MAX_DIFF_EDIT_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The change a call's arguments describe, or null when they do not describe
 * one yet — a streamed call's arguments arrive incrementally, and a partial
 * payload must fall back to the generic input section rather than render a
 * diff from half a schema.
 */
function intendedDiff(name: string, args: Record<string, unknown> | undefined): DiffHunk[] | null {
  if (!isRecord(args)) return null;
  const { path } = args;
  if (typeof path !== "string" || path.trim() === "") return null;
  if (name === "write") {
    const { content } = args;
    return typeof content === "string" ? [{ path, oldText: null, newText: content }] : null;
  }
  if (name === "edit") {
    const { edits } = args;
    if (!Array.isArray(edits) || edits.length === 0) return null;
    const hunks: DiffHunk[] = [];
    for (const entry of edits) {
      if (!isRecord(entry)) return null;
      const { oldText, newText } = entry;
      if (typeof oldText !== "string" || typeof newText !== "string") return null;
      hunks.push({ path, oldText, newText });
    }
    return hunks;
  }
  return null;
}

/**
 * Derive the diff card for a file-mutation call.
 * An errored call shows its failure text, not a change that never happened;
 * any other write/edit whose arguments parse yields its intended hunks.
 */
export function diffCardModel(
  name: string,
  args: Record<string, unknown> | undefined,
  isError: boolean,
): DiffCardModel | null {
  if (isError) return null;
  const diffs = intendedDiff(name, args);
  return diffs === null ? null : { diffs };
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a
 * full deletion's `newText` or a create's absent `oldText` side draws
 * nothing), and a single trailing newline is a line terminator rather than an
 * extra empty line — the same terminator rule dsh's TerminalBlock applies to
 * command output. An interior blank line (a genuine `\n\n`) survives.
 */
export function contentLines(text: string): string[] {
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

/** Derive exact local patches or a whole-fragment replacement when search exceeds the limit. */
export function localHunks(diff: DiffHunk): { lines: string[] }[] {
  const oldLines = contentLines(diff.oldText ?? "");
  const newLines = contentLines(diff.newText);
  const normalize = (lines: string[]): string => lines.map((line) => `${line}\n`).join("");
  return (
    structuredPatch("", "", normalize(oldLines), normalize(newLines), undefined, undefined, {
      context: 3,
      maxEditLength: MAX_DIFF_EDIT_LENGTH,
    })?.hunks ?? [{ lines: [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)] }]
  );
}

/**
 * Flatten local patches into rows.
 * A path header opens each new file. A `⋯` gap separates consecutive
 * same-file fragments and distant patches within a fragment.
 */
export function buildRows(diffs: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let prevPath: string | undefined;
  for (const diff of diffs) {
    if (diff.path !== prevPath) rows.push({ kind: "path", text: diff.path });
    else rows.push({ kind: "gap", text: "⋯" });
    prevPath = diff.path;
    for (const [index, hunk] of localHunks(diff).entries()) {
      if (index > 0) rows.push({ kind: "gap", text: "⋯" });
      for (const line of hunk.lines) {
        const kind = line.startsWith("-") ? "del" : line.startsWith("+") ? "add" : "context";
        rows.push({ kind, text: line.slice(1) });
      }
    }
  }
  return rows;
}

/**
 * Count displayed additions and deletions. Exact patches exclude shared
 * context; comparisons exceeding the edit limit count both complete
 * fragments as replaced.
 */
export function diffTotals(diffs: DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    for (const hunk of localHunks(diff)) {
      for (const line of hunk.lines) {
        if (line.startsWith("+")) added++;
        if (line.startsWith("-")) removed++;
      }
    }
  }
  return { added, removed };
}

/**
 * Copy the full local diff, including folded rows: removed/added lines have
 * `- `/`+ ` prefixes, context has two spaces, and paths and gaps stay
 * verbatim.
 */
export function copyText(rows: DiffRow[]): string {
  return rows
    .map((row) => {
      switch (row.kind) {
        case "del":
          return `- ${row.text}`;
        case "add":
          return `+ ${row.text}`;
        case "context":
          return `  ${row.text}`;
        case "path":
        case "gap":
          return row.text;
      }
    })
    .join("\n");
}
