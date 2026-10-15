import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/app-state.ts";
import { CloseCircleIcon, PlanIcon } from "../../components/icons.tsx";
import styles from "./PlanChip.module.css";

/**
 * The plan-mode chip in the composer's control row.
 *
 * dsh's `PlanChip`, and it follows dsh in three decisions that are easy to get
 * wrong:
 *
 * - **It appears only while plan mode is on.** Entering is `/plan` — which the
 *   `/` menu offers, and which is how dsh enters too — so the chip is a way
 *   *out*, not a toggle, and an inactive session shows nothing at all. The
 *   conversation header no longer carries a badge for this: one control, in the
 *   row that describes what the next message will be.
 * - **It is not optimistic.** The state comes from the session file (`planMode`
 *   in the composer read) and stays whatever the log says after the round trip;
 *   all that is local is the wait, because a chip that stayed live would take a
 *   second click mid-flight.
 * - **The glyph changes under the pointer.** At rest it is the plan document;
 *   hovered or focused it becomes a crossed-out circle, so the pending click
 *   reads as turning the mode off rather than as opening something.
 *
 * A failed exit says so next to the chip, which is where dsh puts it — the chip
 * is still on screen, and the reader is looking at it.
 *
 * On a narrow frame the label goes and the glyph stays: the chip is then the
 * width of the other icon buttons in the row, which is what leaves the model
 * trigger its room. (dsh's regression test for the same 800px viewport solves
 * that squeeze by collapsing the model name instead; this row's other controls
 * do not shrink, so the chip yields and keeps its aria-label, which is what a
 * screen reader reads either way.)
 */
export function PlanChip({
  onExit,
  compact = false,
}: {
  onExit: () => Promise<void>;
  /** Draw the glyph alone, for a frame too narrow for the word. */
  compact?: boolean;
}) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Kept so a reply that lands after the chip unmounts does not set state. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const exit = (): void => {
    setLeaving(true);
    setError(null);
    void onExit().then(
      () => {
        if (alive.current) setLeaving(false);
      },
      (reason: unknown) => {
        if (!alive.current) return;
        setLeaving(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
  };

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.chip}
        data-compact={compact ? "true" : undefined}
        aria-label={t("plan.chipExit")}
        title={t("plan.chipExitTitle")}
        disabled={leaving}
        onClick={exit}
      >
        <span className={styles.glyph} aria-hidden>
          <PlanIcon className={styles.restGlyph} width={14} height={14} />
          <CloseCircleIcon className={styles.hoverGlyph} width={14} height={14} />
        </span>
        {compact ? null : t("plan.chip")}
      </button>
      {error === null ? null : (
        <span className={styles.error} role="status" title={error}>
          {t("plan.chipExitFailed")}
        </span>
      )}
    </span>
  );
}
