import { useT } from "../../lib/app-state.ts";
import { Markdown } from "../conversation/Markdown.tsx";
import { REVIEW_TARGET_PREFIX, type RightbarTab } from "./rightbar-state.ts";
import { usePlanTarget } from "./plan-store.ts";
import styles from "./PlanTab.module.css";

/**
 * A submitted plan, read-only, in the right sidebar.
 *
 * dsh's `PlanPreview`: the complete markdown of the plan the review card was
 * judging, so a reader can study it at a column's width instead of inside the
 * card's own scrollport. It is addressed by the tab's `target`, which the tab
 * has carried since it was opened (`rightbar-state.ts`) — a logged plan's
 * `callId`, or a temporary review's own key.
 *
 * A document that cannot be read right now says so in one of two ways, and the
 * difference matters to the reader: a temporary preview is gone for good (the
 * reload dropped the only copy) and points back at the card that can reopen it,
 * while a logged plan is merely not loaded yet — its session is not open, so
 * opening it brings the plan back.
 */
export function PlanTab({ sessionPath, tab }: { sessionPath: string; tab: RightbarTab }) {
  const t = useT();
  const plan = usePlanTarget(sessionPath, tab.target);

  if (plan === undefined) {
    return (
      <div className={styles.note} role="status" data-plan-preview={tab.target}>
        {tab.target.startsWith(REVIEW_TARGET_PREFIX) ? t("plan.expired") : t("plan.unavailable")}
      </div>
    );
  }

  return (
    <section
      className={styles.preview}
      data-plan-preview={tab.target}
      aria-label={plan.title}
    >
      <div className={styles.document}>
        {/* The document rhythm, not the transcript's: this is the one surface
            that shows a whole markdown document at a column's width (dsh's
            `PlanPreview` reads `MarkdownText` the same way). */}
        <Markdown text={plan.plan} variant="document" />
      </div>
    </section>
  );
}
