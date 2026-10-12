import clsx from "clsx";
import { useT } from "../../lib/app-state.ts";
import { Markdown } from "./Markdown.tsx";
import type { SettledQuestion } from "./pending-questions.ts";
import { parseRecommendedLabel } from "./question-model.ts";
import card from "./QuestionCard.module.css";
import styles from "./QuestionComposer.module.css";

/**
 * A settled batch, read back.
 *
 * dsh reopens a finished question as a read-only card: the same pager over the
 * recorded answers, every control disabled, a skipped question saying so where
 * its answer would be. The point is the record — "what did I actually pick?" is
 * a question about the past, and it should not have to be answered by re-reading
 * the tool result's JSON.
 *
 * Every question is on screen at once rather than behind a pager, because this
 * is reading rather than deciding: a verdict the user cannot see next to the one
 * before it is exactly what they came here to check.
 */
export function QuestionReviewCard({ record }: { record: SettledQuestion }) {
  const t = useT();
  return (
    <div className={styles.reviewCard}>
      {record.questions.map((question) => {
        const answer = record.answers.find((item) => item.id === question.id);
        const selected = answer?.selected ?? [];
        const custom = answer?.custom ?? "";
        const skipped = answer !== undefined && selected.length === 0 && custom.length === 0;
        const options = question.options ?? [];
        return (
          <div key={question.id} className={styles.reviewQuestion}>
            {question.header ? <div className={styles.questionHeadTitle}>{question.header}</div> : null}
            <div className={styles.questionText}>{question.question}</div>
            {question.detail ? (
              <div className={card.detail}>
                <Markdown text={question.detail} />
              </div>
            ) : null}
            {options.length > 0 ? (
              <div className={styles.reviewOptions}>
                {options.map((option) => {
                  const { label } = parseRecommendedLabel(option.label);
                  const chosen = selected.includes(option.label);
                  return (
                    <div
                      key={option.label}
                      className={clsx(styles.reviewOption, chosen && styles.reviewOptionChosen)}
                    >
                      <span
                        className={chosen ? styles.reviewMarkChosen : styles.reviewMark}
                        aria-hidden
                      >
                        {chosen ? "✓" : ""}
                      </span>
                      <span className={card.optionCopy}>
                        <span className={card.optionLabel}>{label}</span>
                        {option.description ? (
                          <span className={styles.optionDescription}>{option.description}</span>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {/* A multi-select answer can carry both, so this is not an either/or. */}
            {custom.length > 0 ? <div className={styles.reviewCustom}>{custom}</div> : null}
            {skipped ? <div className={styles.reviewSkipped}>{t("question.skipped")}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
