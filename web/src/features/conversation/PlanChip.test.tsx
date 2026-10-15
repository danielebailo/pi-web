import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppState } from "../../lib/app-state.ts";
import { PlanChip } from "./PlanChip.tsx";

// The copy renders through `useT`, which falls back to the host locale when the
// preference is `system`. Pin it so the assertions read one language.
vi.stubGlobal("navigator", { language: "en" });

beforeEach(() => {
  resetAppState();
});

afterEach(() => {
  resetAppState();
});

describe("PlanChip", () => {
  it("says that pressing it turns plan mode off, which is the only thing it does", () => {
    // dsh's chip appears only while the mode is on and executes `/plan off`;
    // entering is the `/plan` command, so the chip is never a toggle.
    const html = renderToStaticMarkup(<PlanChip onExit={() => Promise.resolve()} />);

    expect(html).toContain("Plan mode on, press to turn off");
    expect(html).toContain("Plan mode on — click to turn off (/plan off)");
    expect(html).toContain(">Plan<");
  });

  it("carries both glyphs, so the pointer's mark is the pending click's meaning", () => {
    const html = renderToStaticMarkup(<PlanChip onExit={() => Promise.resolve()} />);

    // Both are in the DOM; CSS decides which one is drawn (dsh's rule).
    expect(html).toContain("<svg");
    expect((html.match(/<svg/g) ?? []).length).toBe(2);
  });

  it("keeps its aria-label when a narrow frame drops the word", () => {
    const compact = renderToStaticMarkup(<PlanChip compact onExit={() => Promise.resolve()} />);

    expect(compact).toContain("Plan mode on, press to turn off");
    expect(compact).toContain('data-compact="true"');
    // The label is gone from the row; the accessible name is not.
    expect(compact).not.toContain(">Plan<");
  });
});
