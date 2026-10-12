import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppState } from "../../lib/app-state.ts";
import type { AskUserQuestionItem } from "../../lib/types.ts";
import { PlanReviewPanel, plainSummary } from "./PlanReviewPanel.tsx";

// The copy renders through `useT`, which falls back to the host locale when the
// preference is `system`. Pin it so the assertions read one language.
vi.stubGlobal("navigator", { language: "en" });

beforeEach(() => {
  resetAppState();
});

afterEach(() => {
  resetAppState();
});

const QUESTION: AskUserQuestionItem = {
  id: "plan",
  header: "Migration plan",
  question: "Approve this plan?",
  detail: "# Plan\n\nStep one does the thing.\n\nStep two finishes it.",
  options: [{ label: "Approve" }, { label: "Request changes" }],
  intent: { kind: "plan-review", approve: "Approve" },
};

function panel(question: AskUserQuestionItem = QUESTION) {
  return renderToStaticMarkup(
    <PlanReviewPanel
      question={question}
      intent={question.intent ?? { kind: "plan-review", approve: "Approve" }}
      disabled={false}
      requesting={false}
      onApprove={() => undefined}
      onRequestChanges={() => undefined}
    />,
  );
}

describe("PlanReviewPanel", () => {
  it("offers the verdict's two actions over a two-line preview of the plan", () => {
    const html = panel();

    expect(html).toContain("Plan review");
    expect(html).toContain("Migration plan");
    // The prose, without the markdown furniture that would read as a fragment.
    expect(html).toContain("Plan Step one does the thing.");
    expect(html).toContain("View full plan");
    expect(html).toContain("Request changes");
    expect(html).toContain("Approve");
  });

  it("renders the approve label verbatim, because that is what goes back on the wire", () => {
    // A translated button would send a string the asker never offered.
    const html = panel({ ...QUESTION, intent: { kind: "plan-review", approve: "批准这个计划" } });
    expect(html).toContain("批准这个计划");
  });

  it("falls back to the plan itself for a title when the question declared no header", () => {
    const html = panel({ ...QUESTION, header: undefined });
    expect(html).toContain("Approve this plan?");
  });
});

describe("plainSummary", () => {
  it("keeps the first two lines of substance and strips the markup", () => {
    expect(plainSummary("# Title\n\n- one\n- two\n- three")).toBe("Title one");
    expect(plainSummary("**bold** and `code`")).toBe("bold and code");
    expect(plainSummary("")).toBe("");
  });
});
