import { useCallback, useMemo, useState } from "react";
import {
  buildRows,
  CHAT_DIFF_MAX_LINES,
  copyText,
  type DiffCardModel,
  type DiffRow,
} from "./diff-card-model.ts";
import { useT } from "../../lib/app-state.ts";
import styles from "./DiffCard.module.css";

/**
 * The dim class per row kind (path/gap chrome vs the diff's own +/- colors).
 * Mirrors dsh's `ROW_CLASS` table.
 */
const ROW_CLASS: Record<DiffRow["kind"], string | undefined> = {
  path: styles.path,
  del: styles.del,
  add: styles.add,
  context: styles.context,
  gap: styles.gap,
};

/**
 * Render a file mutation as an inline diff surface.
 *
 * Port of dsh's `DiffBlock` primitive at the chat surface: exact local
 * patches (3 context lines, bounded search), a path header per file, `⋯`
 * gaps between fragments, +/- colored rows, a 9-line head/tail fold with an
 * expand toggle, a copy that includes folded rows, and a wrap switch.
 */
export function DiffCard({ diffs }: DiffCardModel) {
  const t = useT();
  const rows = useMemo(() => buildRows(diffs), [diffs]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);

  const onCopy = useCallback(() => {
    if (copied) return;
    void navigator.clipboard
      .writeText(copyText(rows))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // Clipboard permission denied; nothing useful to do.
      });
  }, [copied, rows]);

  if (rows.length === 0) return null;

  const hidden = rows.length - CHAT_DIFF_MAX_LINES;
  const capped = hidden > 0 && !expanded;
  // Same split arithmetic as dsh's TerminalBlock and DiffBlock: head keeps the
  // ceil half so a path header and the first change survive the fold.
  const headLines = Math.ceil(CHAT_DIFF_MAX_LINES / 2);
  const tailLines = CHAT_DIFF_MAX_LINES - headLines;
  const head = capped ? rows.slice(0, headLines) : rows;
  const tail = capped ? rows.slice(rows.length - tailLines) : [];

  return (
    <div className={styles.block} data-diff="" data-code-wrap={wrapped}>
      <div className={styles.banner}>
        <span className={styles.lang}>{t("toolCall.diffLabel")}</span>
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            aria-pressed={wrapped}
            onClick={() => setWrapped((value) => !value)}
          >
            {wrapped ? t("diff.unwrap") : t("diff.wrap")}
          </button>
          <button type="button" className={styles.action} onClick={onCopy}>
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </span>
      </div>
      <div className={styles.body}>
        {head.map((row, index) => (
          <div key={index} className={`${styles.line} ${ROW_CLASS[row.kind] ?? ""}`}>
            {row.text}
          </div>
        ))}
        {capped ? (
          <button
            type="button"
            className={styles.expand}
            aria-expanded={false}
            aria-label={t("diff.expandAria", { count: hidden })}
            onClick={() => setExpanded(true)}
          >
            {t("diff.expandRest", { count: hidden })}
          </button>
        ) : null}
        {tail.map((row, index) => (
          <div key={index} className={`${styles.line} ${ROW_CLASS[row.kind] ?? ""}`}>
            {row.text}
          </div>
        ))}
        {expanded ? (
          <button
            type="button"
            className={styles.expand}
            aria-expanded
            aria-label={t("diff.collapseAria")}
            onClick={() => setExpanded(false)}
          >
            {t("diff.collapse")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
