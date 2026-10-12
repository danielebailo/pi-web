import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../lib/types.ts";
import { translator } from "../../lib/i18n/index.ts";
import {
  ANSWER_MESSAGE_PREFIX,
  answerMessageText,
  projectPendingQuestions,
  readAnswerMessage,
  readSettledQuestion,
} from "./pending-questions.ts";

const t = translator("en");

const QUESTIONS = [{ id: "db", header: "选库", question: "用哪个数据库？", options: [{ label: "Postgres" }] }];

function toolResult(callId: string, details: unknown, toolName = "ask_user_question"): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName,
    content: [{ type: "text", text: "" }],
    details,
    timestamp: 1,
  } as unknown as AgentMessage;
}

function userMessage(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 2 } as unknown as AgentMessage;
}

function timedOut(callId: string) {
  return toolResult(callId, { questions: QUESTIONS, answers: [], outcome: "timed-out" });
}

describe("projectPendingQuestions", () => {
  it("lists a call whose deadline passed with no answer", () => {
    expect(projectPendingQuestions([timedOut("call-1")])).toEqual([
      { callId: "call-1", questions: QUESTIONS },
    ]);
  });

  it("drops a call the user answered in time", () => {
    const answered = toolResult("call-1", {
      questions: QUESTIONS,
      answers: [{ id: "db", selected: ["Postgres"] }],
      outcome: "answered",
    });
    expect(projectPendingQuestions([answered])).toEqual([]);
  });

  it("drops a call the user cancelled", () => {
    expect(projectPendingQuestions([toolResult("call-1", { questions: QUESTIONS, answers: [], outcome: "cancelled" })])).toEqual([]);
  });

  it("drops a timed-out call once its late reply is in the transcript", () => {
    const reply = userMessage(answerMessageText("call-1", QUESTIONS, [{ id: "db", selected: ["Postgres"] }], t));
    expect(projectPendingQuestions([timedOut("call-1"), reply])).toEqual([]);
    // The reply settles the call it names, not merely the one before it.
    const other = userMessage(answerMessageText("call-9", QUESTIONS, [{ id: "db", selected: [] }], t));
    expect(projectPendingQuestions([timedOut("call-1"), other])).toHaveLength(1);
  });

  it("keeps calls apart, in transcript order", () => {
    const reply = userMessage(answerMessageText("call-2", QUESTIONS, [{ id: "db", selected: ["SQLite"] }], t));
    expect(projectPendingQuestions([timedOut("call-1"), timedOut("call-2"), timedOut("call-3"), reply])).toEqual([
      { callId: "call-1", questions: QUESTIONS },
      { callId: "call-3", questions: QUESTIONS },
    ]);
  });

  it("ignores other tools and results it cannot read", () => {
    expect(
      projectPendingQuestions([
        toolResult("call-1", { questions: QUESTIONS, answers: [], outcome: "timed-out" }, "todo"),
        toolResult("call-2", { outcome: "timed-out" }),
        toolResult("call-3", "not an object"),
        toolResult("call-4", { questions: [], outcome: "timed-out" }),
        { role: "assistant", content: [], timestamp: 3 } as unknown as AgentMessage,
      ]),
    ).toEqual([]);
  });

  it("does not treat a hand-typed marker as an answer", () => {
    // A user who types the marker closes nothing; the question stays open.
    expect(projectPendingQuestions([timedOut("call-1"), userMessage(`${ANSWER_MESSAGE_PREFIX}nope`)])).toHaveLength(1);
  });
});

describe("readSettledQuestion", () => {
  it("reads back an answered batch with the choices the user made", () => {
    expect(
      readSettledQuestion({
        questions: QUESTIONS,
        answers: [{ id: "db", selected: ["Postgres"], custom: "and pgvector" }],
        outcome: "answered",
      }),
    ).toEqual({
      questions: QUESTIONS,
      answers: [{ id: "db", selected: ["Postgres"], custom: "and pgvector" }],
      outcome: "answered",
    });
  });

  it("reads a cancel or a deadline as a record with no answer in it", () => {
    for (const outcome of ["cancelled", "timed-out"] as const) {
      expect(readSettledQuestion({ questions: QUESTIONS, answers: [], outcome })).toEqual({
        questions: QUESTIONS,
        answers: [],
        outcome,
      });
    }
  });

  it("ignores a result it cannot read rather than drawing an empty card", () => {
    expect(readSettledQuestion(undefined)).toBeNull();
    expect(readSettledQuestion({ questions: QUESTIONS, outcome: "something-else" })).toBeNull();
    expect(readSettledQuestion({ outcome: "answered" })).toBeNull();
    expect(readSettledQuestion({ questions: QUESTIONS, answers: "x", outcome: "answered" })).toEqual({
      questions: QUESTIONS,
      answers: [],
      outcome: "answered",
    });
  });
});

describe("answer messages", () => {
  it("composes a readable line above the record the projection reads back", () => {
    const text = answerMessageText(
      "call-1",
      QUESTIONS,
      [{ id: "db", selected: ["Postgres"], custom: "and pgvector" }],
      t,
    );
    const [readable, marker] = text.split("\n");
    expect(readable).toBe("Answered: 选库=Postgres / and pgvector");
    expect(marker?.startsWith(ANSWER_MESSAGE_PREFIX)).toBe(true);
    expect(readAnswerMessage(text)).toEqual({
      callId: "call-1",
      answers: [{ id: "db", selected: ["Postgres"], custom: "and pgvector" }],
    });
  });

  it("says a skipped question was skipped rather than leaving its value blank", () => {
    const text = answerMessageText("call-1", QUESTIONS, [{ id: "db", selected: [] }], t);
    expect(text.split("\n")[0]).toBe("Answered: 选库=Skipped");
  });

  it("finds the marker even when the message carries other text", () => {
    const marker = `${ANSWER_MESSAGE_PREFIX}${JSON.stringify({ callId: "c", answers: [] })}`;
    expect(readAnswerMessage(`随便一句\n${marker}`)).toEqual({ callId: "c", answers: [] });
  });

  it("reads a message with no marker, or a broken one, as ordinary text", () => {
    expect(readAnswerMessage("用 Postgres 吧")).toBeNull();
    expect(readAnswerMessage(`${ANSWER_MESSAGE_PREFIX}{`)).toBeNull();
    expect(readAnswerMessage(`${ANSWER_MESSAGE_PREFIX}{"answers":[]}`)).toBeNull();
    expect(readAnswerMessage(`${ANSWER_MESSAGE_PREFIX}{"callId":"","answers":[]}`)).toBeNull();
    expect(readAnswerMessage(`${ANSWER_MESSAGE_PREFIX}{"callId":"c","answers":"x"}`)).toBeNull();
  });
});
