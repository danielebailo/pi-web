import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { formatTokens } from "../../lib/duration.ts";
import type { ComposerContext } from "../../lib/types.ts";
import { StatPanel, StatRow } from "./StatPanel.tsx";
import styles from "./ContextMeter.module.css";
import { useT } from "../../lib/app-state.ts";

/** Radius and circumference of the ring in its 16px viewBox. */
const RADIUS = 6.4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ContextMeterProps {
  context: ComposerContext | null;
  /**
   * Called when the panel opens without a figure to show. The context estimate
   * is only authoritative inside a running pi, so this is where a session that
   * was read from disk pays one cold start — at the user's request, rather than
   * on every sidebar click.
   */
  onRequestLive(): void;
}

/**
 * How full the context window is, as a chip next to the send button: the ring
 * and the percentage it stands for, in the same shape as the model trigger a
 * few pixels to its left.
 *
 * The ring answers "am I near the limit?" without being read, and the figure
 * says by how much — one glance, no click. The full breakdown (used, window,
 * remaining) stays in the panel behind it.
 *
 * A ring with no arc is the honest rendering of "unknown" — pi reports a null
 * token count right after a compaction, and a session read from disk may have no
 * `contextWindow` to measure against. Nothing is drawn at all only when there is
 * no model to describe.
 */
export function ContextMeter({ context, onRequestLive }: ContextMeterProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Same dismissal contract as the stat pills: outside pointer or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (context === null) {
    return (
      <span className={styles.anchor} ref={rootRef}>
        <button
          type="button"
          className={styles.button}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("context.unknown")}
          title={t("context.unknown")}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) onRequestLive();
          }}
        >
          <Ring percent={null} />
          <span>{t("context.unknownValue")}</span>
        </button>
        {open ? (
          <StatPanel align="end" icon={<Ring percent={null} />} title={t("context.title")} note={t("context.emptyNote")}>
            <StatRow label={t("context.window")} value={t("context.unknownValue")} />
          </StatPanel>
        ) : null}
      </span>
    );
  }

  const percent = context.percent;
  // `tokens === null` is pi saying it has no figure yet (right after a
  // compaction); `percent === null` is the same absence one step later — a
  // window too small or too unknown to divide by. Either one is "unknown",
  // and every expression below states it inline so the narrowing holds.
  const label =
    percent === null || context.tokens === null
      ? t("context.unknown")
      : t("context.breakdown", {
          percent: formatPercent(percent),
          used: formatTokens(context.tokens),
          window: formatTokens(context.contextWindow),
        });
  // The chip wears the same two thresholds the ring does, so the reading and
  // the arc never disagree about how close the window is to compacting.
  const tone =
    percent === null || context.tokens === null
      ? undefined
      : percent >= 90
        ? styles.ringCritical
        : percent >= 75
          ? styles.ringWarning
          : undefined;

  return (
    <span className={styles.anchor} ref={rootRef}>
      <button
        type="button"
        className={clsx(styles.button, tone)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && context.tokens === null) onRequestLive();
        }}
      >
        <Ring percent={percent} />
        <span>
          {percent === null || context.tokens === null
            ? t("context.unknownValue")
            : `${formatPercent(percent)}%`}
        </span>
      </button>
      {open ? (
        <StatPanel
          align="end"
          icon={
            <span className={tone}>
              <Ring percent={percent} />
            </span>
          }
          title={t("context.title")}
          value={
            context.tokens === null
              ? undefined
              : `${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)}`
          }
          note={t("context.note")}
        >
          <StatRow label={t("context.window")} value={`${formatTokens(context.contextWindow)} tok`} />
          <StatRow
            label={t("context.used")}
            value={
              context.tokens === null
                ? t("context.unknownValue")
                : percent === null
                  ? `${formatTokens(context.tokens)} tok`
                  : `${formatTokens(context.tokens)} tok（${formatPercent(percent)}%）`
            }
          />
          <StatRow
            label={t("context.remaining")}
            value={
              context.tokens === null
                ? t("context.unknownValue")
                : `${formatTokens(Math.max(0, context.contextWindow - context.tokens))} tok`
            }
          />
        </StatPanel>
      ) : null}
    </span>
  );
}

/**
 * Whole percents from ten up, one decimal below — the same shape dsh uses for
 * its cache-hit figure, and the same reason: rounding 0.6% to "1%" overstates
 * what was used, while rounding it to "0%" claims nothing was.
 */
function formatPercent(percent: number): string {
  const clamped = Math.max(0, percent);
  if (clamped > 0 && clamped < 1) return "<1";
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/**
 * The ring itself. `percent === null` draws the track only, which is how "no
 * figure" looks: an empty gauge, not a full one. Its color is the chip's own
 * (`currentColor`), so the warning tones are stated once, on the button.
 */
function Ring({ percent }: { percent: number | null }) {
  const shown = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <svg
      className={styles.ring}
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <circle
        className={styles.track}
        cx={8}
        cy={8}
        r={RADIUS}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {shown > 0 ? (
        <circle
          cx={8}
          cy={8}
          r={RADIUS}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={`${(CIRCUMFERENCE * shown) / 100} ${CIRCUMFERENCE}`}
          transform="rotate(-90 8 8)"
        />
      ) : null}
    </svg>
  );
}
