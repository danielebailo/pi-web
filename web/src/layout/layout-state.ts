import { createStore } from "../lib/store.ts";
import { SIDEBAR_DEFAULT, isNarrow } from "./columns.ts";

/**
 * The shell's frame state: how wide the frame is, and which of the two
 * sidebar presentations it is showing.
 *
 * Kept apart from `app-state` for the same reason `rightbar-state` is: this is
 * shell geometry, not workspace data, and the only components that care are the
 * frame, the sidebar and the panel that has to make room for itself. The store
 * is React-free like the others; `useStore` is the reader.
 *
 * ## Why a measured viewport instead of a media query
 *
 * dsh solves its columns from the **frame's measured width**, not from the
 * window's, and the difference matters here: this shell is also rendered inside
 * an Electron window that can be narrower than the screen. A `matchMedia`
 * breakpoint would read the display and keep three columns in a 900px window.
 * The frame measures itself with a `ResizeObserver` (`AppFrame`/`AppLayout`) and
 * writes the reading here, so one rule covers the browser and the shell.
 *
 * ## The two presentations
 *
 * Wide frames use the preference: `sidebarWidth`, where **0 means collapsed** —
 * dsh's own spelling of the same fact, so the two stay diffable. Narrow frames
 * ignore it entirely and use `narrowExpanded` instead, an override that is
 * dropped whenever the frame crosses the breakpoint in either direction. That
 * drop is what keeps growing a window from leaving a drawer hanging over a
 * layout that has room for the column properly.
 */
export interface LayoutState {
  /**
   * Frame width in CSS pixels, written by the frame's `ResizeObserver`.
   *
   * 0 means "not measured yet" rather than "infinitely narrow": the first
   * commit must not read as a phone and flash a drawer over a desktop layout.
   * `isNarrow` is where that distinction lives.
   */
  viewportWidth: number;
  /** Narrow frame only: the user pulled the sidebar over the squeezed centre. */
  narrowExpanded: boolean;
  /** Wide frame only: the sidebar's width preference; 0 is collapsed. */
  sidebarWidth: number;
}

const INITIAL: LayoutState = {
  // The window's width, not 0: the first paint has to land somewhere, and a
  // zero would solve every column to nothing until the observer's first
  // reading arrives a frame later (a visible flash of empty shell). The frame
  // then measures itself and corrects this — the two differ only by the
  // window chrome, which is on the shell's side of the measurement anyway.
  viewportWidth: typeof window === "undefined" ? 0 : window.innerWidth,
  narrowExpanded: false,
  // dsh's `SIDEBAR_DEFAULT`: a fresh frame shows the column.
  sidebarWidth: SIDEBAR_DEFAULT,
};

export const layoutStore = createStore<LayoutState>(INITIAL);

export const layoutActions = {
  /**
   * Record the frame's measured width.
   *
   * Crossing the auto-collapse breakpoint in either direction drops the narrow
   * override, which is dsh's rule and the reason it is stated here rather than
   * in the component: the override has no meaning on the other side of the
   * line. The first measurement (from 0) is not a crossing — 0 is "unknown",
   * and treating it as narrow would announce a phone on every load.
   */
  setViewportWidth(width: number): void {
    layoutStore.update((state) => {
      if (state.viewportWidth === width) return state;
      const crossed =
        state.viewportWidth > 0 && isNarrow(state.viewportWidth) !== isNarrow(width);
      return {
        ...state,
        viewportWidth: width,
        narrowExpanded: crossed ? false : state.narrowExpanded,
      };
    });
  },

  /**
   * Flip the sidebar, whichever presentation the frame is in.
   *
   * Narrow frames flip only the override: the width preference survives
   * untouched, so re-widening restores the layout the user had before the
   * squeeze. Wide frames collapse to 0 and restore the default, forgetting any
   * drag width — this shell has no sidebar drag yet, so there is none to keep.
   */
  toggleSidebar(): void {
    layoutStore.update((state) => {
      if (isNarrow(state.viewportWidth)) {
        return { ...state, narrowExpanded: !state.narrowExpanded };
      }
      return {
        ...state,
        sidebarWidth: state.sidebarWidth === 0 ? SIDEBAR_DEFAULT : 0,
      };
    });
  },

  /**
   * Close the narrow drawer after the user has acted inside it.
   *
   * A no-op on a wide frame: there the column is a track, and picking a session
   * from it is not a reason to take it away.
   */
  collapseNarrow(): void {
    layoutStore.update((state) => {
      if (!state.narrowExpanded) return state;
      return { ...state, narrowExpanded: false };
    });
  },
};

/**
 * The width the sidebar column should occupy in this frame, and whether it is
 * drawn as an overlay rather than a track.
 *
 * One place answers both because they are the same question asked twice: the
 * narrow drawer takes no track from the centre (`width` 0) even while it is on
 * screen, which is what lets it hang over a column that has already given its
 * room away.
 *
 * @param state - the current frame state.
 * @returns `width` for the flex track, and `overlay` for the narrow drawer.
 */
export function sidebarGeometry(state: LayoutState): { width: number; overlay: boolean } {
  if (isNarrow(state.viewportWidth)) {
    return { width: 0, overlay: state.narrowExpanded };
  }
  return { width: state.sidebarWidth, overlay: false };
}
