import { useState } from "react";
import { Glyph } from "../../components/dsh-icons.tsx";
import { useT } from "../../lib/app-state.ts";
import type { MessageKey } from "../../lib/i18n/index.ts";
import type { ToolCallBlock } from "../../lib/types.ts";
import { DisclosureRow } from "./DisclosureRow.tsx";
import { QuestionReviewCard } from "./QuestionReviewCard.tsx";
import { ToolCallRow } from "./ToolCallRow.tsx";
import { readSettledQuestion, type QuestionOutcome } from "./pending-questions.ts";
import type { ToolExecution } from "./useConversation.ts";
import styles from "./ToolCallRow.module.css";

/** Outcome → the one word the collapsed row shows. */
const OUTCOME_LABELS: Record<QuestionOutcome, MessageKey> = {
  answered: "question.outcome.answered",
  cancelled: "question.outcome.cancelled",
  "timed-out": "question.outcome.timedOut",
};

/**
 * One `ask_user_question` call as a disclosure row.
 *
 * The collapsed line is the only thing a settled question needs to say — what
 * became of it and how many questions it asked — and the answer itself is one
 * click away, read back as the same card that was answered rather than as the
 * tool result's JSON. Reusing the generic row's styles is deliberate: this sits
 * in the same list as every other tool call, and a second visual language would
 * suggest a difference that is not there.
 *
 * A result this build cannot read falls back to the generic row, which at least
 * shows the raw output; a card with no record to draw would be emptier than the
 * thing it replaced.
 */
export function QuestionRow({
  call,
  execution,
  cwd,
  home,
}: {
  call: ToolCallBlock;
  execution: ToolExecution | undefined;
  cwd?: string | undefined;
  home?: string | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const record = readSettledQuestion(execution?.details);

  if (record === null) return <ToolCallRow call={call} execution={execution} cwd={cwd} home={home} />;

  const summary = `${t(OUTCOME_LABELS[record.outcome])} · ${t("question.pendingCount", {
    count: record.questions.length,
  })}`;

  return (
    <div className={styles.root} data-variant="others" data-tool={call.name} data-state="ok">
      <DisclosureRow
        rowClassName={styles.row}
        leadingClassName={styles.leading}
        titleClassName={styles.title}
        icon={<Glyph name="think" />}
        title={t("question.rowTitle")}
        open={open}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setOpen((value) => !value)}
        collapsedContent={
          <>
            <span className={styles.sep} aria-hidden />
            <span className={styles.summary}>{summary}</span>
          </>
        }
      >
        <div className={styles.bodyScroll}>
          <QuestionReviewCard record={record} />
        </div>
      </DisclosureRow>
    </div>
  );
}
