import { describe, expect, it } from "vitest";
import { translator } from "../../lib/i18n/index.ts";
import type { AgentMessage } from "../../lib/types.ts";
import { todoBaselinesOf, todoDiffModel } from "./todo-diff-model.ts";
import type { TodoItem } from "./todo-model.ts";

const zh = translator("zh-CN");

function task(content: string, status: TodoItem["status"]): TodoItem {
  return { content, status };
}

function contents(items: readonly TodoItem[]): string[] {
  return items.map((item) => item.content);
}

/** An assistant message carrying one `todo` call, as the transcript stores it. */
function call(id: string): AgentMessage {
  return { role: "assistant", content: [{ type: "toolCall", id, name: "todo", arguments: {} }] } as AgentMessage;
}

/** A `todo` tool result carrying a snapshot, as pi writes it to the transcript. */
function result(details: unknown, toolName = "todo"): AgentMessage {
  return { role: "toolResult", toolName, toolCallId: "call_1", content: [], details } as AgentMessage;
}

describe("todoDiffModel", () => {
  it("reads the first write as all added", () => {
    const diff = todoDiffModel([task("a", "pending"), task("b", "in_progress")], undefined, zh);
    expect(diff.caption).toBe("首次记录");
    expect(diff.summary).toBe("新增 2");
    expect(diff.items.map((item) => item.change)).toEqual(["added", "added"]);
    expect(diff.unchanged).toEqual([]);
  });

  it("names the status a write replaced", () => {
    const diff = todoDiffModel(
      [task("a", "completed"), task("b", "pending")],
      [task("a", "in_progress"), task("b", "pending")],
      zh,
    );
    expect(diff.summary).toBe("更新 1");
    expect(diff.items[0]).toMatchObject({
      change: "updated",
      changeLabel: "状态变化",
      previousStatusLabel: "进行中",
    });
    // The untouched row folds away rather than filling the card.
    expect(diff.unchanged.map((item) => item.content)).toEqual(["b"]);
  });

  it("reports a reorder without pretending the status moved", () => {
    const diff = todoDiffModel(
      [task("b", "pending"), task("a", "pending")],
      [task("a", "pending"), task("b", "pending")],
      zh,
    );
    // dsh counts a moved row into `updated`, but its label says what moved.
    expect(diff.summary).toBe("更新 2");
    expect(diff.items.every((item) => item.change === "moved")).toBe(true);
    expect(diff.items.every((item) => item.previousStatusLabel === undefined)).toBe(true);
    expect(diff.items.every((item) => item.changeLabel === "顺序调整")).toBe(true);
  });

  it("keeps removed rows in the previous list's order", () => {
    const diff = todoDiffModel([task("a", "pending")], [task("c", "completed"), task("a", "pending"), task("b", "pending")], zh);
    expect(diff.summary).toBe("移除 2");
    // Removed rows trail the current list, oldest write order first.
    expect(diff.items.filter((item) => item.change === "removed").map((item) => item.content)).toEqual(["c", "b"]);
    // The kept row is not part of the changed set at all.
    expect(diff.unchanged[0]).toMatchObject({ content: "a", change: null, changeLabel: "待处理" });
  });

  it("reads an unchanged list as no changes", () => {
    const same = [task("a", "pending"), task("b", "in_progress")];
    const diff = todoDiffModel(same, [...same], zh);
    expect(diff.summary).toBe("清单没有变化");
    expect(diff.items).toEqual([]);
    expect(diff.unchanged).toHaveLength(2);
  });

  it("joins the tallies in dsh's order", () => {
    const diff = todoDiffModel(
      [task("new", "pending"), task("a", "completed"), task("b", "pending")],
      [task("a", "pending"), task("b", "in_progress"), task("gone", "pending")],
      zh,
    );
    expect(diff.caption).toBe("与上次清单相比");
    expect(diff.summary).toBe("新增 1 · 更新 2 · 移除 1");
  });
});

describe("todoBaselinesOf", () => {
  it("pairs each call with the newest snapshot before it", () => {
    const first = [task("a", "pending")];
    const second = [task("a", "completed"), task("b", "pending")];
    const messages = [
      call("c1"),
      result({ todos: first }),
      call("c2"),
      result({ todos: second }),
      call("c3"),
    ];
    const baselines = todoBaselinesOf(messages);
    expect(baselines.get("c1")).toBeUndefined();
    expect(baselines.get("c2")).toEqual(first);
    expect(baselines.get("c3")).toEqual(second);
  });

  it("only records results it can read", () => {
    const first = [task("a", "pending")];
    const messages = [call("c1"), result({ todos: first }), call("c2"), result({ todos: "garbage" }), call("c3")];
    const baselines = todoBaselinesOf(messages);
    // A failed write leaves the previous list standing — dsh only records
    // successful writes too.
    expect(baselines.get("c2")).toEqual(first);
    expect(baselines.get("c3")).toEqual(first);
  });

  it("ignores other tools and plain messages", () => {
    const baselines = todoBaselinesOf([
      result({ todos: [task("a", "pending")] }, "bash"),
      call("c1"),
    ]);
    expect(baselines.get("c1")).toBeUndefined();
  });
});
