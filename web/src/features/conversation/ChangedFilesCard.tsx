import { useEffect, useMemo, useRef, useState } from "react";
import type { Translate } from "../../lib/i18n/index.ts";
import { ChevronIcon } from "../../components/icons.tsx";
import { DiffLines } from "../rightbar/DiffHunk.tsx";
import { DiffIcon, FileIcon } from "../rightbar/rightbar-icons.tsx";
import { parseUnifiedDiff } from "../rightbar/diff-parse.ts";
import patchStyles from "../rightbar/ChangesTab.module.css";
import type { TurnFile } from "./turn-files.ts";
import styles from "./ChangedFilesCard.module.css";
import { useT } from "../../lib/app-state.ts";

/**
 * Rows shown before the fold: dsh's summary height for a closing message, and
 * enough that a turn's ordinary one-to-three file change needs no second click.
 */
const COLLAPSED_ROWS = 4;

/** dsh opens a row's comparison after half a second of hover, not on contact. */
const PREVIEW_DELAY_MS = 500;

/**
 * Grace a pointer gets to travel from a row onto the open comparison.
 *
 * dsh's `HoverCard` keeps the same 200ms for the same trip (`usePointerGrace`):
 * without it the pane disappears the moment the pointer leaves the row, so the
 * scrollport it draws and the text in it can never be used.
 */
const PREVIEW_GRACE_MS = 200;

/**
 * Room a comparison needs above the card before it opens upward.
 *
 * The panel's own cap (320px of body plus its path line) and a little air. dsh
 * lets its HoverCard pick a side from the measured space; this is the same
 * decision made from one number, because the transcript's scrollport is the only
 * thing the panel can escape into and it is always vertical.
 */
const PREVIEW_ROOM_PX = 372;

/** dsh groups its line counts; a turn that adds 1200 lines says so readably. */
const GROUPED = new Intl.NumberFormat("en-US");

/** The last segment of a path, either separator — what a one-file header is named. */
function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/** Added and deleted line counts in the card's two colors, as dsh draws them. */
function Counts({ added, deleted, t }: { added: number; deleted: number; t: Translate }) {
  return (
    <>
      <span className={styles.added}>{t("editedFiles.added", { count: GROUPED.format(added) })}</span>
      <span className={styles.deleted}>{t("editedFiles.deleted", { count: GROUPED.format(deleted) })}</span>
    </>
  );
}

/** The counts one file shows, or the reason it has none. */
function fileCounts(file: TurnFile, t: Translate) {
  if (file.oversized && file.added + file.deleted === 0) {
    return <span>{t("editedFiles.oversized")}</span>;
  }
  return <Counts added={file.added} deleted={file.deleted} t={t} />;
}

/**
 * The files a turn wrote, as a card at the turn's tail.
 *
 * Every row opens the turn's review in the right sidebar, on that file — dsh's
 * card does the same (`openReview(index)`), and the review is where the
 * comparison, the other files of the turn, and the way into the whole file all
 * live. The transcript already says a `write` happened; what a reader wants next
 * is the change, not the tool row's argument summary. A row is a button whenever
 * the sidebar can be addressed, including a file outside the project: its patch
 * is in the transcript like any other, and only the review's "open the whole
 * file" control needs a project-relative path.
 *
 * A single-file turn keeps only the header, the way dsh does: the file's name is
 * the whole title, so a list of one would repeat it. Multi-file turns carry the
 * per-file counts and a hover comparison, and hold their rows to four before the
 * fold.
 */
