import type {
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  ExtensionUiRequest,
} from "../../lib/types.ts";

/**
 * Shape of one blocking extension dialog, derived from pi's four dialog
 * methods. pi's `select`/`input`/`editor` carry a plain title plus either
 * options or a text field, so the card's job is to normalise that into rows the
 * user can act on — the layout itself is ported from dsh's question composer.
 */

/** One answerable row: the label the user reads, the value pi receives back. */
export interface QuestionOption {
  /** Sent to pi verbatim; the recommendation suffix is part of the value. */
  value: string;
  /** Display text, with the recommendation suffix stripped. */
  label: string;
  recommended: boolean;
}

/**
 * Split dsh's conventional recommendation suffix from an option label.
 *
 * dsh's `ask_user_question` told the model to append `(Recommended)` to the
 * option it prefers, and its renderer turns that into a badge. Extensions
 * written for pi did not agree on a convention, but the same suffix is the one
 * they borrow, so the same parse applies — and the *value* keeps the suffix
 * because that is the string the extension is matching on.
 */
export function parseRecommendedLabel(raw: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
  if (!suffix.test(raw)) return { label: raw, recommended: false };
  return { label: raw.replace(suffix, ""), recommended: true };
}

/**
 * `confirm` is a two-action question rather than a list: pi answers it with a
 * boolean, so the rows carry our own labels and a token the card maps back.
 */
export const CONFIRM_YES = "yes";
export const CONFIRM_NO = "no";

/** The rows a request renders: its own options, or nothing outside `select`. */
export function questionOptions(request: ExtensionUiRequest): QuestionOption[] {
  if (request.method !== "select") return [];
  const raw = Array.isArray(request.options) ? request.options : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => ({ value: item, ...parseRecommendedLabel(item) }));
}

/** Whether the request's body is a text field rather than a row list. */
export function isTextRequest(request: ExtensionUiRequest): boolean {
  return request.method === "input" || request.method === "editor";
}

/** Prefilled text: `editor` carries `text` as its prefill, `input` its value. */
export function initialText(request: ExtensionUiRequest): string {
  return typeof request.text === "string" ? request.text : "";
}

/**
 * The wire payload for one decision, or `null` when nothing has been chosen.
 *
 * `select` and `input`/`editor` share the `value` key; `confirm` is the odd one
 * out with a boolean, which is why the choice token is translated here instead
 * of at the call site.
 */
export function answerPayload(
  request: ExtensionUiRequest,
  choice: string | null,
  text: string,
): Record<string, unknown> | null {
  if (request.method === "confirm") {
    if (choice === null) return null;
    return { confirmed: choice === CONFIRM_YES };
  }
  if (request.method === "select") {
    return choice === null ? null : { value: choice };
  }
  return { value: text };
}

/**
 * Whether the card can send an answer yet.
 *
 * `select` needs a row, `input` a non-empty value, and `editor` nothing: the
 * editor is opened to change existing text, so submitting an emptied field
 * ("delete all of it") is a legitimate answer rather than an empty one.
 */
export function canSubmit(
  request: ExtensionUiRequest,
  choice: string | null,
  text: string,
): boolean {
  if (request.method === "select") return choice !== null;
  if (request.method === "input") return text.trim() !== "";
  return true;
}

/** Whole seconds left on pi's own auto-resolve deadline, never negative. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** One in-progress answer inside a batched request. */
export interface AskUserDraft {
  /** Offered labels currently selected; at most one for a single-select question. */
  selected: string[];
  /** What the user typed in the free-text field. */
  custom: string;
  /** Whether the user explicitly passed on this question. */
  skipped: boolean;
}

/**
 * The questions a payload carries, dropping anything that is not usable.
 *
 * Used both for a request arriving over the wire and for the batch recorded in
 * a tool result (see `pending-questions.ts`), because the two carry the same
 * shape and neither is worth rendering half-read.
 */
export function readAskUserQuestions(raw: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is AskUserQuestionItem =>
      typeof item === "object" && item !== null
      && typeof (item as AskUserQuestionItem).id === "string"
      && typeof (item as AskUserQuestionItem).question === "string",
  );
}

/**
 * The questions a batched request carries.
 *
 * The server validated the batch before publishing it, so this only guards the
 * shape a client could still receive from an older server: anything that is not
 * a usable question is dropped rather than rendered as a blank card.
 */
export function askUserQuestions(request: ExtensionUiRequest): AskUserQuestionItem[] {
  if (request.method !== "ask_user") return [];
  return readAskUserQuestions(request.questions);
}

/**
 * Start every question unanswered.
 *
 * dsh pre-selects the first choice marked "(Recommended)" and still calls the
 * batch unsubmitted. That reads as an answer the user never gave, so a card here
 * starts blank and requires a deliberate choice — the badge still marks the
 * recommendation, it just does not act on it.
 */
export function initialAskUserDrafts(
  questions: readonly AskUserQuestionItem[],
): AskUserDraft[] {
  return questions.map(() => ({ selected: [], custom: "", skipped: false }));
}

/** Whether one question has something to submit: a choice, text, or an explicit skip. */
export function askUserAnswered(draft: AskUserDraft | undefined): boolean {
  if (draft === undefined) return false;
  return draft.skipped || draft.selected.length > 0 || draft.custom.trim().length > 0;
}

/** The first question still missing an answer, or `-1` when the batch is ready. */
export function firstUnanswered(
  questions: readonly AskUserQuestionItem[],
  drafts: readonly AskUserDraft[],
): number {
  return questions.findIndex((_question, index) => !askUserAnswered(drafts[index]));
}

/**
 * Apply one click to a draft.
 *
 * A single-select question keeps at most one label and clears the free-text
 * field, because the two are alternatives rather than additions — dsh resolves
 * the same ambiguity by letting `custom` override the choice. A multi-select
 * keeps both, since the typed answer supplements the checked ones. Either way
 * the question stops being skipped, because the user just acted on it.
 */
export function toggleAskUserSelection(
  draft: AskUserDraft,
  label: string,
  multiSelect: boolean,
): AskUserDraft {
  if (multiSelect) {
    const selected = draft.selected.includes(label)
      ? draft.selected.filter((item) => item !== label)
      : [...draft.selected, label];
    return { ...draft, selected, skipped: false };
  }
  const selected = draft.selected[0] === label ? [] : [label];
  return { selected, custom: "", skipped: false };
}

/**
 * The batch payload the server encodes back into pi's `select` value, or `null`
 * while any question is unanswered.
 *
 * A partial batch is refused rather than silently sent: the model cannot tell a
 * missing answer from a question it never asked, and an answer batch is the one
 * place where an omission would be read as consent to decide.
 */
export function askUserAnswerPayload(
  questions: readonly AskUserQuestionItem[],
  drafts: readonly AskUserDraft[],
): { answers: AskUserQuestionAnswerItem[] } | null {
  if (questions.length === 0) return null;
  if (firstUnanswered(questions, drafts) !== -1) return null;
  const answers: AskUserQuestionAnswerItem[] = questions.map((question, index) => {
    const draft = drafts[index] ?? { selected: [], custom: "", skipped: false };
    if (draft.skipped) return { id: question.id, selected: [] };
    const custom = draft.custom.trim();
    if (question.multiSelect === true) {
      return {
        id: question.id,
        selected: [...draft.selected],
        ...(custom.length === 0 ? {} : { custom }),
      };
    }
    // Single-select: text replaces the choice instead of joining it.
    if (custom.length > 0) return { id: question.id, selected: [], custom };
    return { id: question.id, selected: draft.selected.slice(0, 1) };
  });
  return { answers };
}
