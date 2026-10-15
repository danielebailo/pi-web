import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../lib/types.ts";
import { EXIT_PLAN_MODE_TOOL, planDocsOf, planTitleOf } from "./plan-docs.ts";

/** One assistant message carrying tool calls, as the transcript holds them. */
function assistant(content: unknown[]): AgentMessage {
  return { role: "assistant", content, timestamp: 0 } as unknown as AgentMessage;
}

/** One `exit_plan_mode` call block. */
function call(id: string, args: Record<string, unknown>, name = EXIT_PLAN_MODE_TOOL): unknown {
  return { type: "toolCall", id, name, arguments: args };
}

describe("planTitleOf", () => {
  it("reads the plan's first heading, at any depth", () => {
    expect(planTitleOf("# 迁移计划\n\n1. 做一件事。")).toBe("迁移计划");
    expect(planTitleOf("intro\n## 第二层\n# 后面的大标题")).toBe("第二层");
  });

  it("falls back to a plain title when the plan has no heading", () => {
    // `exit_plan_mode` refuses such a plan, so this is only reachable from a
    // hand-edited session — the fallback keeps the card readable.
    expect(planTitleOf("just prose")).toBe("Plan");
  });
});

describe("planDocsOf", () => {
  it("collects every submitted plan, in invocation order", () => {
    const docs = planDocsOf([
      assistant([call("call-1", { plan: "# First\n\nA." })]),
      { role: "user", content: [] } as unknown as AgentMessage,
      assistant([call("call-2", { plan: "# Second\n\nB." })]),
    ]);

    expect(docs).toEqual([
      { callId: "call-1", title: "First", plan: "# First\n\nA." },
      { callId: "call-2", title: "Second", plan: "# Second\n\nB." },
    ]);
  });

  it("ignores other tools, and calls whose plan is not a plan", () => {
    const docs = planDocsOf([
      assistant([
        call("edit-1", { path: "a.ts" }, "edit"),
        call("plan-missing", {}),
        call("plan-empty", { plan: "   " }),
        call("plan-wrong-type", { plan: 42 }),
        call("plan-ok", { plan: "# Kept" }),
      ]),
    ]);

    expect(docs).toEqual([{ callId: "plan-ok", title: "Kept", plan: "# Kept" }]);
  });

  it("keeps a plan whose review was rejected", () => {
    // The projection reads the *call*, not its result: a card records that a
    // plan was submitted, which stays true whether or not it was approved
    // (dsh keeps the same cards for the same reason).
    const docs = planDocsOf([assistant([call("call-1", { plan: "# Sent back\n\nAgain." })])]);
    expect(docs).toHaveLength(1);
  });

  it("answers nothing for a transcript without plans", () => {
    expect(planDocsOf([assistant([{ type: "text", text: "hi" }])])).toEqual([]);
  });
});
