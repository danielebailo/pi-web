import { describe, expect, it } from "vitest";
import {
  TOOLTIP_EDGE_MARGIN,
  TOOLTIP_GAP,
  tooltipAnchor,
  tooltipPlacement,
  type TooltipAnchor,
} from "./tooltip-position.ts";

const viewport = { width: 1000, height: 800 };
const size = { width: 120, height: 28 };

/** An anchor whose top edge is at `top` and which is `height` tall. */
function anchorAt(center: number, top = 100, height = 28): TooltipAnchor {
  return { top, bottom: top + height, center };
}

describe("tooltipAnchor", () => {
  it("takes the middle of the rect, not its left edge", () => {
    expect(tooltipAnchor({ top: 10, bottom: 38, left: 200, width: 40 })).toEqual({
      top: 10,
      bottom: 38,
      center: 220,
    });
  });
});

describe("tooltipPlacement", () => {
  it("sits below the anchor, centred on it", () => {
    expect(tooltipPlacement(anchorAt(500), size, viewport)).toEqual({
      left: 440,
      top: 100 + 28 + TOOLTIP_GAP,
      side: "bottom",
    });
  });

  it("keeps the edge margin when the anchor is at the left of the viewport", () => {
    expect(tooltipPlacement(anchorAt(10), size, viewport).left).toBe(TOOLTIP_EDGE_MARGIN);
  });

  it("keeps the edge margin when the anchor is at the right of the viewport", () => {
    expect(tooltipPlacement(anchorAt(995), size, viewport).left).toBe(
      viewport.width - TOOLTIP_EDGE_MARGIN - size.width,
    );
  });

  it("flips above when there is no room below and there is above", () => {
    const anchor: TooltipAnchor = { top: 700, bottom: 728, center: 500 };
    expect(tooltipPlacement(anchor, size, { width: 1000, height: 740 })).toEqual({
      left: 440,
      top: 700 - TOOLTIP_GAP - size.height,
      side: "top",
    });
  });

  it("keeps the preferred side when neither side fits", () => {
    // 58 + 8 + 28 = 94 overflows a 90px viewport, and 30 - 8 - 28 is above the
    // top margin, so the bubble stays where it was asked to be rather than
    // landing off-screen.
    const tight = { width: 1000, height: 90 };
    expect(tooltipPlacement(anchorAt(500, 30), size, tight)).toEqual({
      left: 440,
      top: 30 + 28 + TOOLTIP_GAP,
      side: "bottom",
    });
  });

  it("honours a top preference, and flips it when it does not fit", () => {
    expect(tooltipPlacement(anchorAt(500, 400), size, viewport, "top").side).toBe("top");
    expect(tooltipPlacement(anchorAt(500, 400), size, viewport, "top").top).toBe(
      400 - TOOLTIP_GAP - size.height,
    );
    expect(tooltipPlacement(anchorAt(500, 20), size, viewport, "top").side).toBe("bottom");
  });
});
