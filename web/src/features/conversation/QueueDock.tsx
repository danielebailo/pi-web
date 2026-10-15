import { useId, useState } from "react";
import { useT } from "../../lib/app-state.ts";
import { Glyph } from "../../components/dsh-icons.tsx";
import type { QueuedPrompt } from "./useConversation.ts";
import styles from "./QueueDock.module.css";

/**
 * The queued messages waiting between the composer and pi, ported from dsh's
 * `QueueDock`.
 *
 * A queued send shows up twice — as the transcript's optimistic user row and
 * as a dock row here — because the two answer different questions: the row in
 * the transcript is "what did I send", the dock row is "what has not left
 * yet". Until now the second question had no answer on screen, and worse, no
 * way out: pi expands skill commands before queueing, so nothing about the
 * text identifies the row, and the only operations pi offers operate on the
 * whole lane at once. The server's `queue/update` route does the drain,
 * rewrite, and re-queue dance that per-item editing needs; this dock is its
 * face.
 *
 * Deliberately narrower than dsh's dock: no per-item "steer now" (another
 * drain-and-requeue on top of an edit, and the composer's busy-send setting
 * already picks the lane), and no file attachments (pi carries images only).
 */

/** How much of one row's text shows before it truncates. */
const PREVIEW_CHARS = 200;

function previewOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join("")}…` : flat;
}

interface QueueRowProps {
  entry: QueuedPrompt;
  busy: boolean;
  onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => void;
}

/** One queued message: preview, thumbnails, edit-in-place, remove. */
function QueueRow({ entry, busy, onRemove, onEdit }: QueueRowProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.text);

  const startEdit = (): void => {
    setDraft(entry.text);
    setEditing(true);
  };

  const commit = (): void => {
    setEditing(false);
    const text = draft.trim();
    if (text.length === 0 || text === entry.text) return;
    onEdit(entry.id, text);
  };

  if (editing) {
    return (
      <li className={styles.row}>
        <div className={styles.editor}>
          <textarea
            className={styles.editorInput}
            value={draft}
            rows={2}
            autoFocus
            aria-label={t("queue.edit")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter commits, as the composer does; Shift+Enter keeps a
              // newline, since a queued message may be multi-line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
          <div className={styles.editorActions}>
            <button
              type="button"
              className={styles.iconButton}
              disabled={busy}
              title={t("queue.save")}
              aria-label={t("queue.save")}
              onClick={commit}
            >
              <Glyph name="check" size={14} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              disabled={busy}
              title={t("queue.cancelEdit")}
              aria-label={t("queue.cancelEdit")}
              onClick={() => setEditing(false)}
            >
              <Glyph name="closeFill" size={14} />
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.row} data-busy={busy || undefined}>
      {entry.images.length > 0 && (
        <span className={styles.thumbs}>
          {entry.images.map((image, index) => (
            <img
              key={index}
              className={styles.thumb}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={t("queue.image")}
              draggable={false}
            />
          ))}
        </span>
      )}
      <span className={styles.preview}>{previewOf(entry.text)}</span>
      <span className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          disabled={busy}
          title={t("queue.edit")}
          aria-label={t("queue.edit")}
          onClick={startEdit}
        >
          <Glyph name="editOutline" size={14} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          disabled={busy}
          title={t("queue.remove")}
          aria-label={t("queue.remove")}
          onClick={() => onRemove(entry.id)}
        >
          <Glyph name="trash" size={14} />
        </button>
      </span>
    </li>
  );
}

export function QueueDock({
  queue,
  onRemove,
  onEdit,
}: {
  queue: QueuedPrompt[];
  onRemove: (id: string) => Promise<boolean>;
  onEdit: (id: string, text: string) => Promise<boolean>;
}) {
  const t = useT();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const headingId = useId();

  if (queue.length === 0) return null;

  const wrap = (id: string, run: () => Promise<boolean>): void => {
    setBusyIds((current) => new Set(current).add(id));
    void run().finally(() => {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    });
  };

  return (
    <div className={styles.dock}>
      <section className={styles.root} aria-labelledby={headingId}>
        <h3 id={headingId} className={styles.title}>
          <Glyph name="clock" size={14} className={styles.lead} />
          {t("queue.count", { n: queue.length })}
        </h3>
        <ul className={styles.rows}>
          {queue.map((entry) => (
            <QueueRow
              key={entry.id}
              entry={entry}
              busy={busyIds.has(entry.id)}
              onRemove={(id) => wrap(id, () => onRemove(id))}
              onEdit={(id, text) => wrap(id, () => onEdit(id, text))}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
