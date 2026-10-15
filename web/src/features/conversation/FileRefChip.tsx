import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileIcon } from "../../components/icons.tsx";
import { useT } from "../../lib/app-state.ts";
import { fileRefLabel, fileRefTitle, type FileRef } from "./file-ref.ts";
import styles from "./FileRefChip.module.css";

/** dsh opens its hover card after half a second; passing over a chip costs nothing. */
const PREVIEW_DELAY_MS = 400;

/**
 * Grace a pointer gets to cross from the chip onto the preview.
 *
 * Without it the panel closes the instant the pointer leaves the chip, so the
 * picture on it can never be looked at — the same 200ms dsh's `HoverCard` uses
 * for the same trip.
 */
const PREVIEW_GRACE_MS = 200;

/** Room above a chip before the preview opens downward instead. */
const PREVIEW_MAX_HEIGHT_PX = 240;
const PREVIEW_MAX_WIDTH_PX = 320;
const PREVIEW_GAP_PX = 8;

/** Where the preview sits, in viewport coordinates. */
interface Placement {
  left: number;
  /** Set when it opens upward: the distance from the viewport's bottom edge. */
  bottom?: number;
  /** Set when it opens downward. */
  top?: number;
}

/** Measure and place the preview against the chip that opened it. */
function place(node: HTMLElement): Placement {
  const rect = node.getBoundingClientRect();
  const width = Math.min(PREVIEW_MAX_WIDTH_PX, window.innerWidth - PREVIEW_GAP_PX * 2);
  // Clamped to the viewport: a chip at the right edge would otherwise push the
  // picture off screen, and one near the left must not be pushed to the margin.
  const left = Math.max(PREVIEW_GAP_PX, Math.min(rect.left, window.innerWidth - width - PREVIEW_GAP_PX));
  // Room is measured from the two constants rather than from a rendered height:
  // the frame has to be placed before the picture has loaded, so its height is
  // not known yet.
  return rect.top < PREVIEW_MAX_HEIGHT_PX + PREVIEW_GAP_PX * 2
    ? { left, top: rect.bottom + PREVIEW_GAP_PX }
    : { left, bottom: window.innerHeight - rect.top + PREVIEW_GAP_PX };
}

/**
 * A file a message points at, as one clickable chip.
 *
 * dsh draws the same thing for the same reason: the path an agent names in prose
 * is where the reader wants to go next, and making them copy it into a picker to
 * get there is the work this removes. The chip is a `<button>`, not an anchor —
 * it navigates inside the app, there is no URL to middle-click, and a file that
 * does not exist belongs in the preview's own failure state rather than in a
 * browser error page.
 *
 * The label is the point of the chip and the `title` is the disambiguator, which
 * is dsh's split (`presentedFileMentions`): a reader scanning a sentence needs
 * `useConversation.ts:396`, not the four directories in front of it, and the
 * hover has room for both. When the author wrote their own label
 * (`[the loader](src/app.ts#L24)`), that text wins — it is what the sentence
 * says, and the lines are in the title.
 *
 * `preview` is the one thing hover adds: an image reference shows the picture
 * without being clicked, so "which screenshot is this?" is answered in place
 * rather than by opening a tab and closing it. It is only ever set for a file
 * the server will actually stream (`isImageName`), and it is deliberately
 * pointer-and-keyboard only — a chip that showed a picture on tap would fight
 * the click that opens the file.
 */
export function FileRefChip({
  file,
  label,
  preview,
  onOpen,
}: {
  /** The resolved reference: what to open, and where in it. */
  file: FileRef;
  /** The author's own text, when the reference came from a labeled link. */
  label?: string | undefined;
  /** The URL to show on hover, for an image; absent means no preview. */
  preview?: { url: string; name: string } | undefined;
  onOpen: () => void;
}) {
  const t = useT();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const armTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [placed, setPlaced] = useState<Placement | null>(null);
  const [failed, setFailed] = useState(false);

  /** Any pending open or close is dropped: the next event decides again. */
  const clearTimers = (): void => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(() => clearTimers, []);

  // A preview is placed in viewport coordinates, so scrolling or resizing under
  // it makes those coordinates wrong. Closing is honest and cheap: the pointer
  // is either moving the page or the window, and re-entering the chip reopens it.
  useEffect(() => {
    if (placed === null) return;
    const close = (): void => {
      clearTimers();
      setPlaced(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [placed]);

  const arm = (): void => {
    if (preview === undefined) return;
    clearTimers();
    armTimer.current = window.setTimeout(() => {
      armTimer.current = null;
      const node = anchorRef.current;
      if (node === null) return;
      setFailed(false);
      setPlaced(place(node));
    }, PREVIEW_DELAY_MS);
  };

  const scheduleClose = (): void => {
    if (preview === undefined) return;
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPlaced(null);
    }, PREVIEW_GRACE_MS);
  };

  const hold = (): void => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.chip}
        title={fileRefTitle(file)}
        data-file-ref={file.path}
        data-file-line={file.line}
        // The preview's URL is on the chip itself, not only in the hover state:
        // it is what a test can read to tell "this reference has a picture to
        // show" apart from "the pointer has not been over it long enough".
        data-file-preview-url={preview?.url}
        {...(preview === undefined
          ? {}
          : { onMouseEnter: arm, onMouseLeave: scheduleClose, onFocus: arm, onBlur: scheduleClose })}
        onClick={onOpen}
      >
        <FileIcon className={styles.glyph} width={12} height={12} />
        <span className={styles.name}>{label ?? fileRefLabel(file)}</span>
      </button>
      {placed === null || preview === undefined
        ? null
        : createPortal(
            <div
              className={styles.preview}
              data-file-preview={file.path}
              style={{ left: placed.left, ...(placed.top === undefined ? { bottom: placed.bottom } : { top: placed.top }) }}
              onMouseEnter={hold}
              onMouseLeave={scheduleClose}
            >
              {failed ? (
                <span className={styles.previewFailed}>{t("preview.unsupported")}</span>
              ) : (
                <img
                  className={styles.previewImage}
                  src={preview.url}
                  alt={preview.name}
                  onError={() => {
                    setFailed(true);
                  }}
                />
              )}
              <span className={styles.previewName}>{preview.name}</span>
            </div>,
            document.body,
          )}
    </>
  );
}
