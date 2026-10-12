import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { api } from "../../lib/api.ts";
import type { FileSearchItem } from "../../lib/types.ts";
import { resolveCompletion } from "./completion-dismiss.ts";
import { detectAtTrigger, type AtTrigger } from "./file-token.ts";
import { referenceStartAt } from "./reference-token.ts";

/** How long the caret has to rest before a query is sent. */
const DEBOUNCE_MS = 120;

export interface FileCompletion {
  /** Candidates for the token under the caret. */
  matches: FileSearchItem[];
  /** True when the menu should be rendered. */
  open: boolean;
  /** True while the query for the current token is in flight. */
  loading: boolean;
  /**
   * Why the search for the current token failed, if it did.
   *
   * Kept apart from an empty result on purpose: "nothing matched" is about the
   * user's typing, while a 404 or an unreachable server is about the setup —
   * and reporting the second as the first is how a stale server process hides.
   */
  error: string | null;
  /** Entries the project index holds; null until an answer lands. `0` means
   * this project has nothing to complete from. */
  indexed: number | null;
  highlight: number;
  setHighlight(index: number): void;
  /** Re-read the textarea. Call on input, caret movement and blur. */
  sync(): void;
  /** Write the picked path into the draft as a reference. */
  select(item: FileSearchItem): void;
  /**
   * Close the menu outright.
   *
   * Unlike Escape this leaves no guard behind — it says the token is *gone*,
   * not "not now" — which is what a send needs: clearing the draft is a
   * programmatic write, so no `input` event reaches `sync()` and the menu would
   * otherwise stay up over the transcript.
   */
  close(): void;
  /** Returns true when the key was consumed by the open menu. */
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean;
}

/**
 * `@` completion for a prompt textarea.
 *
 * The shape is `useSlashCompletion`'s — the token comes from the textarea's own
 * value and caret, so IME composition, pastes and caret moves all keep it
 * correct — with three differences the network brings:
 *
 * - The candidates are *asynchronous*, so the menu owns a request lifecycle:
 *   the query is debounced (a query per keystroke would be a request per
 *   keystroke), an answer for a query the caret has left is dropped rather than
 *   rendered (or the menu would flicker back through older and older results),
 *   and the last answer is kept until the next one lands so the list does not
 *   blink empty between keystrokes.
 * - A directory is *not* a final answer: picking one rewrites the token as
 *   `@src/lib/` and the menu stays up on the deeper query, which is how a user
 *   walks into a tree one level at a time.
 * - The pick is not written here. `insertReference` is the owner of the
 *   label → path map, so this hook only says *which* path and *where* the token
 *   began; see `useReferenceDraft`.
 *
 * An Escape suppresses its token with the same rules as `useSlashCompletion`,
 * and for the same reason: one `keyup` (or one more letter) must not put back
 * the menu the user just waved off. See `resolveCompletion`.
 */
