import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppState } from "../../lib/app-state.ts";
import type { AskUserQuestionItem } from "../../lib/types.ts";
import { PlanReviewPanel, type PlanReviewPanelProps } from "./PlanReviewPanel.tsx";
import { planDescription, planTitleOf } from "./plan-review-text.ts";

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

function panel(
  question: AskUserQuestionItem = QUESTION,
  extra: Partial<PlanReviewPanelProps> = {},
) {
  return renderToStaticMarkup(
    <PlanReviewPanel
      question={question}
      intent={question.intent ?? { kind: "plan-review", approve: "Approve" }}
      disabled={false}
      requesting={false}
      changes=""
      onChange={() => undefined}
      onApprove={() => undefined}
      onRequestChanges={() => undefined}
      onSubmitChanges={() => undefined}
      {...extra}
    />,
  );
}

describe("PlanReviewPanel", () => {
  it("is a decision card, not a question: no pager, no skip, no submit", () => {
    const html = panel();

    expect(html).toContain("Plan review");
    expect(html).toContain("<h3");
    expect(html).toContain("Migration plan");
    // The prose, without the markdown furniture that would read as a fragment.
    expect(html).toContain("Step one does the thing.");
    expect(html).toContain("Request changes");
    expect(html).toContain("Approve");

    // Every ask control would be either meaningless here or a second way to
    // answer the same verdict (see the component's own note).
    expect(html).not.toContain("1 / 1");
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("Submit");
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain("<textarea");
    // The question text stays as the card's accessible name rather than a
    // second title.
    expect(html).toContain('aria-label="Approve this plan?"');
  });

  it("does not expand the plan on the card", () => {
    // The document belongs at a column's width in the sidebar (dsh's rule), so
    // the card carries the prose preview and nothing that unfolds the rest.
    const html = panel();

    expect(html).not.toContain("Step two finishes it.");
    expect(html).not.toContain("Hide plan");
  });

  it("offers the way into the full document, and omits it with no sidebar to address", () => {
    const withLink = panel(QUESTION, { onOpenPlan: () => undefined });
    expect(withLink).toContain("View full plan");
    expect(withLink).toContain("Open plan in sidebar");

    // A review from a session that has not started yet: the two verdicts are
    // still answerable, and there is nowhere to open anything.
    expect(panel()).not.toContain("View full plan");
  });

  it("keeps the change request behind its own action", () => {
    const idle = panel();
    expect(idle).not.toContain("Send changes");
    // The request is made, not written: the field appears only after the user
    // asks for it, and its send is the card's only text action.
    expect(idle).not.toContain("<textarea");
    expect(idle).toContain("Request changes");

    const editing = panel(QUESTION, { requesting: true, changes: "Name the flag" });
    expect(editing).toContain("<textarea");
    expect(editing).toContain("Name the flag");
    expect(editing).toContain("Send changes");
  });

  it("shows the plan's own first line when the asker declared no header", () => {
    // `header` is the asker's title; the document is the fallback for an asker
    // that described the request instead of repeating the plan's heading.
    const html = panel({
      ...QUESTION,
      header: undefined,
      detail: "# **Release** plan\n\nReview the changes before shipping.",
    });
    expect(html).toContain("<h3");
    expect(html).toContain("Plan");
    expect(html).toContain("Review the changes before shipping.");
  });

  it("renders the approve label verbatim, because that is what goes back on the wire", () => {
    // A translated button would send a string the asker never offered.
    const html = panel({ ...QUESTION, intent: { kind: "plan-review", approve: "批准这个计划" } });
    expect(html).toContain("批准这个计划");
  });

  it("reports a live failure in the footer", () => {
    expect(panel(QUESTION, { error: "Describe the changes before sending them." })).toContain(
      "Describe the changes before sending them.",
    );
  });
});

describe("planTitleOf", () => {
  it("takes the first line and strips the markdown furniture", () => {
    expect(planTitleOf("# **Release** plan\n\nBody")).toBe("Release plan");
    expect(planTitleOf("A single paragraph plan.")).toBe("A single paragraph plan.");
    expect(planTitleOf("")).toBe("");
  });
});

describe("planDescription", () => {
  it("skips the heading and reads the first paragraph as plain prose", () => {
    const plan = "# **Release** plan\n\nReview the [changes](https://example.com) before **shipping**.\n\n## Steps\n- Build";
    expect(planDescription(plan)).toBe("Review the changes before shipping.");
  });

  it("returns nothing for a plan that is only a title", () => {
    expect(planDescription("# Plan without a summary")).toBe("");
  });

  it("reads a heading-less plan as one paragraph, title included", () => {
    expect(planDescription("A single paragraph plan.")).toBe("A single paragraph plan.");
  });
});
