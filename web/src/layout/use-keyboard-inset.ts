import { useEffect } from "react";

/**
 * Publish how much of the frame the soft keyboard is covering, as
 * `--piws-keyboard-inset` on `documentElement`.
 *
 * The layout viewport does not shrink when a phone keyboard opens — it slides
 * under the keys — so a bottom-anchored surface (the composer) ends up behind
 * them with nothing in the CSS to say so. `visualViewport` is the only API that
 * reports what is actually visible, and the covered height is the difference
 * between the two viewports.
 *
 * `offsetTop` is subtracted because the visual viewport also *pans*: when the
 * browser scrolls the layout to keep the caret in view, `innerHeight - height`
 * grows without the keyboard having moved. Taking the offset back out leaves
 * the reading about the keyboard, which is the only thing this is for.
 *
 * The value is written to the root element rather than through React state on
 * purpose: it changes on every frame of the keyboard's animation, and a store
 * write per frame would re-render the whole shell to move one padding.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    // Absent on desktop browsers, and on anything that never has a keyboard to
    // avoid (the lib's type is nullable rather than optional). The token keeps
    // its 0px default and nothing else has to branch.
    if (viewport === null || viewport === undefined) return;

    let frame: number | null = null;
    const apply = (): void => {
      frame = null;
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty(
        "--piws-keyboard-inset",
        `${String(Math.round(covered))}px`,
      );
    };
    // Both events fire far more often than the value changes — `resize` while
    // the keyboard animates, `scroll` on every pan the browser makes to follow
    // the caret — so the write is coalesced to one per painted frame.
    const schedule = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
      // The shell may be unmounting with the keyboard open; a stale inset would
      // leave the next mount padded until its first event.
      document.documentElement.style.removeProperty("--piws-keyboard-inset");
    };
  }, []);
}
