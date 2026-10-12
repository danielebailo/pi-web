/**
 * Unfinished answers, kept across a reload.
 *
 * dsh persists a per-session draft so leaving a question and coming back does
 * not erase what was already typed. The same case exists here for a worse
 * reason: a live batch blocks its pi process, and a reload used to leave the
 * card empty while the process stayed blocked — the user had to answer from
 * scratch or cancel work they had already decided.
 *
 * Only the draft lives here. Whether a question is still open is the
 * transcript's answer (`pending-questions.ts`), and the two must not be
 * conflated: a stale draft must never make a question look answerable, and a
 * question with no draft is simply unanswered.
 *
 * The stored progress is rejected when it does not match the batch it is read
 * against — a different question count means the batch is not the one that was
 * being answered, and restoring answers into it would put a choice on a
 * question the user never saw.
 */

import type { AskUserDraft } from "./question-model.ts";

/** Versioned so a shape change discards old drafts instead of misreading them. */
const KEY_PREFIX = "pi-web-simple.question-draft.v1:";

/** One card's unfinished state. */
export interface StoredQuestionDraft {
  /** The question the user was on. */
  index: number;
  /** One draft per question, in batch order. */
  drafts: AskUserDraft[];
}

/**
 * `localStorage`, or `null` where it cannot be used at all.
 *
 * It is absent under a static render (tests, SSR) and throws when a browser has
 * storage disabled, so the check is not just `typeof` — either way the card
 * works, it just forgets.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Read the draft for one card, or `null` when there is none to trust. */
export function readQuestionDraft(key: string, questionCount: number): StoredQuestionDraft | null {
  const store = storage();
  if (store === null || questionCount === 0) return null;
  let parsed: unknown;
  try {
    const raw = store.getItem(KEY_PREFIX + key);
    if (raw === null) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  const drafts = readDrafts(body.drafts, questionCount);
  if (drafts === null) return null;
  const index = body.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= questionCount) {
    return null;
  }
  return { index, drafts };
}

/** Remember one card's progress. A storage failure is not worth surfacing. */
export function writeQuestionDraft(key: string, value: StoredQuestionDraft): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or a disabled store: the card keeps working, it just forgets.
  }
}

/** Forget one card's progress, once its answer has been submitted. */
export function clearQuestionDraft(key: string): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(KEY_PREFIX + key);
  } catch {
    // Nothing to do; a leftover draft is pruned the next time it is read.
  }
}

/** The drafts, or `null` when the array is not exactly one usable draft per question. */
function readDrafts(raw: unknown, questionCount: number): AskUserDraft[] | null {
  if (!Array.isArray(raw) || raw.length !== questionCount) return null;
  const drafts: AskUserDraft[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.custom !== "string" || typeof item.skipped !== "boolean") return null;
    if (!Array.isArray(item.selected)) return null;
    const selected = item.selected.filter((label): label is string => typeof label === "string");
    drafts.push({ selected, custom: item.custom, skipped: item.skipped });
  }
  return drafts;
}
