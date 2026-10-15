import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import styles from "./ConversationWidthControls.module.css";

/**
 * The transcript width axis, ported from dsh's ConversationWidthControls:
 * a live measurement var, an optional persisted preference, and two
 * pointer-captured drag strips flanking the reading column.
 *
 * pi offers no width API, so this is a pure client preference — the same
 * localStorage key dsh uses, resolved against the same floor/edge-budget.
 *
 * The host is the pane root (already the positioning context its floating
 * controls use): the strips hang as its direct children, spanning everything
 * below the header, and the resolved width is published onto it as vars the
 * transcript column and composer clamp against.
 */

/** localStorage key for the dragged transcript width preference (px). */
const WIDTH_PREF_KEY = "dsh.conversation.contentWidth";
/** Floor for a dragged content width; matches the layout center-column minimum. */
const CONTENT_MIN = 640;
/** Horizontal room reserved for both handles and their safe edge zones. */
const CONTENT_EDGE_BUDGET = 176;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const FALLBACK_WHEEL_LINE_PX = 16;

/** Read a valid persisted width preference, or null when absent or corrupt. */
function readWidthPreference(): number | null {
  const raw = localStorage.getItem(WIDTH_PREF_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Resolve the width displayed for one measured pane column. */
function resolveContentWidth(columnWidth: number, preference: number | null): number {
  const max = Math.max(CONTENT_MIN, columnWidth - CONTENT_EDGE_BUDGET);
  if (preference !== null) return Math.min(Math.max(preference, CONTENT_MIN), max);
  return Math.max(680, Math.min(columnWidth * 0.64, 920));
}

/** Convert a wheel event's vertical delta to scrollport pixels. */
function wheelDeltaY(event: React.WheelEvent, scrollport: HTMLElement): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(scrollport).lineHeight);
    return event.deltaY * (Number.isFinite(lineHeight) ? lineHeight : FALLBACK_WHEEL_LINE_PX);
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * scrollport.clientHeight;
  return event.deltaY;
}

/** One pointer-captured transcript width handle. */
function WidthHandle(props: {
  side: "left" | "right";
  onStart: () => number;
  onDrag: (width: number) => void;
  onCommit: (width: number) => void;
  onEnd: () => void;
}) {
  const dragging = useRef(false);
  const base = useRef(0);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  const outwardWidth = () => {
    const dx = latest.current - origin.current;
    // Both strips drive the same width, mirrored so a pull always widens.
    const outward = callbacks.current.side === "right" ? dx : -dx;
    return base.current + outward * 2;
  };
  const cancelFrame = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = event.clientX;
    latest.current = event.clientX;
    base.current = callbacks.current.onStart();
    dragging.current = true;
    event.currentTarget.toggleAttribute("data-dragging", true);
  }, []);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--conversation-width-handle-pointer-y",
      `${event.clientY - box.top}px`,
    );
    latest.current = event.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(outwardWidth());
    });
  }, []);
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    dragging.current = false;
    event.currentTarget.toggleAttribute("data-dragging", false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    cancelFrame();
    latest.current = event.clientX;
    // A press-only gesture must not overwrite a wider preference with its
    // window-clamped display value.
    if (latest.current !== origin.current) callbacks.current.onCommit(outwardWidth());
    callbacks.current.onEnd();
  }, []);
  const onPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.toggleAttribute("data-dragging", false);
    // Cancellation abandons persistence and restores the saved width through onEnd.
    cancelFrame();
    callbacks.current.onEnd();
  }, []);
  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const host = event.currentTarget.parentElement;
    if (host === null) return;
    const scrollport = host.querySelector<HTMLElement>(":scope > [data-conversation-scroll]");
    if (scrollport === null) return;
    if (event.ctrlKey || event.deltaY === 0) return;
    scrollport.scrollBy({ top: wheelDeltaY(event, scrollport) });
  }, []);

  return (
    <div
      className={styles.widthHandle}
      data-side={props.side}
      data-width-handle={props.side}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onWheel={onWheel}
    />
  );
}

/**
 * Install the conversation width axis on the pane and render its drag handles.
 * @param hostRef - the session pane root; measured live and published onto as
 *   `--conversation-column-width` (live width) and `--conversation-user-width`
 *   (the resolved preference, absent until the user drags).
 */
export function ConversationWidthControls({ hostRef }: { hostRef: RefObject<HTMLDivElement | null> }) {
  const publishWidths = useCallback((host: HTMLDivElement): void => {
    const column = host.offsetWidth;
    host.style.setProperty("--conversation-column-width", `${column}px`);
    const preference = readWidthPreference();
    if (preference === null) host.style.removeProperty("--conversation-user-width");
    else host.style.setProperty("--conversation-user-width", `${resolveContentWidth(column, preference)}px`);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const observer = new ResizeObserver(() => {
      publishWidths(host);
    });
    observer.observe(host);
    publishWidths(host);
    return () => {
      observer.disconnect();
    };
  }, [hostRef, publishWidths]);

  const onStart = useCallback((): number => {
    const host = hostRef.current;
    if (host === null) return 680;
    return resolveContentWidth(host.offsetWidth, readWidthPreference());
  }, [hostRef]);
  const onDrag = useCallback(
    (width: number): void => {
      const host = hostRef.current;
      if (host === null) return;
      host.style.setProperty("--conversation-user-width", `${resolveContentWidth(host.offsetWidth, width)}px`);
    },
    [hostRef],
  );
  const onCommit = useCallback(
    (width: number): void => {
      const host = hostRef.current;
      if (host === null) return;
      localStorage.setItem(WIDTH_PREF_KEY, `${resolveContentWidth(host.offsetWidth, width)}`);
    },
    [hostRef],
  );
  const onEnd = useCallback((): void => {
    const host = hostRef.current;
    if (host !== null) publishWidths(host);
  }, [hostRef, publishWidths]);

  return (["left", "right"] as const).map((side) => (
    <WidthHandle
      key={side}
      side={side}
      onStart={onStart}
      onDrag={onDrag}
      onCommit={onCommit}
      onEnd={onEnd}
    />
  ));
}
