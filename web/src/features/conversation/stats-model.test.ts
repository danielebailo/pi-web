import { describe, expect, it } from "vitest";
import { translator } from "../../lib/i18n/index.ts";

const zh = translator("zh-CN");
const formatLatencySeconds = (ms: number): string => formatLatencySecondsOf(ms, zh);
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from "../../lib/types.ts";
import {
  EMPTY_TIMING,
  billedInputTokens,
  formatCacheHitPercent,
  formatExactCount,
  formatLatencySeconds as formatLatencySecondsOf,
  formatTokensPerSecond,
  sessionStats,
  turnUsage,
} from "./stats-model.ts";

function user(): UserMessage {
  return { role: "user", content: "hi", timestamp: 0 };
}

function assistant(usage: Partial<AssistantMessage["usage"]>, model = "deepseek"): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    provider: "cz",
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, ...usage },
    timestamp: 0,
  };
}

function toolResult(usage?: AssistantMessage["usage"]): ToolResultMessage {
  return { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [], usage, timestamp: 0 };
}

function timing(overrides: Partial<typeof EMPTY_TIMING> = {}): typeof EMPTY_TIMING {
  return { ...EMPTY_TIMING, ...overrides };
}

describe("sessionStats", () => {
  it("counts user turns and assistant steps", () => {
    const messages: AgentMessage[] = [user(), assistant({}), user(), assistant({}), assistant({})];
    const stats = sessionStats(messages, EMPTY_TIMING);
    expect(stats.turns).toBe(2);
    expect(stats.steps).toBe(3);
  });

  it("sums usage over assistant and tool-result messages", () => {
    const messages: AgentMessage[] = [
      user(),
      assistant({ input: 100, output: 20, cacheRead: 300, cacheWrite: 5 }),
      toolResult({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 7 }),
    ];
    const stats = sessionStats(messages, EMPTY_TIMING);
    expect(stats.usage).toEqual({ input: 100, output: 20, cacheRead: 300, cacheWrite: 5 });
    // Billed input (100 + 300 + 5) plus output, the figure on the pill.
    expect(stats.totalTokens).toBe(425);
  });

  it("names the newest assistant message's model", () => {
    const messages: AgentMessage[] = [
      assistant({}, "old"),
      assistant({}, "deepseek-chat"),
    ];
    expect(sessionStats(messages, EMPTY_TIMING).model).toBe("cz/deepseek-chat");
  });

  it("reports no speed until this client has measured one", () => {
    expect(sessionStats([user(), assistant({ output: 500 })], EMPTY_TIMING).tokensPerSecond).toBeNull();
    const measured = sessionStats(
      [user(), assistant({ output: 500 })],
      timing({ decodeMs: 2000, decodeTokens: 500 }),
    );
    expect(measured.tokensPerSecond).toBe(250);
  });
});

describe("turnUsage", () => {
  it("sums the turn's buckets across its model calls", () => {
    const usage = turnUsage([
      user(),
      assistant({ input: 1_200, cacheRead: 10_600, cacheWrite: 100, totalTokens: 11_900 }),
      assistant({ output: 340, totalTokens: 340 }),
    ]);

    expect(usage).toEqual({
      input: 1_200,
      output: 340,
      cacheRead: 10_600,
      cacheWrite: 100,
      totalTokens: 12_240,
    });
  });

  it("reads a turn with no usage recorded as having none", () => {
    const bare: AssistantMessage = { role: "assistant", content: [], timestamp: 0 };

    expect(turnUsage([user(), bare])).toBeNull();
  });

  it("skips a usage that never recorded a total", () => {
    // pi records one for every call it bills; a turn whose only numbers are the
    // four buckets would otherwise report a headline figure the buckets behind
    // it do not add up to.
    const noTotal: AssistantMessage = {
      role: "assistant",
      content: [],
      usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 },
      timestamp: 0,
    };

    expect(turnUsage([user(), noTotal])).toBeNull();
  });

  it("counts assistant messages only, not the tool results between them", () => {
    // A turn's figure is the sum over that turn's assistant messages
    // (docs/design-notes.md:480). A tool row that ran a summariser is not part
    // of it — which is also the figure the row showed before it had a panel.
    const usage = turnUsage([
      user(),
      assistant({ output: 10, totalTokens: 10 }),
      toolResult({ input: 999, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 999 }),
    ]);

    expect(usage?.totalTokens).toBe(10);
    expect(usage?.input).toBe(0);
  });
});

describe("formatCacheHitPercent", () => {
  it("rounds to whole percent", () => {
    expect(formatCacheHitPercent({ input: 17, output: 0, cacheRead: 83, cacheWrite: 0 })).toBe("83");
  });

  it("never rounds a miss up to 100", () => {
    expect(formatCacheHitPercent({ input: 1, output: 0, cacheRead: 999, cacheWrite: 0 })).toBe("99.9");
  });

  it("says 100 only when nothing was billed uncached", () => {
    expect(formatCacheHitPercent({ input: 0, output: 0, cacheRead: 40, cacheWrite: 0 })).toBe("100");
  });

  it("is null when nothing was billed at all", () => {
    expect(formatCacheHitPercent({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe("billedInputTokens", () => {
  it("adds the three disjoint prompt-side buckets", () => {
    expect(billedInputTokens({ input: 1, output: 99, cacheRead: 2, cacheWrite: 3 })).toBe(6);
  });
});

describe("formatting", () => {
  it("shows whole numbers from ten tokens per second up", () => {
    expect(formatTokensPerSecond(241.4)).toBe("241");
    expect(formatTokensPerSecond(9.44)).toBe("9.4");
    expect(formatTokensPerSecond(-5)).toBe("0");
  });

  it("keeps one decimal below ten seconds of latency", () => {
    expect(formatLatencySeconds(1234)).toBe("1.2秒");
    expect(formatLatencySeconds(12_400)).toBe("12秒");
  });

  it("groups exact counts the way dsh's dialog does", () => {
    expect(formatExactCount(587123)).toBe("587,123");
    expect(formatExactCount(42)).toBe("42");
  });
});
