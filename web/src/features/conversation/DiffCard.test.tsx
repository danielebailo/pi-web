import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiffCard } from "./DiffCard.tsx";

// The chrome resolves through `useT`; pin the host locale to the wording the
// assertions read (see MessageList.test.tsx for the same convention).
vi.stubGlobal("navigator", { language: "zh-CN" });

describe("DiffCard", () => {
  it("draws the path header and the +/- rows", () => {
    const html = renderToStaticMarkup(
      <DiffCard diffs={[{ path: "src/a.ts", oldText: "alpha\nbeta", newText: "alpha\nBETA" }]} />,
    );
    expect(html).toContain("src/a.ts");
    expect(html).toContain(">beta</div>");
    expect(html).toContain(">BETA</div>");
  });

  it("folds a long body behind an expand toggle that names the hidden count", () => {
    const oldText = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    // Two distant changes produce two hunks; with context they overflow the
    // 9-row chat cap (path + 7 + gap + 7 = 16 rows).
    const newText = oldText.replace("line 5", "LINE 5").replace("line 25", "LINE 25");
    // Two distant changes produce two hunks; with 3 context lines each hunk
    // draws 8 rows, plus path and gap = 18 rows, so 9 fold away.
    const html = renderToStaticMarkup(<DiffCard diffs={[{ path: "big.ts", oldText, newText }]} />);
    expect(html).toContain("展开其余 9 行差异");
    // The folded middle (hunk 1's tail through hunk 2's head) must not already
    // be in the markup; hunk 1's own addition sits inside it.
    expect(html).not.toContain("LINE 5");
  });

  it("offers no toggle when the body fits the cap", () => {
    const html = renderToStaticMarkup(<DiffCard diffs={[{ path: "small.ts", oldText: "a", newText: "b" }]} />);
    expect(html).not.toContain("其余");
    expect(html).toContain("small.ts");
  });

  it("carries the wrap switch in its unchecked state", () => {
    const html = renderToStaticMarkup(
      <DiffCard diffs={[{ path: "f.ts", oldText: "a", newText: "b" }]} />,
    );
    expect(html).toContain("自动换行");
    expect(html).toContain('aria-pressed="false"');
  });
});
