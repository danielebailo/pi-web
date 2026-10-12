import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppState } from "../../lib/app-state.ts";
import type { AskUserQuestionItem } from "../../lib/types.ts";
import { QuestionComposer } from "./QuestionComposer.tsx";

// The copy renders through `useT`, which falls back to the host locale when the
// preference is `system`. Pin it so the assertions read one language.
vi.stubGlobal("navigator", { language: "en" });

beforeEach(() => {
  resetAppState();
});

afterEach(() => {
  resetAppState();
});

function card(questions: AskUserQuestionItem[], extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <QuestionComposer questions={questions} onSubmit={() => undefined} {...extra} />,
  );
}

/**
 * The batched card, on its own.
 *
 * This is its first paint and nothing more: a static render does not run
 * effects, so the countdown never starts and no answer is ever sent. What is
 * worth pinning here is what the card decides to put on screen — the title it
 * picks, the rows it builds, the pager, and the fallback that keeps a card the
 * client cannot read from becoming a dead end.
 */
describe("QuestionComposer", () => {
  it("titles a multi-question batch by its size and shows the first question", () => {
    const html = card([
      {
        id: "db",
        header: "Storage",
        question: "Which database?",
        detail: "**detail**",
        options: [
          { label: "Postgres (Recommended)", description: "Solid transactions" },
          { label: "SQLite" },
        ],
      },
      { id: "tags", question: "Which capabilities?", options: [{ label: "fulltext" }], multiSelect: true },
    ]);

    expect(html).toContain("2 questions");
    // The pager position and the answered count describe the batch, not one question.
    expect(html).toContain("Question 1 of 2 (0 answered)");
    expect(html).toContain("Which database?");
    expect(html).toContain("Solid transactions");
    // The recommendation is stripped from the label and shown as its own badge.
    expect(html).toContain("Postgres");
    expect(html).toContain("Recommended");
    expect(html).not.toContain("Postgres (Recommended)");
    // Only the current page is drawn; the rest of the batch is behind the pager.
    expect(html).not.toContain("Which capabilities?");
    expect(html).toContain("Skip");
    expect(html).toContain("Next");
  });

  it("takes its title from a lone question's header instead of counting to one", () => {
    const html = card([
      { id: "go", header: "Confirm", question: "Proceed?", options: [{ label: "Yes" }] },
    ]);

    expect(html).toContain("Confirm");
    expect(html).not.toContain("1 questions");
  });

  it("draws a cancel affordance only while something is blocked behind it", () => {
    const questions = [{ id: "go", question: "Proceed?", options: [{ label: "Yes" }] }];
    expect(card(questions)).toContain("Cancel (Esc)");
    // A question re-opened after its deadline blocks nothing, so it is closed by
    // putting the strip away rather than by answering `cancelled`.
    expect(card(questions, { cancellable: false })).not.toContain("Cancel (Esc)");
  });

  it("counts down only when a deadline was given", () => {
    const questions = [{ id: "go", question: "Proceed?", options: [{ label: "Yes" }] }];
    expect(card(questions, { timeoutMs: 120_000 })).toContain("Cancels in");
    expect(card(questions)).not.toContain("Cancels in");
  });

  it("renders a plan-review question as an approval card instead of an option list", () => {
    const html = card([
      {
        id: "plan",
        header: "Migration plan",
        question: "Approve this plan?",
        detail: "# Plan\n\nStep one.",
        options: [{ label: "Approve" }, { label: "Request changes" }],
        intent: { kind: "plan-review", approve: "Approve" },
      },
    ]);

    expect(html).toContain("Plan review");
    expect(html).toContain("View full plan");
    // The list is replaced, not stacked under the plan: the verdict is the
    // smallest thing on the card if it is drawn as a fourth row of options.
    expect(html).not.toContain('role="radiogroup"');
  });

  it("keeps a tagged question in the generic flow when the batch asks several", () => {
    const html = card([
      {
        id: "plan",
        question: "Approve?",
        detail: "# Plan",
        options: [{ label: "Approve" }],
        intent: { kind: "plan-review", approve: "Approve" },
      },
      { id: "other", question: "And this?", options: [{ label: "Yes" }] },
    ]);

    // A single verdict cannot stand for a batch, so the tag is ignored.
    expect(html).not.toContain("Plan review");
    expect(html).toContain('role="radiogroup"');
  });

  it("keeps a batch it cannot read answerable by cancel", () => {
    const html = card([]);
    expect(html).toContain("could not be read");
  });
});
