import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../../lib/types.ts";
import { TodoRow } from "./TodoRow.tsx";
import { TodoBaselinesProvider } from "./todo-history.tsx";
import type { ToolExecution } from "./useConversation.ts";

// The chrome resolves through `useT`; pin the host locale to the wording the
// assertions read (see MessageList.test.tsx for the same convention).
vi.stubGlobal("navigator", { language: "zh-CN" });

function call(id: string): AgentMessage {
  return { role: "assistant", content: [{ type: "toolCall", id, name: "todo", arguments: {} }] } as AgentMessage;
}

function result(id: string, todos: unknown): AgentMessage {
  return { role: "toolResult", toolCallId: id, toolName: "todo", content: [], details: { todos } } as AgentMessage;
}

const messages = [
  call("c1"),
  result("c1", [{ content: "ship", status: "in_progress" }, { content: "docs", status: "pending" }]),
  call("c2"),
  result("c2", [{ content: "ship", status: "completed" }, { content: "docs", status: "pending" }]),
];

function executionFor(callId: string): ToolExecution {
  const result = messages.find(
    (message) => message.role === "toolResult" && (message as { toolCallId?: string }).toolCallId === callId,
  ) as { details: unknown };
  return { toolName: "todo", args: {}, output: "", result: [], details: result.details, isError: false, running: false };
}

function row(callId: string, open: boolean): string {
  const call = { type: "toolCall", id: callId, name: "todo", arguments: {} };
  return renderToStaticMarkup(
    <TodoBaselinesProvider messages={messages}>
      <TodoRow call={call as never} execution={executionFor(callId)} defaultOpen={open} />
    </TodoBaselinesProvider>,
  );
}

describe("TodoRow diff", () => {
  it("counts the change against the previous list on the collapsed line", () => {
    const html = row("c2", false);
    expect(html).toContain("更新任务清单");
    expect(html).toContain("更新 1");
  });

  it("marks changed rows with the old status when expanded", () => {
    const html = row("c2", true);
    expect(html).toContain("与上次清单相比");
    expect(html).toContain("进行中 → 已完成");
    // The untouched row folds away under its count line.
    expect(html).toContain("1 项未变化");
  });

  it("reads the first write plainly, with every row added", () => {
    const collapsed = row("c1", false);
    expect(collapsed).toContain("新增 2");
    const html = row("c1", true);
    expect(html).toContain("首次记录");
    // Both rows trade their glyph for the mark; the label names the change.
    expect(html).toContain('aria-label="新增"');
    expect(html).toContain('data-change="added"');
  });
});