export function useFileCompletion(options: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The project whose files are being searched; completion is off without one. */
  projectId: string | null | undefined;
  /** Write the picked path as a reference, replacing text from `start`. */
  insertReference(path: string, kind: "file" | "directory", start: number): void;
}): FileCompletion {
  const { textareaRef, projectId, insertReference } = options;
  const [trigger, setTrigger] = useState<AtTrigger | null>(null);
  /** The last answer, tagged with the query it belongs to. */
  const [answer, setAnswer] = useState<{
    projectId: string;
    query: string;
    items: FileSearchItem[];
    indexed: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  /** Mirrors `trigger` so `sync()` can compare without re-rendering. */
  const triggerRef = useRef<AtTrigger | null>(null);
  /** The token an Escape dismissed, so its own `keyup` does not reopen it. */
  const dismissedRef = useRef<AtTrigger | null>(null);

  const applyTrigger = useCallback((next: AtTrigger | null): void => {
    triggerRef.current = next;
    setTrigger(next);
    setHighlight(0);
  }, []);

  const dismiss = useCallback((): void => {
    dismissedRef.current = triggerRef.current;
    applyTrigger(null);
  }, [applyTrigger]);

  /** See `FileCompletion.close` — used when the draft itself is gone. */
  const close = useCallback((): void => applyTrigger(null), [applyTrigger]);

  const sync = useCallback((): void => {
    const element = textareaRef.current;
    if (!element) return;
    const next = detectAtTrigger(element.value, element.selectionStart ?? 0);
    const resolved = resolveCompletion(triggerRef.current, dismissedRef.current, next);
    dismissedRef.current = resolved.dismissed;
    // A no-op when the token did not change: `onKeyUp` also fires after the
    // ArrowDown/ArrowUp this hook consumed, and re-syncing there would reset
    // the highlighted row on every keypress.
    if (resolved.trigger === triggerRef.current) return;
    applyTrigger(resolved.trigger);
  }, [applyTrigger, textareaRef]);

  const enabled = projectId !== null && projectId !== undefined;

  useEffect(() => {
    if (trigger === null || projectId === null || projectId === undefined) {
      setAnswer(null);
      setLoading(false);
      setError(null);
      return;
    }
    const query = trigger.query;
    const id = projectId;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      api
        .searchProjectFiles(id, query)
        .then((result) => {
          if (cancelled) return;
          setAnswer({ projectId: id, query, items: result.items, indexed: result.indexed });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Not an empty result: the menu says what went wrong instead of
          // blaming the query. A failed request here is a setup problem — a
          // server process running older code, a project whose directory is
          // gone — and both are things the reader can act on.
          setAnswer({ projectId: id, query, items: [], indexed: 0 });
          setError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trigger, projectId]);

  /** Only an answer for the token under the caret is worth showing. */
  const current =
    trigger !== null &&
    answer !== null &&
    projectId !== null &&
    projectId !== undefined &&
    answer.projectId === projectId &&
    answer.query === trigger.query
      ? answer
      : null;

  const matches = current?.items ?? [];

  const select = useCallback(
    (item: FileSearchItem): void => {
      const element = textareaRef.current;
      const value = element?.value ?? "";
      const caret = element?.selectionStart ?? value.length;
      const rawStart = triggerRef.current?.start ?? caret;
      // Replacing a chip's label has to take the chip's glyph slot with it;
      // otherwise the draft keeps the old slot in front of the new one and the
      // sentence grows an orphan sigil.
      const start = referenceStartAt(value, rawStart);

      insertReference(item.path, item.type, start);

      if (item.type === "file") {
        applyTrigger(null);
        return;
      }
      // A directory keeps the menu open on the path it just wrote, so the next
      // keystroke narrows *inside* it instead of starting a new token.
      requestAnimationFrame(() => sync());
    },
    [applyTrigger, insertReference, sync, textareaRef],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (trigger === null || !enabled) return false;

      if (matches.length === 0) {
        // Nothing to choose, but Escape still means "not now".
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
          return true;
        }
        return false;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlight((current) => (current + 1) % matches.length);
          return true;
        case "ArrowUp":
          event.preventDefault();
          setHighlight((current) => (current - 1 + matches.length) % matches.length);
          return true;
        case "Enter":
        case "Tab": {
          // An active IME owns Enter; never steal it mid-composition.
          if (event.nativeEvent.isComposing) return false;
          const chosen = matches[highlight] ?? matches[0];
          if (!chosen) return false;
          event.preventDefault();
          select(chosen);
          return true;
        }
        case "Escape":
          event.preventDefault();
          dismiss();
          return true;
        default:
          return false;
      }
    },
    [applyTrigger, dismiss, enabled, trigger, matches, highlight, select],
  );

  return {
    matches,
    open: trigger !== null && enabled,
    loading,
    error,
    indexed: current?.indexed ?? null,
    highlight,
    setHighlight,
    sync,
    select,
    close,
    onKeyDown,
  };
}
