import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppState } from "../../lib/app-state.ts";
import { planStore, rememberTemporaryPlan } from "./plan-store.ts";
import { PlanTab } from "./PlanTab.tsx";
import { makePlanTab, REVIEW_TARGET_PREFIX } from "./rightbar-state.ts";

// The copy renders through `useT`, which falls back to the host locale when the
// preference is `system`. Pin it so the assertions read one language.
vi.stubGlobal("navigator", { language: "en" });

const SESSION = "/sessions/p1/s.jsonl";

beforeEach(() => {
  resetAppState();
  planStore.set({ bySession: {}, temporary: {} });
});

afterEach(() => {
  planStore.set({ bySession: {}, temporary: {} });
});

describe("PlanTab", () => {
  it("renders the logged plan's markdown, titled by the plan itself", () => {
    planStore.set({
      bySession: { [SESSION]: [{ callId: "call-1", title: "Migration plan", plan: "# Migration plan\n\nStep one." }] },
      temporary: {},
    });

    const html = renderToStaticMarkup(
      <PlanTab sessionPath={SESSION} tab={makePlanTab("call-1", "Migration plan")} />,
    );

    expect(html).toContain("Migration plan");
    expect(html).toContain("Step one.");
    expect(html).toContain('data-plan-preview="call-1"');
  });

  it("says a logged plan is unavailable rather than expired when nothing has been published", () => {
    // A tab restored from a saved layout whose session is not open yet: the
    // document is not gone, it is simply not readable right now.
    const html = renderToStaticMarkup(
      <PlanTab sessionPath={SESSION} tab={makePlanTab("call-1", "Migration plan")} />,
    );

    expect(html).toContain("Plan preview is unavailable");
    expect(html).not.toContain("has expired");
  });

  it("says a temporary review has expired once its in-memory copy is gone", () => {
    // A call-less review keeps its document in memory only, so a reload is what
    // ends it — and the card that can reopen it is named, because it is the only
    // way back.
    const html = renderToStaticMarkup(
      <PlanTab
        sessionPath={SESSION}
        tab={makePlanTab(`${REVIEW_TARGET_PREFIX}q-1`, "Temporary")}
      />,
    );

    expect(html).toContain("has expired");
    expect(html).toContain("pending review card");
  });

  it("renders a temporary review while its document is still in memory", () => {
    rememberTemporaryPlan("q-1", { title: "Temporary review", plan: "# Temporary\n\nUnlogged." });

    const html = renderToStaticMarkup(
      <PlanTab
        sessionPath={SESSION}
        tab={makePlanTab(`${REVIEW_TARGET_PREFIX}q-1`, "Temporary review")}
      />,
    );

    expect(html).toContain("Unlogged.");
    expect(html).toContain(`data-plan-preview="${REVIEW_TARGET_PREFIX}q-1"`);
  });
});
