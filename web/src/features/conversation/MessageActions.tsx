import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import clsx from "clsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { Glyph } from "../../components/dsh-icons.tsx";
import { useCalendarDay } from "../../lib/calendar-day.ts";
import { formatMessageClock, formatTokens, formatTurnDuration } from "../../lib/duration.ts";
import type { MessageUsage } from "../../lib/types.ts";
import { StatPanel, StatRow } from "./StatPanel.tsx";
import { formatCacheHitPercent, formatExactCount } from "./stats-model.ts";
import styles from "./MessageActions.module.css";
import { useT } from "../../lib/app-state.ts";

/**
 * The row of actions dsh draws under a message: copy, fork, and — for an
 * answer — what it cost and how long it took.
 *
 * What is deliberately missing is the thumbs up/down pair from the reference
 * screenshot. dsh stores that feedback against a message; pi has no equivalent
 * field and no RPC, so the button would either do nothing or write somewhere
 * nothing reads. A control that cannot change anything is worse than an absent
 * one.
 *
 * Which rows are *visible* is decided a level up: the transcript puts
 * `data-actions-reveal` on the container of each earlier message, and the
 * stylesheet fades that container's row out until it is hovered or focused
 * (dsh's rule, attribute for attribute).
 */
export function MessageActions({
  text,
  usage,
  model,
  durationMs,
  timestamp,
  forkEntryId,
  onFork,
  align = "start",
}: {
  /** What the copy button puts on the clipboard. */
  text: string;
  /** Assistant-only. A turn's summed usage. */
  usage?: MessageUsage | null;
  /** Assistant-only. The `provider/model` the turn ran on, for the panel. */
  model?: string | null;
  /** Assistant-only. Wall-clock time from the user's message to this turn's end. */
  durationMs?: number | null;
  /** Epoch milliseconds; dsh renders `21:00` today and adds the date before that. */
  timestamp?: number | null;
  /**
   * The entry this message forks from, when there is one. Absent means the
   * button is not offered at all rather than shown disabled: the reason it is
   * missing (no entry id in the transcript, a session read from disk that pi
   * would not fork from) is not something the reader can act on.
   */
  forkEntryId?: string | null;
  onFork?: (entryId: string) => void;
  align?: "start" | "end";
}) {
  const t = useT();
  const day = useCalendarDay();
  const [copied, setCopied] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const usageAnchorRef = useRef<HTMLSpanElement>(null);
  const copyPending = useRef(false);
  const copyEpoch = useRef(0);
  const copyTimer = useRef<number | null>(null);

  // Unmounting while a write is in flight would otherwise set state on a gone
  // row: the epoch bumps so the pending resolution is dropped, the same way dsh
  // does it.
  useEffect(
    () => () => {
      copyEpoch.current += 1;
      copyPending.current = false;
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  // One listener pair for the panel, as the composer's pills do it: dsh dismisses
  // on an outside pointer or Escape too, and Escape matters because the pill is
  // keyboard reachable.
  useEffect(() => {
    if (!usageOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const anchor = usageAnchorRef.current;
      if (anchor !== null && event.target instanceof Node && anchor.contains(event.target)) return;
      setUsageOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setUsageOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [usageOpen]);

  const copy = (): void => {
    // dsh's window: one second, and a second click while the write is still in
    // flight is ignored rather than queued — the acknowledgement that follows
    // would otherwise restart its own timer and the tick would look stuck.
    if (copied || copyPending.current) return;
    const epoch = copyEpoch.current;
    copyPending.current = true;
    // The clipboard API rejects on a non-secure origin; the shell is served
    // over plain http on localhost, which browsers do treat as secure, but the
    // rejection is still handled: a copy that did not happen shows no tick, so
    // the button does not claim something the clipboard does not hold.
    void navigator.clipboard
      .writeText(text)
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        if (epoch !== copyEpoch.current) return;
        copyPending.current = false;
        if (!ok) return;
        setCopied(true);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1000);
      });
  };

  return (
    <div
      className={clsx(styles.actions, align === "end" ? styles.actionsEnd : styles.actionsTail)}
      data-clock={align === "end" ? "start" : "end"}
    >
      {/*
       * dsh puts the timestamp first on a user message (when it was sent) and
       * last on an answer (when it finished), and it is not worth inventing a
       * third arrangement: the two rows are read in the order they happened.
       *
       * `data-clock` is that same choice, under dsh's name for it: `start` is
       * the prompt's row, `end` the answer's tail, and the stylesheet reads the
       * two for measurement as well as placement — the tail's glyphs are a size
       * larger. It is not this component's `align`, which says which edge the
       * row hugs.
       */}
      {align === "end" && timestamp != null && (
        <span className={styles.timeStart}>{formatMessageClock(timestamp, t, day)}</span>
      )}

      <Tooltip label={copied ? t("common.copied") : t("common.copy")}>
        <button
          type="button"
          className={styles.action}
          aria-label={copied ? t("common.copied") : t("common.copy")}
          onClick={copy}
        >
          {/*
           * dsh's acknowledgement is the check mark itself, not a word beside it:
           * a "已复制" label would push the row's other figures sideways for two
           * seconds every time it is used.
           */}
          <Glyph name={copied ? "check" : "copy"} />
        </button>
      </Tooltip>

      {forkEntryId != null && forkEntryId.length > 0 && onFork !== undefined && (
        <Tooltip label={t("message.fork")}>
          <button
            type="button"
            className={styles.action}
            aria-label={t("message.fork")}
            onClick={() => onFork(forkEntryId)}
          >
            <Glyph name="branch" />
          </button>
        </Tooltip>
      )}

      {usage != null && (
        <TurnUsagePill
          usage={usage}
          model={model ?? null}
          align={align}
          open={usageOpen}
          onOpen={setUsageOpen}
          anchorRef={usageAnchorRef}
        />
      )}

      {durationMs != null && (
        <Tooltip label={t("message.durationTitle")}>
          <span className={styles.stat}>
            <Glyph name="clock" />
            {t("message.duration", { duration: formatTurnDuration(durationMs, t) })}
          </span>
        </Tooltip>
      )}

      {timestamp != null && align !== "end" && (
        <span className={styles.timeEnd}>{formatMessageClock(timestamp, t, day)}</span>
      )}
    </div>
  );
}

/**
 * The turn's bill as a pill, opening the panel dsh's `TurnUsagePanel` shows.
 *
 * The four buckets are the turn's own sum, so this is the same arithmetic the
 * composer's usage pill does across the whole session — one turn instead of all
 * of them. The provider/model row is the turn's rather than the session's: pi
 * can switch models between turns, and the figure above the row belongs to
 * whichever one produced it.
 *
 * Exported for the tests, which are the only place that renders it open: in the
 * transcript the panel only exists after a click, and this project's markup
 * tests render once, statically.
 */
export function TurnUsagePill({
  usage,
  model,
  align,
  open,
  onOpen,
  anchorRef,
}: {
  usage: MessageUsage;
  model: string | null;
  align: "start" | "end";
  open: boolean;
  onOpen: (open: boolean) => void;
  anchorRef: RefObject<HTMLSpanElement | null>;
}) {
  const t = useT();
  const label = t("message.usage", { tokens: formatTokens(usage.totalTokens) });
  const cacheHitPercent = formatCacheHitPercent(usage);

  return (
    <span className={styles.pillAnchor} ref={anchorRef}>
      <Tooltip label={t("message.usageTitle")}>
        <button
          type="button"
          className={styles.pill}
          aria-haspopup="dialog"
          aria-expanded={open}
          // Repeats the visible label, which the narrow-screen rule hides: the
          // button has to keep a name when the row collapses to its icon.
          aria-label={label}
          onClick={() => onOpen(!open)}
        >
          <Glyph name="database" />
          <span className={styles.pillLabel}>{label}</span>
        </button>
      </Tooltip>
      {open ? (
        <StatPanel
          icon={<Glyph name="database" />}
          title={t("message.turnUsageTitle")}
          value={tok(usage.totalTokens)}
          align={align === "end" ? "end" : "center"}
        >
          {model === null ? null : (
            <StatRow label={t("stats.providerModel")} value={model} route />
          )}
          {cacheHitPercent === null ? null : (
            <StatRow label={t("stats.cacheHit")} value={`${cacheHitPercent}%`} />
          )}
          <StatRow label={t("stats.uncachedInput")} value={tok(usage.input)} />
          <StatRow label={t("stats.cacheRead")} value={tok(usage.cacheRead)} />
          <StatRow label={t("stats.cacheWrite")} value={tok(usage.cacheWrite)} />
          <StatRow label={t("stats.output")} value={tok(usage.output)} />
        </StatPanel>
      ) : null}
    </span>
  );
}

function tok(count: number): string {
  return `${formatExactCount(count)} tok`;
}
