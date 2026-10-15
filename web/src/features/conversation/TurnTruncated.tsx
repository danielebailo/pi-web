import { StateDot } from "../../components/StateDot.tsx";
import { useT } from "../../lib/app-state.ts";
import styles from "./TurnTruncated.module.css";

/**
 * The notice that follows an answer pi stopped at the output-token cap: the
 * model's last message carries `stopReason: "length"`, and without this row the
 * reader just sees prose that stops mid-sentence with no explanation.
 *
 * Ported from dsh's `TurnMaxTokensItem` (`MessageItem.tsx`), which dsh places
 * between the closing assistant row and the turn tail — the same spot this
 * takes, under the answer it describes. Read straight off the transcript (like
 * `TurnFailure`, unlike `RetryNotice`), so it survives a reload and a session
 * switch; the stream adds nothing a transcript cannot know, because pi stamps
 * `stopReason` on the assembled message before it lands.
 *
 * A warning, not an error: the turn ended cleanly, the answer is just shorter
 * than the model wanted it to be. No retry action — resending the prompt would
 * produce a fresh answer, not a continuation, and dsh draws none either.
 */
export function TurnTruncated() {
  const t = useT();
  return (
    <div className={styles.truncatedRow} role="status">
      <StateDot state="warning" className={styles.truncatedDot} />
      <div className={styles.truncatedCopy}>
        <span className={styles.truncatedTitle}>{t("truncation.title")}</span>
        <span className={styles.truncatedHint}>{t("truncation.hint")}</span>
      </div>
    </div>
  );
}
