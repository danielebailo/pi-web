/**
 * The questions a session still has open, projected from its own transcript.
 *
 * A batch that reaches its deadline is not a lost question: the tool records
 * the outcome as `timed-out` and the agent is told to keep working, so the user
 * can still answer later. There is no server-side table for that — the answer
 * arrives as an ordinary new user message, and this module reads the pair back
 * out of the transcript, the same way the plan panel reads its `todo` snapshot.
 * That is what makes it survive a reload, a compaction and a branch: the record
 * is in the messages, and every path that rebuilds them rebuilds this too.
 *
 * The reply itself is a plain user message with a marker prefix, because pi's
 * `prompt` takes text and images and nothing else — there is no message kind to
 * carry a typed reply. The model sees the same line, which is the point: the
 * marker names the tool call so a later turn can tell which question was
 * answered rather than guessing from the order.
 */

import type {
  AgentMessage,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  ToolResultMessage,
} from "../../lib/types.ts";
import type { Translate } from "../../lib/i18n/index.ts";
import { readAskUserQuestions } from "./question-model.ts";

/**
 * The marker that turns an ordinary user message into an answer.
 *
 * It names the tool call rather than the question ids, so one reply settles one
 * call no matter how many questions that call asked.
 */
export const ANSWER_MESSAGE_PREFIX = "[answer_to_pending_question] ";

/** One timed-out call still waiting for an answer. */
export interface PendingQuestion {
  /** The `ask_user_question` call the reply must name back. */
  callId: string;
  questions: AskUserQuestionItem[];
}

/** What an answered, cancelled or timed-out call settled with. */
export type QuestionOutcome = "answered" | "cancelled" | "timed-out";

/** One settled batch, as the transcript recorded it. */
export interface SettledQuestion {
  questions: AskUserQuestionItem[];
  /** What the user chose; empty for a call that was cancelled or timed out. */
  answers: AskUserQuestionAnswerItem[];
  outcome: QuestionOutcome;
}

/** A parsed reply: the call it settles and what the user chose. */
export interface AnswerMessage {
  callId: string;
  answers: AskUserQuestionAnswerItem[];
}

/** What the tool result of one `ask_user_question` call carries. */
interface AskUserResultDetails {
  questions: AskUserQuestionItem[];
  outcome: QuestionOutcome;
}

/** The outcomes this build can read; anything else is a result it does not know. */
const OUTCOMES: ReadonlySet<string> = new Set(["answered", "cancelled", "timed-out"]);

/**
 * The record one `ask_user_question` result left behind, for reading back.
 *
 * A call that timed out recorded the deadline rather than an answer, so its
 * `answers` is empty here even though the user may have replied later; that
 * reply is an ordinary message in the transcript (see `readAnswerMessage`), and
 * the card is not the place to reassemble it — the message right below is.
 */
export function readSettledQuestion(raw: unknown): SettledQuestion | null {
  const details = readResultDetails(raw);
  if (details === null) return null;
  if (typeof raw !== "object" || raw === null) return null;
  const answers = readAnswers((raw as Record<string, unknown>).answers) ?? [];
  return { questions: details.questions, answers, outcome: details.outcome };
}

/**
 * Every timed-out call that has no answer yet, oldest first.
 *
 * Messages are scanned in order and the answered set is completed first, so a
 * reply always settles the call it names no matter where in the transcript the
 * two happen to sit relative to each other after a branch or a compaction.
 */
export function projectPendingQuestions(messages: readonly AgentMessage[]): PendingQuestion[] {
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    const reply = readAnswerMessage(userText(message.content));
    if (reply !== null) answered.add(reply.callId);
  }

  const pending: PendingQuestion[] = [];
  for (const message of messages) {
    const result = message as Partial<ToolResultMessage>;
    if (result.role !== "toolResult" || result.toolName !== "ask_user_question") continue;
    const details = readResultDetails(result.details);
    if (details === null || details.outcome !== "timed-out") continue;
    if (typeof result.toolCallId !== "string" || answered.has(result.toolCallId)) continue;
    pending.push({ callId: result.toolCallId, questions: details.questions });
  }
  return pending;
}

/**
 * The user message that hands a late answer back to the agent.
 *
 * Two lines rather than one: the first is what the reader sees in the
 * transcript, the second is the record the projection reads back. The model
 * sees both, which is fine — the readable half says the same thing, and a
 * marker alone would leave the transcript with a line nobody can read.
 */
export function answerMessageText(
  callId: string,
  questions: readonly AskUserQuestionItem[],
  answers: readonly AskUserQuestionAnswerItem[],
  t: Translate,
): string {
  return `${describeAnswers(questions, answers, t)}\n${ANSWER_MESSAGE_PREFIX}${JSON.stringify({ callId, answers })}`;
}

/** One human-readable line naming each question and what was chosen for it. */
function describeAnswers(
  questions: readonly AskUserQuestionItem[],
  answers: readonly AskUserQuestionAnswerItem[],
  t: Translate,
): string {
  const parts = questions.map((question) => {
    const answer = answers.find((candidate) => candidate.id === question.id);
    const chosen = answer === undefined
      ? ""
      : [answer.selected.join(", "), answer.custom ?? ""].filter((part) => part.length > 0).join(" / ");
    const name = question.header ?? question.question;
    return `${name}=${chosen.length > 0 ? chosen : t("question.skipped")}`;
  });
  return `${t("question.answerTitle")}${parts.join(t("question.answerSeparator"))}`;
}

/**
 * Read one user message as a reply, or `null` when it is just something the
 * user typed.
 *
 * The marker is matched per line because the reply is two lines, and a message
 * that carries a marker but not a usable body is not a reply either — it is a
 * user who typed the marker by hand, and treating it as an answer would quietly
 * close a question nobody answered.
 */
export function readAnswerMessage(text: string): AnswerMessage | null {
  const marked = text
    .split("\n")
    .map((line) => line.trimStart())
    .find((line) => line.startsWith(ANSWER_MESSAGE_PREFIX));
  if (marked === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(marked.slice(ANSWER_MESSAGE_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  if (typeof body.callId !== "string" || body.callId.length === 0) return null;
  const answers = readAnswers(body.answers);
  if (answers === null) return null;
  return { callId: body.callId, answers };
}

/** The result payload this tool writes, narrowed to what the projection needs. */
function readResultDetails(raw: unknown): AskUserResultDetails | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const details = raw as Record<string, unknown>;
  if (typeof details.outcome !== "string" || !OUTCOMES.has(details.outcome)) return null;
  const questions = readAskUserQuestions(details.questions);
  if (questions.length === 0) return null;
  return { questions, outcome: details.outcome as QuestionOutcome };
}

function readAnswers(raw: unknown): AskUserQuestionAnswerItem[] | null {
  if (!Array.isArray(raw)) return null;
  const answers: AskUserQuestionAnswerItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string") return null;
    const selected = Array.isArray(item.selected)
      ? item.selected.filter((label): label is string => typeof label === "string")
      : [];
    const custom = typeof item.custom === "string" ? item.custom : undefined;
    answers.push({ id: item.id, selected, ...(custom === undefined ? {} : { custom }) });
  }
  return answers;
}

/** Flatten a user message's content to text, for the marker match. */
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === "object" && part !== null
        && (part as { type?: unknown }).type === "text"
        && typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("");
}
