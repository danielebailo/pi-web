/**
 * `@` file references in the message draft: where one opens, and how it is
 * spelled.
 *
 * The sigil is pi's own idea, not this UI's — the TUI's editor completes files
 * behind an `@`, and the CLI turns an `@file` argument into a `<file>` block.
 * This module ports the *editor* half of that: what is inserted is a reference
 * to a path, not the path's contents. pi has no file-reference grammar in RPC
 * mode, so nothing downstream expands it; the agent reads the path with the
 * tools it already has. What the `@` buys is that the sentence is unambiguous
 * about what is being pointed at, and that the completion knows when it is
 * wanted — see `useFileCompletion` for the menu and `reference-token.ts` for
 * how the reference is drawn and put back on send.
 *
 * Pure text in, ranges out, like `slash.ts` beside it: the textarea stays the
 * single source of truth and the caret is the only cursor.
 */
import { TOKEN_OPENER } from "./reference-token.ts";

/** An in-progress `@` token: what was typed after it, and where it opened. */
export interface AtTrigger {
  /** Text between the `@` (or `@"`) and the caret. May contain `/`. */
  query: string;
  /** Index of the `@` in the value. */
  start: number;
}

/**
 * The `@` token the caret is inside, or null.
 *
 * The sigil must open a word: `mail@example.com` and `user@host` are ordinary
 * text, and only a `@` at the draft's start or after one of `TOKEN_OPENER` is
 * asking for a file. Whitespace ends the token, which is what closes the menu
 * as soon as the user moves on to a different word.
 *
 * The quoted form (`@"my file`) is how a path with spaces is reached: it is the
 * one shape where a space does not end the token, and it closes at the first
 * closing quote — after which the reference is complete and nothing is being
 * completed any more.
 */
export function detectAtTrigger(value: string, caret: number): AtTrigger | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  if (safeCaret === 0) return null;

  const at = value.lastIndexOf("@", safeCaret - 1);
  if (at < 0) return null;
  if (at > 0 && !TOKEN_OPENER.test(value[at - 1] ?? "")) return null;

  const rest = value.slice(at + 1, safeCaret);
  if (rest.startsWith('"')) {
    const query = rest.slice(1);
    // A closed quote means the path is already written out; the menu has
    // nothing left to ask.
    if (query.includes('"')) return null;
    return { query, start: at };
  }
  // Unquoted, the token ends at the first whitespace or quote — a quote would
  // be the start of the quoted form and cannot sit inside the plain one.
  if (/[\s"']/.test(rest)) return null;
  return { query: rest, start: at };
}
