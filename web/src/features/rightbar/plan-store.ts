import { createStore, useStoreSelector, type Store } from "../../lib/store.ts";
import type { PlanDoc, PlanText } from "../conversation/plan-docs.ts";
import { REVIEW_TARGET_PREFIX } from "./rightbar-state.ts";

/**
 * Submitted plans, per session, published by the conversation pane.
 *
 * The bridge the sidebar's plan tab reads through — the same shape and the same
 * reason as `turn-changes-store.ts`: a plan tab is addressed by session and
 * `callId`, and only the conversation holds the transcript those come from, so
 * the pane publishes and the tab reads. A tab restored from a saved layout
 * therefore works as soon as its session is open, and says "unavailable"
 * (rather than lying) while it is not.
 *
 * dsh reaches the same place through its resource protocol
 * (`dsh-resource://plan/<callId>`), which the Host resolves from the log. This
 * project has no resource layer, so the projection is published instead.
 */
interface PlanState {
  /** By session path; each entry is that session's plans in submission order. */
  bySession: Record<string, readonly PlanDoc[]>;
  /**
   * Reviews with no logged invocation: a plan that reached the card straight
   * from an extension (`intent` without `callId`).
   *
   * Its document exists nowhere else — there is no tool call to replay — so it
   * lives in memory only, and a reload is what makes it expire. That is dsh's
   * rule for the same case (`dsh-resource://plan-review/…` is never persisted).
   */
  temporary: Record<string, PlanText>;
}

export const planStore: Store<PlanState> = createStore({ bySession: {}, temporary: {} });

/** Whether two plan lists describe the same documents, in the same order. */
function samePlans(
  left: readonly PlanDoc[] | undefined,
  right: readonly PlanDoc[],
): boolean {
  if (left === undefined || left.length !== right.length) return false;
  return left.every((plan, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      plan.callId === other.callId &&
      plan.title === other.title &&
      plan.plan === other.plan
    );
  });
}

/**
 * Replace one session's published plans.
 *
 * An equal list is not written: the projection is recomputed from the message
 * list on every publish, and streaming would otherwise wake every plan tab on
 * each round trip.
 *
 * @param sessionPath - the session the plans belong to.
 * @param plans - every plan that session submitted, in invocation order.
 */
export function publishPlans(sessionPath: string, plans: readonly PlanDoc[]): void {
  if (sessionPath.length === 0) return;
  planStore.update((state) => {
    if (samePlans(state.bySession[sessionPath], plans)) return state;
    return { ...state, bySession: { ...state.bySession, [sessionPath]: plans } };
  });
}

/**
 * Remember one unlogged plan until the page is reloaded.
 *
 * @param requestKey - the review's own identity inside this browser session.
 * @param plan - the document to show.
 */
export function rememberTemporaryPlan(requestKey: string, plan: PlanText): void {
  planStore.update((state) => ({ ...state, temporary: { ...state.temporary, [requestKey]: plan } }));
}

/** Every plan one session published, in submission order. */
export function useSessionPlans(sessionPath: string): readonly PlanDoc[] {
  return useStoreSelector(planStore, (state) => state.bySession[sessionPath]) ?? [];
}

/**
 * The document one tab's target names, or undefined while it cannot be read.
 *
 * `undefined` is the honest answer for a tab restored from a saved layout whose
 * session has not been opened yet (the projection is empty), for a turn whose
 * messages are no longer loaded, and for a temporary preview whose review was
 * dismissed and then reloaded away.
 *
 * @param sessionPath - the session the tab belongs to.
 * @param target - a logged plan's `callId`, or `review:<requestKey>`.
 */
export function usePlanTarget(sessionPath: string, target: string): PlanText | undefined {
  return useStoreSelector(planStore, (state) =>
    target.startsWith(REVIEW_TARGET_PREFIX)
      ? state.temporary[target.slice(REVIEW_TARGET_PREFIX.length)]
      : state.bySession[sessionPath]?.find((plan) => plan.callId === target),
  );
}
