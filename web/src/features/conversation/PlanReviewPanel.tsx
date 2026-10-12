import { useState } from "react";
import { useT } from "../../lib/app-state.ts";
import type { AskUserQuestionIntent, AskUserQuestionItem } from "../../lib/types.ts";
import { Markdown } from "./Markdown.tsx";
import card from "./QuestionCard.module.css";
import styles from "./QuestionComposer.module.css";

/**
 * The compact approval card a `plan-review` intent asks for.
 *
 * dsh renders this instead of the option list when the question IS a plan
 * submitted for approval: a strip naming the kind of decision, the plan's title,
 * two lines of it, and the two actions that matter. The plan is long and the
 * decision is binary, so showing the option list would bury the verdict under
 * the thing being judged — the full plan is one click away instead of always on
 * screen.
 *
 * It answers with labels, exactly like the generic card. The `approve` label is
 * the model's own option, so it is rendered verbatim rather than translated: it
 * is what goes back on the wire, and a translated button would send a string the
 * asker never offered.
 */
export interface PlanReviewPanelProps {
  question: AskUserQuestionItem;
  intent: AskUserQuestionIntent;
  disabled: boolean;
  /** Whether the user asked to write changes instead of approving. */
  requesting: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
}

export function PlanReviewPanel({
  question,
  intent,
  disabled,
  requesting,
  onApprove,
  onRequestChanges,
}: PlanReviewPanelProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const detail = question.detail ?? "";

  return (
    <div className={styles.planCard}>
      <div className={styles.planStrip}>
        <span className={styles.planDot} aria-hidden />
        <span className={styles.planStripLabel}>{t("question.planReview")}</span>
        <button
          type="button"
          className={styles.planLink}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("question.planHideFull") : t("question.planViewFull")}
        </button>
      </div>
      <div className={styles.planTitle}>{question.header ?? question.question}</div>
      {expanded ? (
        // The plan is arbitrary markdown and can be long, so it scrolls in place
        // rather than pushing the two actions off the card.
        <div className={styles.planBody}>
          <Markdown text={detail} />
        </div>
      ) : (
        <div className={styles.planSummary}>{plainSummary(detail)}</div>
      )}
      <div className={styles.planActions}>
        <button
          type="button"
          className={card.secondary}
          disabled={disabled}
          aria-pressed={requesting}
          // The first thing this card offers to focus: the option rows it would
          // otherwise compete with are not drawn at all.
          data-focus-first=""
          onClick={onRequestChanges}
        >
          {t("question.planRequestChanges")}
        </button>
        <button type="button" className={card.primary} disabled={disabled} onClick={onApprove}>
          {intent.approve}
        </button>
      </div>
    </div>
  );
}

/**
 * The first two readable lines of a plan.
 *
 * Markdown furniture is stripped rather than rendered: this is a preview of the
 * prose, and a summary that opens with `#` or `-` reads as a document fragment
 * instead of a sentence. Blank lines are skipped so a plan that starts with a
 * title still gets two lines of substance.
 */
export function plainSummary(detail: string): string {
  return detail
    .split("\n")
    .map((line) => line.replace(/^[#>\-*\s]+/, "").replace(/[*`_]/g, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 2)
    .join(" ");
}