export function ChangedFilesCard({
  files,
  turn,
  onOpenChanges,
}: {
  files: readonly TurnFile[];
  /** The turn these files belong to — what a review tab is addressed by. */
  turn: number;
  /** Absent when the sidebar cannot be addressed (no session path yet). */
  onOpenChanges?: ((turn: number, index: number) => void) | undefined;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  /** Index of the file whose comparison is open, or null while none is. */
  const [preview, setPreview] = useState<number | null>(null);
  /** True when the comparison is placed under the card instead of over it. */
  const [below, setBelow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The half-second dwell a row must hold before its comparison opens. */
  const armTimer = useRef<number | null>(null);
  /** The grace a pointer gets to cross from a row onto the open comparison. */
  const closeTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const single = files.length === 1 ? files[0] : undefined;
  const foldable = files.length > COLLAPSED_ROWS;
  const rows = foldable && !expanded ? files.slice(0, COLLAPSED_ROWS) : files;
  const added = files.reduce((total, file) => total + file.added, 0);
  const deleted = files.reduce((total, file) => total + file.deleted, 0);

  const openable = onOpenChanges !== undefined;
  /** Open the turn's review on one file; the card never previews a file itself. */
  const openAt = (index: number): void => {
    // The hover comparison has done its job once the panel that replaces it is
    // asked for; leaving it up would draw two copies of the same diff.
    cancelPreview();
    onOpenChanges?.(turn, index);
  };

  /** A pointer is back (on a row, or on the comparison): the pane stays up. */
  const cancelClose = (): void => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  /** Drop a pending or already-open comparison now. */
  const cancelPreview = (): void => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    cancelClose();
    setPreview(null);
  };

  /**
   * A row arms the comparison half a second in, so passing over the card costs
   * nothing. Every row arms one, including a file whose patch this transcript
   * cannot draw: the pane then says why instead of the hover doing nothing.
   */
  const armPreview = (index: number): void => {
    cancelClose();
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    armTimer.current = window.setTimeout(() => {
      armTimer.current = null;
      // Scrollport top, not window top: the transcript scrolls inside its own
      // box, and a panel that clears the window can still be clipped by it.
      setBelow((rootRef.current?.getBoundingClientRect().top ?? 0) < PREVIEW_ROOM_PX);
      setPreview(index);
    }, PREVIEW_DELAY_MS);
  };

  /**
   * The pointer left a row, or left the comparison itself.
   *
   * The close is delayed so the pointer can cross the few pixels between the two
   * (see {@link PREVIEW_GRACE_MS}); coming back to either cancels it. The arm
   * timer goes with it — a pointer already on its way out should not still open
   * a pane on the row it is leaving.
   */
  const scheduleClose = (): void => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPreview(null);
    }, PREVIEW_GRACE_MS);
  };

  const hoverProps = (index: number) => ({
    onMouseEnter: () => armPreview(index),
    onMouseLeave: scheduleClose,
    onFocus: () => armPreview(index),
    onBlur: scheduleClose,
  });

  const headline = single === undefined ? t("editedFiles.title", { count: files.length }) : null;
  const header = (
    <>
      <span className={styles.tile}>
        {single === undefined ? (
          <DiffIcon width={18} height={18} />
        ) : (
          <FileIcon width={18} height={18} />
        )}
      </span>
      <span className={styles.titles}>
        <span className={styles.title}>
          {single === undefined
            ? headline
            : t("editedFiles.singleTitle", { name: basename(single.display) })}
        </span>
        <span className={styles.stat}>
          <span className={styles.statCounts}>
            {single === undefined ? (
              <Counts added={added} deleted={deleted} t={t} />
            ) : (
              fileCounts(single, t)
            )}
          </span>
          <span className={styles.previewHint}>{t("editedFiles.previewHint")}</span>
        </span>
      </span>
    </>
  );

  const headerLabel =
    single === undefined
      ? t("editedFiles.reviewAll")
      : t("editedFiles.viewDiff", { name: single.display });

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-turn-files
      data-single={single !== undefined || undefined}
      data-place={below ? "below" : "above"}
    >
      <div className={styles.card}>
        {openable ? (
          <button
            type="button"
            className={styles.header}
            aria-label={headerLabel}
            onClick={() => openAt(0)}
            {...(single === undefined ? {} : hoverProps(0))}
          >
            {header}
          </button>
        ) : (
          <div className={styles.header}>{header}</div>
        )}

        {single === undefined ? (
          <ul className={styles.list}>
            {rows.map((file) => {
              const index = files.indexOf(file);
              const label = <span className={styles.path}>{file.display}</span>;
              const badge = <span className={styles.counts}>{fileCounts(file, t)}</span>;
              const hover = hoverProps(index);
              return (
                <li key={file.path}>
                  {openable ? (
                    <button
                      type="button"
                      className={styles.row}
                      title={file.path}
                      aria-label={t("editedFiles.viewDiff", { name: file.display })}
                      onClick={() => openAt(index)}
                      {...hover}
                    >
                      {label}
                      {badge}
                    </button>
                  ) : (
                    <div className={styles.row} title={file.path} {...hover}>
                      {label}
                      {badge}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {foldable ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t("editedFiles.collapseAll")
                : t("editedFiles.expandAll", { count: files.length })
            }
            onClick={() => setExpanded((value) => !value)}
          >
            <span>
              {expanded ? t("common.collapse") : t("editedFiles.showAll", { count: files.length })}
            </span>
            <ChevronIcon width={14} height={14} />
          </button>
        ) : null}
      </div>

      {preview === null || files[preview] === undefined ? null : (
        <ChangedFilePreview
          file={files[preview] as TurnFile}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}

/**
 * The comparison a hovered file opens, drawn inside the card and over the rows
 * above it.
 *
 * The lines come from pi's own patches — the same text the counts were parsed
 * from — so the header can never claim `+3 -1` over a diff showing something
 * else. dsh hides the hunk headers in this preview because the panel it opens is
 * one click away; this one does the same, and keeps only the lines that carry
 * the change. The rows themselves are {@link DiffLines}, the same component the
 * changes panel and the review tab draw, so a line number here is read the way
 * every other diff in the app reads it.
 *
 * The pane is a pointer target in its own right: `onEnter`/`onLeave` keep it up
 * while a reader scrolls it or selects from it, which is the whole reason the
 * card delays its close.
 *
 * Exported because the card can only mount it after a dwell no static render can
 * perform: this is the component the pane's contents are asserted through.
 */
export function ChangedFilePreview({
  file,
  onEnter,
  onLeave,
}: {
  file: TurnFile;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const hunks = useMemo(
    () => file.patches.flatMap((patch) => parseUnifiedDiff(patch).hunks),
    [file.patches],
  );

  return (
    <div
      className={styles.preview}
      data-turn-files-preview
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={styles.previewPath} title={file.path}>
        {file.display}
      </div>
      <div className={`${styles.previewBody} ${patchStyles.patch}`}>
        {hunks.length === 0 ? (
          <p className={styles.previewNote}>
            {file.oversized ? t("turnChanges.oversized") : t("turnChanges.noDiff")}
          </p>
        ) : (
          hunks.map((hunk, hunkIndex) => (
            <div className={styles.previewHunk} key={`${String(hunkIndex)}:${hunk.header}`}>
              <DiffLines hunk={hunk} wrap={false} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
