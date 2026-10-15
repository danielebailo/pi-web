/**
 * Where a tooltip bubble goes, as arithmetic.
 *
 * dsh measures the anchor, measures the bubble, and then clamps it into the
 * viewport and flips sides — that fit step is the part that breaks silently
 * (a bubble half off-screen still "renders"), so it lives here as a plain
 * function with the numbers passed in. The component that owns the DOM only
 * feeds it two rects and writes the result back to `style`.
 */

/** The anchor's viewport rect, reduced to the three numbers the fit needs. */
export interface TooltipAnchor {
  top: number;
  bottom: number;
  /** Horizontal middle, so the bubble can be centred rather than left-aligned. */
  center: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export type TooltipSide = "top" | "bottom";

export interface TooltipPlacement {
  left: number;
  top: number;
  /** The side actually used: `side`, unless that side did not fit and the other did. */
  side: TooltipSide;
}

/** Distance between the anchor edge and the bubble. */
export const TOOLTIP_GAP = 8;
/** Keep this much clear of the viewport edge. */
export const TOOLTIP_EDGE_MARGIN = 12;

/** `DOMRect` (or any rect) reduced to a `TooltipAnchor`. */
export function tooltipAnchor(rect: { top: number; bottom: number; left: number; width: number }): TooltipAnchor {
  return { top: rect.top, bottom: rect.bottom, center: rect.left + rect.width / 2 };
}

/**
 * Clamp horizontally, flip vertically only when the preferred side does not fit
 * and the other one does.
 *
 * When neither side fits the preferred side is kept: a bubble that overlaps the
 * anchor is still readable, whereas one pushed off-screen is not, and flipping
 * into a space that is too small only moves the overflow.
 */
export function tooltipPlacement(
  anchor: TooltipAnchor,
  size: TooltipSize,
  viewport: TooltipViewport,
  side: TooltipSide = "bottom",
  gap: number = TOOLTIP_GAP,
): TooltipPlacement {
  const left = Math.max(
    TOOLTIP_EDGE_MARGIN,
    Math.min(anchor.center - size.width / 2, viewport.width - TOOLTIP_EDGE_MARGIN - size.width),
  );
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height <= viewport.height - TOOLTIP_EDGE_MARGIN;
  const fitsAbove = above >= TOOLTIP_EDGE_MARGIN;
  if (side === "bottom") {
    return !fitsBelow && fitsAbove ? { left, top: above, side: "top" } : { left, top: below, side: "bottom" };
  }
  return !fitsAbove && fitsBelow ? { left, top: below, side: "bottom" } : { left, top: above, side: "top" };
}
