import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent, ReactElement, Ref } from "react";
import { createPortal } from "react-dom";
import {
  tooltipAnchor,
  tooltipPlacement,
  type TooltipAnchor,
  type TooltipPlacement,
  type TooltipSide,
} from "./tooltip-position.ts";
import styles from "./Tooltip.module.css";

interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined;
  onMouseEnter?: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onMouseLeave?: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
  onFocus?: ((event: ReactFocusEvent<HTMLElement>) => void) | undefined;
  onBlur?: ((event: ReactFocusEvent<HTMLElement>) => void) | undefined;
  onClick?: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined;
}

interface TooltipProps {
  label: string;
  side?: TooltipSide;
  /** The single element the bubble describes; it keeps its own handlers. */
  children: ReactElement<AnchorProps>;
}

/**
 * dsh's tooltip, reduced to what this UI needs: a label, a preferred side, and
 * a bubble that follows the anchor on hover *and* on keyboard focus.
 *
 * The bubble is portalled to `document.body` because the transcript is a
 * scrolling, clipped box that also declares `container-type: inline-size` — a
 * `position: fixed` bubble left inside it would be clipped by the scrollport and
 * would be positioned against the container instead of the viewport. It is
 * hidden with `visibility` rather than not rendered, so it can measure itself
 * before the first paint; the measured numbers go through `tooltipPlacement`.
 *
 * `title` is deliberately not set on the anchor: the two would show the same
 * sentence, the native one after its own delay and with the browser's styling.
 */
export function Tooltip({ label, side = "bottom", children }: TooltipProps): ReactElement {
  const nodeRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);

  const ownRef = children.props.ref;
  const setNode = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      if (typeof ownRef === "function") ownRef(node);
      else if (ownRef !== null && typeof ownRef === "object") {
        (ownRef as { current: HTMLElement | null }).current = node;
      }
    },
    [ownRef],
  );

  const hide = useCallback((): void => {
    setAnchor(null);
    setPlacement(null);
  }, []);

  const show = useCallback((element: HTMLElement): void => {
    setAnchor(tooltipAnchor(element.getBoundingClientRect()));
  }, []);

  // Measure the bubble (still invisible) and place it. Runs before paint, so
  // there is no frame where the bubble sits at 0,0.
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (anchor === null || bubble === null) return;
    const box = bubble.getBoundingClientRect();
    setPlacement(
      tooltipPlacement(
        anchor,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
        side,
      ),
    );
  }, [anchor, side, label]);

  // The anchor can move without the pointer moving (a scroll, a resize), and
  // then the bubble would be pointing at nothing. Scrolling anywhere counts,
  // hence the capture listener.
  useEffect(() => {
    if (anchor === null) return;
    const listener = (): void => hide();
    window.addEventListener("scroll", listener, true);
    window.addEventListener("resize", listener);
    return () => {
      window.removeEventListener("scroll", listener, true);
      window.removeEventListener("resize", listener);
    };
  }, [anchor, hide]);

  const child = cloneElement(children, {
    ref: setNode,
    onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => {
      children.props.onMouseEnter?.(event);
      show(event.currentTarget);
    },
    onMouseLeave: (event: ReactMouseEvent<HTMLElement>) => {
      children.props.onMouseLeave?.(event);
      hide();
    },
    onFocus: (event: ReactFocusEvent<HTMLElement>) => {
      children.props.onFocus?.(event);
      show(event.currentTarget);
    },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => {
      children.props.onBlur?.(event);
      hide();
    },
    // Activating the anchor (the copy button, say) is the answer the bubble was
    // there for, so it steps aside instead of covering the result.
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      children.props.onClick?.(event);
      hide();
    },
  });

  return (
    <>
      {child}
      {anchor === null
        ? null
        : createPortal(
            <span
              ref={bubbleRef}
              role="tooltip"
              className={styles.bubble}
              data-side={placement?.side ?? side}
              style={
                placement === null
                  ? { visibility: "hidden", left: 0, top: 0 }
                  : { left: placement.left, top: placement.top }
              }
            >
              <span className={styles.label}>{label}</span>
            </span>,
            document.body,
          )}
    </>
  );
}
