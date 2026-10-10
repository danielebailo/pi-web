import { useEffect, type RefObject } from "react";
import { layoutActions } from "./layout-state.ts";

/**
 * Report the frame's own width to `layoutStore`.
 *
 * A `ResizeObserver` on the frame element rather than a `resize` listener on
 * the window: the frame is the thing whose width the column solve is about, and
 * it is not always the window (the Electron window can be narrower than the
 * screen, and a future split view would narrow it further without a window
 * resize at all).
 *
 * The observer is throttled through `requestAnimationFrame` because a window
 * drag fires far more often than a frame is painted, and every reading ends in
 * a store write and a full re-render of the shell. dsh does the same in
 * `AppFrame.tsx`, for the same reason.
 *
 * A zero reading is dropped rather than written: an element that has been
 * detached, or a frame rendered under `display: none`, measures 0, and writing
 * it would make the shell believe the window is infinitely narrow.
 *
 * @param ref - the frame element to measure.
 * @param enabled - whether the frame is on screen. The settings page replaces
 *   the shell, detaching the observed element; gating on this makes the
 *   observer attach again when the frame comes back, instead of leaving the
 *   last reading (or none) in place.
 */
export function useFrameWidth(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (element === null) return;
    // Absent in the node test environment (jsdom does not implement it). The
    // frame then keeps the width it was given, which is what a static render
    // means anyway.
    if (typeof ResizeObserver === "undefined") return;

    let frame: number | null = null;
    const measure = (): void => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) layoutActions.setViewportWidth(width);
    };

    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
}
