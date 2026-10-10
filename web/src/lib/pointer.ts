/**
 * Whether the pointer in use is a finger.
 *
 * Asked by the composer's key handling, and asked by nothing else: layout
 * decisions read the frame's measured width (`layout/columns.ts`) rather than
 * the device, because a narrow desktop window and a phone need the same
 * arrangement. This is the one question width cannot answer — a keyboard
 * behaves differently under a finger, and only this says whether there is one.
 *
 * `pointer: coarse` rather than `hover: none` or a UA string: it is the
 * capability the rule is actually about (the primary input has no precision),
 * it is false on a desktop with a touchscreen being driven by its mouse, and it
 * is true on a tablet with a trackpad attached only when that trackpad is the
 * primary pointer — which is the answer the caller wants either way.
 */

const QUERY = "(pointer: coarse)";

/** The query, created once: `matchMedia` is cheap but not free, and this is
 * called on every keystroke the composer sees. */
let cached: MediaQueryList | null | undefined;

function coarseQuery(): MediaQueryList | null {
  if (cached === undefined) {
    // `globalThis`, not `window`: the same object in a browser, and the one a
    // test can stub. A node script has neither, and `typeof` on a missing
    // global is the only way to ask without a `ReferenceError`.
    cached = typeof globalThis.matchMedia !== "function" ? null : globalThis.matchMedia(QUERY);
  }
  return cached;
}

/**
 * Whether the primary pointer is coarse.
 * @returns whether the device is being driven by touch; false everywhere the
 *   query cannot be asked (a node test, an engine without `matchMedia`), which
 *   is the desktop behaviour those environments are standing in for.
 */
export function isCoarsePointer(): boolean {
  return coarseQuery()?.matches ?? false;
}
