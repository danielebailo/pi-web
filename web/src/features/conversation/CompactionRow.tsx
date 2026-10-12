import { useState } from "react";
import { Glyph } from "../../components/dsh-icons.tsx";
import { formatMessageTime, formatTokens } from "../../lib/duration.ts";
import { useLanguage, useT } from "../../lib/app-state.ts";
import { DisclosureRow } from "./DisclosureRow.tsx";
import { Markdown } from "./Markdown.tsx";
import styles from "./CompactionRow.module.css";

/**
 * A compaction checkpoint as a row in the transcript.
 *
 * This is the one place compaction is visible, and it is deliberately in the
 * conversation rather than in a panel: what a compaction changes is the
 * transcript itself — the turns before the cut are no longer in pi's context,
 * and this summary is what stands in for them. A reader scrolling the history
 * therefore meets the boundary here, at the point where the history they can
 * still see gives way to what pi actually remembers.
 *
 * The summary is collapsed by default because pi writes a long structured one
 * (tens of KB is normal), and because the row's job at rest is to say *that* the
 * cut happened and how much it removed — the text is one click away.
 */
export function CompactionRow({
  summary,
  tokensBefore,
  timestamp,
}: {
  summary: string;
  tokensBefore: number;
  timestamp: number;
}) {
  const t = useT();
  const language = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <DisclosureRow
      icon={<Glyph name="database" />}
      title={t("compaction.title")}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => setOpen((value) => !value)}
      // Kept open as well as shut: the figure is the quantification of what
      // the cut removed, and the expanded body talks about the summary, not
      // about the size of what it replaced.
      keepContentWhenOpen
      collapsedContent={
        <>
          <span className={styles.separator} aria-hidden />
          <span className={styles.size}>
            {t("compaction.before", { tokens: formatTokens(tokensBefore) })}
          </span>
          <span className={styles.time}>{formatMessageTime(timestamp, language)}</span>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.note}>{t("compaction.note")}</p>
        <div className={styles.summary}>
          <Markdown text={summary} />
        </div>
      </div>
    </DisclosureRow>
  );
}

/**
 * The same checkpoint while pi is still writing it.
 *
 * A compaction is a model call of its own — half a minute of silence in the
 * middle of a conversation — so the row goes up immediately, in the one place
 * the finished checkpoint will land: at the end of the transcript, under
 * everything the cut is about to fold. It wears the same anatomy as that row
 * (same glyph, same 24px line) so the reader sees one thing change state rather
 * than two unrelated notices come and go.
 */
export function CompactionRunning() {
  const t = useT();
  return (
    // `role="status"` on a wrapper because the row itself is inert: a screen
    // reader still has to hear that the silence has a reason.
    <div role="status" aria-live="polite">
      <DisclosureRow
        icon={<Glyph name="database" />}
        title={<span className={styles.runningText}>{t("compaction.running")}</span>}
        open={false}
        expandable={false}
        onToggle={noop}
      />
    </div>
  );
}

/** `DisclosureRow` requires a toggle; a running row has nothing to open. */
function noop(): void {}
