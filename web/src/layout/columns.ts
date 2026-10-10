/**
 * Normal column geometry for the shell's three tracks.
 *
 * Ported from deepseek-harness
 * `packages/client/ui-layout/src/client/columns.ts`, constants included: the
 * numbers are one decision, and splitting them from the solve is how the two
 * drift. The comment on each is dsh's own reasoning, kept so the two files stay
 * diffable.
 *
 * One thing deliberately does not follow dsh, noted where it happens: this
 * shell has no icon rail, so a collapsed sidebar takes zero width instead of
 * `SIDEBAR_COLLAPSED`. See `computeColumns`.
 */

/** Resolved widths for one frame. */
export interface Columns {
  sidebar: number;
  center: number;
  rightbar: number;
}

/** Center width protected while the normal right column is open. */
export const CENTER_MIN = 400;

/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264;

/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420;

/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280;

/**
 * Viewport width below which the sidebar auto-collapses; a manual toggle below
 * it re-expands over the squeezed center (`narrowExpanded` in `layout-state`).
 * dsh's deepsuite LG breakpoint.
 */
export const SIDEBAR_AUTO_COLLAPSE = 1024;

/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300;

/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7;

/** First-open right panel preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45;

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

/**
 * Solve the three column widths for one viewport frame.
 *
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = collapsed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @param collapsedWidth - track width of the collapsed sidebar. This shell has
 *   no rail, so the default is 0 and the column disappears; the parameter
 *   exists because `AppLayout` passes `0` for the narrow case for the same
 *   reason dsh passes it on macOS ("desktop reopen controls occupy the frame's
 *   shell.leading seat").
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(
  viewport: number,
  sidebar: number,
  rightbar: number,
  collapsedWidth = 0,
): Columns {
  const s = sidebar === 0 ? collapsedWidth : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const available = viewport - s - CENTER_MIN;
  const r =
    rightbar === 0 || available < RIGHTBAR_MIN
      ? 0
      : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO));
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r };
}

/**
 * Whether a frame this wide is too narrow to hold the sidebar beside the
 * conversation, i.e. whether the sidebar gives way to a drawer.
 * @param viewport - measured frame width in px; 0 means "not measured yet",
 *   which must not read as narrow or the first frame would flash a drawer.
 * @returns whether the frame is below the auto-collapse breakpoint.
 */
export function isNarrow(viewport: number): boolean {
  return viewport > 0 && viewport < SIDEBAR_AUTO_COLLAPSE;
}
