import { beforeEach, describe, expect, it } from "vitest";
import { planStore, publishPlans, rememberTemporaryPlan } from "./plan-store.ts";
import type { PlanDoc } from "../conversation/plan-docs.ts";

const doc = (callId: string, overrides: Partial<PlanDoc> = {}): PlanDoc => ({
  callId,
  title: `Plan ${callId}`,
  plan: "# Plan\n\ndo the thing",
  ...overrides,
});

beforeEach(() => {
  planStore.set({ bySession: {}, temporary: {} });
});

/**
 * The store is the conversation pane's side of the plan tab: the pane publishes,
 * the tab reads, and the two must not disagree about whether something changed.
 */
describe("publishPlans", () => {
  it("keeps each session's plans under its own key", () => {
    publishPlans("session-a", [doc("call-1")]);
    publishPlans("session-b", [doc("call-2")]);

    const state = planStore.get();
    expect(state.bySession["session-a"]?.[0]?.callId).toBe("call-1");
    expect(state.bySession["session-b"]?.[0]?.callId).toBe("call-2");
  });

  it("ignores an empty session path rather than filing under the empty key", () => {
    publishPlans("", [doc("call-1")]);
    expect(planStore.get().bySession[""]).toBeUndefined();
  });

  it("does not wake subscribers when the projection is unchanged", () => {
    let notifications = 0;
    const unsubscribe = planStore.subscribe(() => {
      notifications += 1;
    });

    publishPlans("session-a", [doc("call-1")]);
    // The pane recomputes from the message list on every publish, so an equal
    // list has to be a no-op or streaming would wake every plan tab.
    publishPlans("session-a", [doc("call-1")]);
    expect(notifications).toBe(1);

    publishPlans("session-a", [doc("call-1", { plan: "# Plan\n\ndo something else" })]);
    expect(notifications).toBe(2);
    unsubscribe();
  });
});

describe("rememberTemporaryPlan", () => {
  it("keeps a call-less review's document under its own key", () => {
    rememberTemporaryPlan("q-1", { title: "Temporary", plan: "# Temporary" });

    expect(planStore.get().temporary["q-1"]).toEqual({ title: "Temporary", plan: "# Temporary" });
    // Never folded into the session's logged plans: there is no call to replay,
    // so it must not look like one on the next read.
    expect(planStore.get().bySession["session-a"]).toBeUndefined();
  });
});
