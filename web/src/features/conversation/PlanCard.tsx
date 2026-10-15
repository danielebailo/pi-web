import { useT } from "../../lib/app-state.ts";
import { FileIcon } from "../rightbar/rightbar-icons.tsx";
import type { PlanDoc } from "./plan-docs.ts";
import styles from "./PlanCard.module.css";

/**
 * The plans a finished turn submitted, at its tail.
 *
 * dsh's `PlanCards`: one card per `exit_plan_mode` invocation, in invocation
 * order, sitting with the turn's other artifacts rather than inside the tool row
 * that produced them. That placement is the point — the tool row says a call
 * happened, while what a reader wants next is the document, and the document is
 * worth more than the argument summary a generic row can show.
 *
 * A rejected plan keeps its card: what the card records is that a plan was
 * submitted and can be read again, not that it was approved (dsh keeps it for
 * the same reason, and so does the projection behind this one).
 *
 * The whole card is one button, so it is reachable by keyboard and reads as one
 * action to a screen reader: open the plan.
 */
export function PlanCard({
  plans,
  onOpenPlan,
}: {
  plans: readonly PlanDoc[];
  /** Opens the plan in the right sidebar; the tab is addressed by `callId`.
   * Absent means the card records the plan without offering the action. */
  onOpenPlan?: ((plan: PlanDoc) => void) | undefined;
}) {
  const t = useT();
  if (plans.length === 0) return null;

  const body = (plan: PlanDoc) => (
    <>
      <span className={styles.tile} aria-hidden>
        <FileIcon width={20} height={20} />
      </span>
      <span className={styles.details}>
        <span className={styles.title}>{plan.title}</span>
        <span className={styles.description}>{t("plan.document")}</span>
      </span>
      <span className={styles.open}>{t("plan.action")}</span>
    </>
  );

  return (
    <div className={styles.cards} data-plan-artifacts>
      {plans.map((plan) =>
        onOpenPlan === undefined ? (
          <div key={plan.callId} className={styles.card} data-plan-card={plan.callId}>
            {body(plan)}
          </div>
        ) : (
          <button
            key={plan.callId}
            type="button"
            className={styles.card}
            data-plan-card={plan.callId}
            aria-label={t("plan.openNamed", { title: plan.title })}
            onClick={() => onOpenPlan(plan)}
          >
            {body(plan)}
          </button>
        ),
      )}
    </div>
  );
}
